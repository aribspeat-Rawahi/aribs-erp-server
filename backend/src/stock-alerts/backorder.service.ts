import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { Invoice } from '../invoice/invoice.entity';
import { InvoiceItem } from '../invoice/invoice-item.entity';
import { FinishedGood } from '../inventory/finished-good.entity';
import { EmailService } from '../common/email.service';
import { formatQtyWithUnit } from '../units/units';

export interface ProductShortage {
  finishedGoodId: string;
  name: string;
  unit: string;
  short: number;
}

// Invoices take stock out immediately, even when there isn't enough (stock
// then goes below zero). This works out which not-yet-delivered invoices
// are still waiting for stock and sends a reminder when stock arrives.
//
// Rule: for a product with stock -N, the N missing units belong to the
// NEWEST pending invoices (older orders are served first).
@Injectable()
export class BackorderService {
  private readonly logger = new Logger(BackorderService.name);

  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private email: EmailService,
  ) {}

  // invoiceId -> products still missing for it (only pending invoices).
  async computeShortages(productIds?: string[]): Promise<Map<string, ProductShortage[]>> {
    const result = new Map<string, ProductShortage[]>();
    const productRepo = this.dataSource.getRepository(FinishedGood);
    const products = await productRepo.find(productIds?.length ? { where: { id: In(productIds) } } : {});
    const negative = products.filter((p) => Number(p.quantityInStock) < -0.0005);
    if (!negative.length) return result;

    const pending = await this.dataSource.getRepository(Invoice).find({
      where: { deliveryStatus: 'pending' },
      order: { createdAt: 'DESC' },
    });
    if (!pending.length) return result;
    const order = new Map(pending.map((inv, idx) => [inv.id, idx]));
    const items = await this.dataSource.getRepository(InvoiceItem).find({
      where: { invoiceId: In(pending.map((i) => i.id)), finishedGoodId: In(negative.map((p) => p.id)) },
    });

    for (const product of negative) {
      let backorder = -Number(product.quantityInStock);
      const lines = items
        .filter((it) => it.finishedGoodId === product.id)
        .sort((a, b) => (order.get(a.invoiceId) ?? 0) - (order.get(b.invoiceId) ?? 0)); // newest first
      for (const line of lines) {
        if (backorder <= 0.0005) break;
        const short = Math.min(Number(line.quantity), backorder);
        backorder = Math.round((backorder - short) * 1000) / 1000;
        const list = result.get(line.invoiceId) || [];
        const existing = list.find((s) => s.finishedGoodId === product.id);
        if (existing) existing.short = Math.round((existing.short + short) * 1000) / 1000;
        else list.push({ finishedGoodId: product.id, name: product.name, unit: product.unit, short: Math.round(short * 1000) / 1000 });
        result.set(line.invoiceId, list);
      }
    }
    return result;
  }

  // Re-checks the pending invoices that contain these products: flags the
  // ones still short, and when one is no longer short sends the "stock is
  // ready" reminder. Never throws (a failed check must not break a sale or
  // a stock-in).
  async refresh(productIds: string[]): Promise<void> {
    try {
      if (!productIds.length) return;
      const invoiceRepo = this.dataSource.getRepository(Invoice);
      const itemRepo = this.dataSource.getRepository(InvoiceItem);
      const touched = await itemRepo.find({ where: { finishedGoodId: In(productIds) } });
      const invoiceIds = [...new Set(touched.map((t) => t.invoiceId))];
      if (!invoiceIds.length) return;
      const invoices = await invoiceRepo.find({ where: { id: In(invoiceIds), deliveryStatus: 'pending' } });
      if (!invoices.length) return;

      // all products on those invoices, so a multi-product invoice is judged as a whole
      const allLines = await itemRepo.find({ where: { invoiceId: In(invoices.map((i) => i.id)) } });
      const allProductIds = [...new Set(allLines.map((l) => l.finishedGoodId).filter((id): id is string => !!id))];
      const shortages = await this.computeShortages(allProductIds);

      const ready: Invoice[] = [];
      for (const invoice of invoices) {
        const waiting = shortages.has(invoice.id);
        if (invoice.waitingForStock && !waiting) {
          invoice.waitingForStock = false;
          invoice.stockReadyAt = new Date();
          await invoiceRepo.save(invoice);
          ready.push(invoice);
        } else if (!invoice.waitingForStock && waiting) {
          invoice.waitingForStock = true;
          invoice.stockReadyAt = null;
          await invoiceRepo.save(invoice);
        }
      }

      if (ready.length) {
        const lines = await Promise.all(
          ready.map(async (inv) => {
            const its = allLines.filter((l) => l.invoiceId === inv.id && l.finishedGoodId);
            const what = its.map((l) => `${l.description} (${formatQtyWithUnit(l.quantity, l.unit)})`).join(', ');
            return `${inv.invoiceNumber}: ${what}`;
          }),
        );
        await this.email.sendStockReadyNotice(lines);
      }
    } catch (err) {
      this.logger.warn(`Backorder check failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
