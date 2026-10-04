import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { SalesReturn, SalesReturnStatus } from './sales-return.entity';
import { SalesReturnItem } from './sales-return-item.entity';
import { Invoice } from './invoice.entity';
import { InvoiceItem } from './invoice-item.entity';
import { FinishedGood } from '../inventory/finished-good.entity';
import { BankAccount } from '../bank-account/bank-account.entity';
import { BankTransaction, BankTransactionType } from '../bank-account/bank-transaction.entity';
import { CreateSalesReturnDto } from './dto/sales-return.dto';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { BankAccountService } from '../bank-account/bank-account.service';
import { JournalPostingService, PostingLine } from '../journal/journal-posting.service';
import { BatchTrackingService } from '../inventory/batch-tracking.service';
import { BatchSource } from '../inventory/batch-source.enum';
import { assertQuantityForUnit } from '../units/units';

interface ActorRef {
  userId?: string;
  email?: string;
}

const SALES_RETURN_CODE = '1403'; // Sales Returns and Allowance
// VAT Payable, not "1407 Sales Return Tax" — the returned VAT was never
// part of Sales Revenue (the original invoice credited it straight to
// 2100), so reversing it here has to reduce that same liability, not a
// Revenue-type account (which would incorrectly shrink reported Revenue
// by the VAT amount too).
const VAT_PAYABLE_CODE = '2100';
const ACCOUNTS_RECEIVABLE_CODE = '1100';
const FG_INVENTORY_CODE = '1210';
const COGS_CODE = '500';

@Injectable()
export class SalesReturnService {
  constructor(
    @InjectRepository(SalesReturn)
    private repo: Repository<SalesReturn>,
    @InjectRepository(InvoiceItem)
    private invoiceItemRepo: Repository<InvoiceItem>,
    @InjectDataSource()
    private dataSource: DataSource,
    private activityLog: ActivityLogService,
    private bankAccountService: BankAccountService,
    private journalPosting: JournalPostingService,
    private batchTrackingService: BatchTrackingService,
  ) {}

  private generateReturnNumber() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `SR-${date}-${rand}`;
  }

  private round3(n: number) {
    return Math.round(n * 1000) / 1000;
  }

  findAll() {
    return this.repo.find({ relations: ['items'], order: { date: 'DESC', createdAt: 'DESC' } });
  }

  // Total of APPROVED sales returns within a date range — the Dashboard's
  // Sales card "Return Amount" figure. Pending/rejected returns have no
  // real stock/money effect yet, so they're excluded.
  async getApprovedTotalInRange(startDate: string, endDate: string) {
    const rows = await this.repo
      .createQueryBuilder('r')
      .where('r.status = :status', { status: SalesReturnStatus.APPROVED })
      .andWhere('r.date BETWEEN :startDate AND :endDate', { startDate, endDate })
      .getMany();
    return this.round3(rows.reduce((sum, r) => sum + Number(r.total), 0));
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({ where: { id }, relations: ['items'] });
    if (!item) throw new NotFoundException('Sales return not found');
    return item;
  }

  private async alreadyReturnedQty(invoiceId: string, finishedGoodId: string) {
    const approved = await this.repo.find({
      where: { invoiceId, status: SalesReturnStatus.APPROVED },
      relations: ['items'],
    });
    let qty = 0;
    for (const r of approved) {
      for (const i of r.items) {
        if (i.finishedGoodId === finishedGoodId) qty += Number(i.quantity);
      }
    }
    return qty;
  }

  async create(dto: CreateSalesReturnDto, requestedBy: ActorRef) {
    const invoice = await this.dataSource.manager.findOne(Invoice, { where: { id: dto.invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const finishedGoodIds = dto.items.map((i) => i.finishedGoodId);
    const invoiceItems = await this.invoiceItemRepo.find({
      where: { invoiceId: invoice.id, finishedGoodId: In(finishedGoodIds) },
    });
    // An invoice can carry the same product on more than one line —
    // combine them so the returnable quantity check looks at the whole
    // invoice, not just the first matching line.
    const originalQtyByProduct = new Map<string, number>();
    const referenceItemByProduct = new Map<string, InvoiceItem>();
    for (const ii of invoiceItems) {
      if (!ii.finishedGoodId) continue;
      originalQtyByProduct.set(ii.finishedGoodId, (originalQtyByProduct.get(ii.finishedGoodId) || 0) + Number(ii.quantity));
      if (!referenceItemByProduct.has(ii.finishedGoodId)) referenceItemByProduct.set(ii.finishedGoodId, ii);
    }

    let subtotal = 0;
    let vatAmount = 0;
    const itemRows: { finishedGoodId: string; quantity: number; unit: string; unitPrice: number; vatRate: number }[] = [];
    for (const line of dto.items) {
      const reference = referenceItemByProduct.get(line.finishedGoodId);
      if (!reference) {
        throw new BadRequestException(`This invoice has no line for the selected product (${line.finishedGoodId})`);
      }
      const alreadyReturned = await this.alreadyReturnedQty(invoice.id, line.finishedGoodId);
      const remaining = this.round3((originalQtyByProduct.get(line.finishedGoodId) || 0) - alreadyReturned);
      if (Number(line.quantity) > remaining + 0.001) {
        throw new BadRequestException(
          `Cannot return ${line.quantity} — only ${remaining} of this product remains returnable on this invoice.`,
        );
      }
      assertQuantityForUnit(line.quantity, reference.unit, reference.description);
      const lineTotal = this.round3(Number(line.quantity) * Number(reference.unitPrice));
      subtotal += lineTotal;
      vatAmount += this.round3((lineTotal * Number(reference.vatRate)) / 100);
      itemRows.push({
        finishedGoodId: line.finishedGoodId,
        quantity: Number(line.quantity),
        unit: reference.unit,
        unitPrice: Number(reference.unitPrice),
        vatRate: Number(reference.vatRate),
      });
    }
    subtotal = this.round3(subtotal);
    vatAmount = this.round3(vatAmount);

    const item = this.repo.create({
      returnNumber: this.generateReturnNumber(),
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      status: SalesReturnStatus.PENDING,
      date: dto.date || new Date().toISOString().slice(0, 10),
      reason: dto.reason,
      subtotal,
      vatAmount,
      total: this.round3(subtotal + vatAmount),
      bankAccountId: dto.bankAccountId,
      requestedByUserId: requestedBy.userId,
      requestedByEmail: requestedBy.email,
      items: itemRows.map((i) => this.repo.manager.create(SalesReturnItem, i)),
    });
    const saved = await this.repo.save(item);
    await this.activityLog.log({
      action: 'sales_return.created',
      entityType: 'sales_return',
      entityId: saved.id,
      userId: requestedBy.userId,
      userEmail: requestedBy.email,
      details: { returnNumber: saved.returnNumber, invoiceId: saved.invoiceId, total: saved.total },
    });
    return saved;
  }

  async remove(id: string) {
    const item = await this.findOne(id);
    if (item.status !== SalesReturnStatus.PENDING) {
      throw new BadRequestException(`Only pending returns can be deleted (this one is ${item.status})`);
    }
    await this.repo.remove(item);
    return { deleted: true };
  }

  // Increases finished-good stock (with a new traceable batch, same as
  // any other stock-in) and (optionally) records a real bank/cash
  // withdrawal — both inside one DB transaction, then auto-posts the
  // Journal Entry.
  async approve(id: string, decidedBy: ActorRef) {
    let totalCost = 0;
    const saved = await this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(SalesReturn, { where: { id }, relations: ['items'] });
      if (!item) throw new NotFoundException('Sales return not found');
      if (item.status !== SalesReturnStatus.PENDING) {
        throw new BadRequestException(`Only pending returns can be approved (this one is ${item.status})`);
      }

      for (const line of item.items) {
        const good = await manager.findOne(FinishedGood, {
          where: { id: line.finishedGoodId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!good) throw new NotFoundException('Product not found');
        // Cost of Goods Sold reversal — valued at the product's current
        // costPerUnit (the weighted-average basis, same one the original
        // sale's COGS entry used), since the original batch(es) shipped
        // aren't individually tracked back at return time.
        totalCost += Number(line.quantity) * Number(good.costPerUnit);
        good.quantityInStock = Number(good.quantityInStock) + Number(line.quantity);
        await manager.save(good);
        await this.batchTrackingService.createFinishedGoodBatch(manager, {
          finishedGoodId: good.id,
          quantity: Number(line.quantity),
          source: BatchSource.MANUAL,
        });
      }

      let bankTransactionId: string | undefined;
      if (item.bankAccountId) {
        const account = await manager.findOne(BankAccount, {
          where: { id: item.bankAccountId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!account) throw new NotFoundException('Bank/cash account not found');
        if (Number(account.currentBalance) < Number(item.total)) {
          throw new BadRequestException(`Insufficient balance in ${account.name} to refund this return.`);
        }
        account.currentBalance = Number(account.currentBalance) - Number(item.total);
        await manager.save(account);
        const txn = await manager.save(
          manager.create(BankTransaction, {
            bankAccountId: account.id,
            type: BankTransactionType.WITHDRAWAL,
            amount: Number(item.total),
            date: item.date,
            note: `Sales return refund — ${item.returnNumber}`,
          }),
        );
        bankTransactionId = txn.id;
      }

      item.status = SalesReturnStatus.APPROVED;
      item.bankTransactionId = bankTransactionId;
      item.decidedByUserId = decidedBy.userId;
      item.decidedByEmail = decidedBy.email;
      item.decidedAt = new Date();
      return manager.save(item);
    });

    await this.activityLog.log({
      action: 'sales_return.approved',
      entityType: 'sales_return',
      entityId: saved.id,
      userId: decidedBy.userId,
      userEmail: decidedBy.email,
      details: { returnNumber: saved.returnNumber, total: saved.total },
    });

    try {
      const returnAccountId = await this.journalPosting.findAccountIdByCode(SALES_RETURN_CODE);
      const lines: PostingLine[] = [{ accountId: returnAccountId, debit: Number(saved.subtotal), description: 'Sales return' }];
      if (Number(saved.vatAmount) > 0) {
        const vatAccountId = await this.journalPosting.findAccountIdByCode(VAT_PAYABLE_CODE);
        lines.push({ accountId: vatAccountId, debit: Number(saved.vatAmount), description: 'VAT reversed on return' });
      }
      if (saved.bankAccountId) {
        const bankJournalAccountId = await this.bankAccountService.ensureJournalAccountId(saved.bankAccountId);
        lines.push({ accountId: bankJournalAccountId, credit: Number(saved.total), description: 'Refund paid' });
      } else {
        const arAccountId = await this.journalPosting.findAccountIdByCode(ACCOUNTS_RECEIVABLE_CODE);
        lines.push({ accountId: arAccountId, credit: Number(saved.total), description: 'Credit against receivable' });
      }
      // Cost of Goods Sold reversal — the returned stock is back in the
      // warehouse, so relieve COGS and put its cost back on the Finished
      // Goods Inventory asset. A self-balancing pair on top of the
      // subtotal/VAT/bank lines above, so the entry as a whole still nets
      // to zero.
      if (totalCost > 0) {
        const fgAccountId = await this.journalPosting.findAccountIdByCode(FG_INVENTORY_CODE);
        const cogsAccountId = await this.journalPosting.findAccountIdByCode(COGS_CODE);
        lines.push({ accountId: fgAccountId, debit: totalCost, description: 'Finished goods returned to stock' });
        lines.push({ accountId: cogsAccountId, credit: totalCost, description: 'Reversal of cost of goods sold' });
      }
      await this.journalPosting.postForSource(
        'sales_return',
        saved.id,
        saved.date,
        `Sales return ${saved.returnNumber}`,
        lines,
        decidedBy,
        saved.returnNumber,
      );
    } catch (err) {
      console.error(`Auto-posting failed for sales_return ${saved.id}:`, err);
    }

    return saved;
  }

  async reject(id: string, reason: string, decidedBy: ActorRef) {
    const item = await this.findOne(id);
    if (item.status !== SalesReturnStatus.PENDING) {
      throw new BadRequestException(`Only pending returns can be rejected (this one is ${item.status})`);
    }
    item.status = SalesReturnStatus.REJECTED;
    item.rejectionReason = reason;
    item.decidedByUserId = decidedBy.userId;
    item.decidedByEmail = decidedBy.email;
    item.decidedAt = new Date();
    const saved = await this.repo.save(item);
    await this.activityLog.log({
      action: 'sales_return.rejected',
      entityType: 'sales_return',
      entityId: saved.id,
      userId: decidedBy.userId,
      userEmail: decidedBy.email,
      details: { returnNumber: saved.returnNumber, reason },
    });
    return saved;
  }
}
