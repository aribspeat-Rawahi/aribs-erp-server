import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { PurchaseReturn, PurchaseReturnStatus } from './purchase-return.entity';
import { PurchaseReturnItem } from './purchase-return-item.entity';
import { PurchaseOrder, PurchaseOrderStatus } from './purchase-order.entity';
import { PurchaseOrderItem } from './purchase-order-item.entity';
import { RawMaterial } from '../inventory/raw-material.entity';
import { BankAccount } from '../bank-account/bank-account.entity';
import { BankTransaction, BankTransactionType } from '../bank-account/bank-transaction.entity';
import { CreatePurchaseReturnDto } from './dto/purchase-return.dto';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { BankAccountService } from '../bank-account/bank-account.service';
import { JournalPostingService, PostingLine } from '../journal/journal-posting.service';
import { assertQuantityForUnit } from '../units/units';
import { BatchTrackingService } from '../inventory/batch-tracking.service';
import { SupplierPaymentService } from './supplier-payment.service';
import { SettingsService } from '../settings/settings.service';
import { Supplier } from './supplier.entity';
import { applyBankMovement } from '../common/bank-movement.util';
import { generateInvoicePdf } from '../common/invoice-pdf.util';

interface ActorRef {
  userId?: string;
  email?: string;
}

// Inventory — Raw Materials, and VAT Receivable — not "1408 Purchase
// Return"/"1409 Purchase Return VAT". Those two are Revenue-type
// accounts (see journal/account.service.ts's DEFAULT_ACCOUNTS), so
// crediting them here was inflating the Income Statement's Total Revenue
// every time material was returned to a supplier, instead of reversing
// what a Purchase Order receive actually debited (1200 + 1400).
const INVENTORY_RAW_MATERIALS_CODE = '1200';
const VAT_RECEIVABLE_CODE = '1400';
const ACCOUNTS_PAYABLE_CODE = '2000';

@Injectable()
export class PurchaseReturnService {
  constructor(
    @InjectRepository(PurchaseReturn)
    private repo: Repository<PurchaseReturn>,
    @InjectRepository(PurchaseOrderItem)
    private poItemRepo: Repository<PurchaseOrderItem>,
    @InjectDataSource()
    private dataSource: DataSource,
    private activityLog: ActivityLogService,
    private bankAccountService: BankAccountService,
    private journalPosting: JournalPostingService,
    private batchTracking: BatchTrackingService,
    private supplierPayments: SupplierPaymentService,
    private settingsService: SettingsService,
  ) {}

  private generateReturnNumber() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `PR-${date}-${rand}`;
  }

  private round3(n: number) {
    return Math.round(n * 1000) / 1000;
  }

  findAll() {
    return this.repo.find({ relations: ['items'], order: { date: 'DESC', createdAt: 'DESC' } });
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({ where: { id }, relations: ['items'] });
    if (!item) throw new NotFoundException('Purchase return not found');
    return item;
  }

  // Quantity of a material already on approved OR pending returns of this
  // order, so two open returns can't both claim the same goods.
  private async alreadyReturnedQty(purchaseOrderId: string, rawMaterialId: string) {
    const returns = await this.repo.find({
      where: { purchaseOrderId, status: In([PurchaseReturnStatus.APPROVED, PurchaseReturnStatus.PENDING]) },
      relations: ['items'],
    });
    let qty = 0;
    for (const r of returns) {
      for (const i of r.items) {
        if (i.rawMaterialId === rawMaterialId) qty += Number(i.quantity);
      }
    }
    return qty;
  }

  async create(dto: CreatePurchaseReturnDto, requestedBy: ActorRef) {
    await this.journalPosting.assertDateOpen(dto.date || new Date().toISOString().slice(0, 10), 'This purchase return');
    const order = await this.dataSource.manager.findOne(PurchaseOrder, { where: { id: dto.purchaseOrderId } });
    if (!order) throw new NotFoundException('Purchase order not found');
    if (order.status !== PurchaseOrderStatus.RECEIVED && order.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED) {
      throw new BadRequestException(`Nothing has been received on ${order.poNumber} yet, so nothing can be returned.`);
    }

    const rawMaterialIds = dto.items.map((i) => i.rawMaterialId);
    const poItems = await this.poItemRepo.find({
      where: { purchaseOrderId: order.id, rawMaterialId: In(rawMaterialIds) },
    });
    // the same material can be on several lines: returnable = everything
    // RECEIVED of it on this order (price/VAT from its first line)
    const poItemByMaterial = new Map<string, PurchaseOrderItem>();
    const receivedByMaterial = new Map<string, number>();
    for (const i of poItems) {
      if (!poItemByMaterial.has(i.rawMaterialId)) poItemByMaterial.set(i.rawMaterialId, i);
      receivedByMaterial.set(i.rawMaterialId, (receivedByMaterial.get(i.rawMaterialId) || 0) + Number(i.receivedQuantity || 0));
    }

    let subtotal = 0;
    let vatAmount = 0;
    const itemRows: { rawMaterialId: string; quantity: number; unit: string; costPerUnit: number; vatRate: number }[] = [];
    for (const line of dto.items) {
      const poItem = poItemByMaterial.get(line.rawMaterialId);
      if (!poItem) {
        throw new BadRequestException(`This purchase order has no line for the selected material (${line.rawMaterialId})`);
      }
      const alreadyReturned = await this.alreadyReturnedQty(order.id, line.rawMaterialId);
      const remaining = this.round3((receivedByMaterial.get(line.rawMaterialId) || 0) - alreadyReturned);
      if (Number(line.quantity) > remaining + 0.001) {
        throw new BadRequestException(
          `Cannot return ${line.quantity} — only ${remaining} of this material was received and is not already on a return.`,
        );
      }
      assertQuantityForUnit(line.quantity, poItem.unit, 'this material');
      const lineTotal = this.round3(Number(line.quantity) * Number(poItem.costPerUnit));
      subtotal += lineTotal;
      vatAmount += this.round3((lineTotal * Number(poItem.vatRate)) / 100);
      itemRows.push({
        rawMaterialId: line.rawMaterialId,
        quantity: Number(line.quantity),
        unit: poItem.unit,
        costPerUnit: Number(poItem.costPerUnit),
        vatRate: Number(poItem.vatRate),
      });
    }
    subtotal = this.round3(subtotal);
    vatAmount = this.round3(vatAmount);
    if (itemRows.length === 0) throw new BadRequestException('Add at least one item to return');

    const item = this.repo.create({
      returnNumber: this.generateReturnNumber(),
      purchaseOrderId: order.id,
      supplierId: order.supplierId,
      status: PurchaseReturnStatus.PENDING,
      date: dto.date || new Date().toISOString().slice(0, 10),
      reason: dto.reason,
      subtotal,
      vatAmount,
      total: this.round3(subtotal + vatAmount),
      requestedByUserId: requestedBy.userId,
      requestedByEmail: requestedBy.email,
      items: itemRows.map((i) => this.repo.manager.create(PurchaseReturnItem, i)),
    });
    const saved = await this.repo.save(item);
    await this.activityLog.log({
      action: 'purchase_return.created',
      entityType: 'purchase_return',
      entityId: saved.id,
      userId: requestedBy.userId,
      userEmail: requestedBy.email,
      details: { returnNumber: saved.returnNumber, purchaseOrderId: saved.purchaseOrderId, total: saved.total },
    });
    return saved;
  }

  async remove(id: string) {
    const item = await this.findOne(id);
    if (item.status !== PurchaseReturnStatus.PENDING) {
      throw new BadRequestException(`Only pending returns can be deleted (this one is ${item.status})`);
    }
    // items removed explicitly (not left to the DB cascade) so they are
    // kept with the delete record and come back on "Undo"
    if (item.items?.length) await this.repo.manager.remove(item.items);
    item.items = [];
    await this.repo.remove(item);
    return { deleted: true };
  }

  // Decreases raw material stock and (optionally) records a real bank/cash
  // deposit — both inside one DB transaction with row locks, then
  // auto-posts the Journal Entry. Refusing a negative stock or balance is
  // impossible here by construction (create() already capped the
  // returnable quantity against what was received), but the lock still
  // guards against a concurrent stock change from elsewhere.
  // How approving would settle the money: first it lowers what is still
  // owed on the order (debit note); only the rest - when the order was
  // already paid beyond that - is refunded by the supplier.
  async getSettlement(id: string) {
    const item = await this.findOne(id);
    const order = await this.dataSource.manager.findOne(PurchaseOrder, { where: { id: item.purchaseOrderId } });
    if (!order) throw new NotFoundException('Purchase order not found');
    return { ...this.splitSettlement(Number(item.total), order), poNumber: order.poNumber };
  }

  private splitSettlement(total: number, order: PurchaseOrder) {
    const outstanding = this.round3(Math.max(0, Number(order.receivedTotal || 0) - Number(order.paidAmount || 0)));
    const appliedToOrder = this.round3(Math.min(total, outstanding));
    const refundAmount = this.round3(total - appliedToOrder);
    return { total, outstanding, appliedToOrder, refundAmount, refundAccountRequired: refundAmount > 0.0005 };
  }

  // Approve: the goods leave stock (out of this order's batches first, cost
  // adjusted), the debit note lowers what is owed on the order, any rest
  // is refunded into the chosen account. One journal entry:
  //   Dr Accounts Payable (debit note) + Dr Bank (refund)
  //   Cr Raw Materials Inventory (cost) + Cr Input VAT (reversed)
  // All stock/money writes in one transaction.
  async approve(id: string, decidedBy: ActorRef, opts: { bankAccountId?: string } = {}) {
    let poNumber = '';
    // Resolved BEFORE the transaction: linking a bank account to its ledger
    // account writes the bank_accounts row, which the transaction below
    // locks - doing it inside would wait on our own lock.
    const refundJournalAccountId = opts.bankAccountId ? await this.bankAccountService.ensureJournalAccountId(opts.bankAccountId) : undefined;
    const saved = await this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(PurchaseReturn, { where: { id }, relations: ['items'], lock: { mode: 'pessimistic_write' } });
      if (!item) throw new NotFoundException('Purchase return not found');
      if (item.status !== PurchaseReturnStatus.PENDING) {
        throw new BadRequestException(`Only pending returns can be approved (this one is ${item.status})`);
      }
      // closed books (filed VAT return / opening balance date)
      await this.journalPosting.assertDateOpen(item.date, 'This purchase return', manager);
      const order = await manager.findOne(PurchaseOrder, { where: { id: item.purchaseOrderId }, lock: { mode: 'pessimistic_write' } });
      if (!order) throw new NotFoundException('Purchase order not found');
      poNumber = order.poNumber;
      const total = Number(item.total);
      const { appliedToOrder, refundAmount } = this.splitSettlement(total, order);
      if (refundAmount > 0.0005 && !opts.bankAccountId) {
        throw new BadRequestException(
          `${order.poNumber} has already been paid for these goods - choose the bank/cash account the supplier refunds ${refundAmount.toFixed(3)} OMR into.`,
        );
      }

      for (const line of item.items) {
        const material = await manager.findOne(RawMaterial, { where: { id: line.rawMaterialId }, lock: { mode: 'pessimistic_write' } });
        if (!material) throw new NotFoundException('Raw material not found');
        const qty = Number(line.quantity);
        const before = Number(material.quantityInStock);
        if (before - qty < -0.0005) {
          throw new BadRequestException(`Only ${before} ${material.unit} of ${material.name} is in stock - it can't send back ${qty}.`);
        }
        // batches first (before the stock number changes)
        await this.batchTracking.consumeRawMaterialForReturn(manager, { rawMaterialId: material.id, quantity: qty, purchaseOrderId: order.id });
        // the goods leave at the price paid for them, so the remaining
        // stock keeps the right value (weighted-average cost)
        const after = this.round3(before - qty);
        const valueAfter = before * Number(material.costPerUnit) - qty * Number(line.costPerUnit);
        material.costPerUnit = after > 0.0005 ? Math.max(0, valueAfter) / after : Number(material.costPerUnit);
        material.quantityInStock = after;
        await manager.save(material);
      }

      if (appliedToOrder > 0.0005) {
        await this.supplierPayments.addCreditRow(manager, {
          purchaseOrderId: order.id,
          amount: appliedToOrder,
          date: item.date,
          note: `Debit note - purchase return ${item.returnNumber}`,
          source: 'debit_note',
          sourceId: item.id,
        });
      }

      let bankTransactionId: string | undefined;
      if (refundAmount > 0.0005) {
        bankTransactionId = await applyBankMovement(manager, {
          accountId: String(opts.bankAccountId),
          type: BankTransactionType.DEPOSIT,
          amount: refundAmount,
          date: item.date,
          note: `Purchase return refund — ${item.returnNumber}`,
        });
      }

      item.status = PurchaseReturnStatus.APPROVED;
      item.appliedToOrder = appliedToOrder;
      item.refundAmount = refundAmount;
      item.bankAccountId = refundAmount > 0.0005 ? opts.bankAccountId : undefined;
      item.bankTransactionId = bankTransactionId;
      item.decidedByUserId = decidedBy.userId;
      item.decidedByEmail = decidedBy.email;
      item.decidedAt = new Date();
      const saved = await manager.save(item);

      // Journal entry in the SAME transaction: if it can't be posted
      // (closed books, missing account, unbalanced), the whole approval is
      // rolled back - stock, debit note and refund never change without
      // the books.
      const lines: PostingLine[] = [
        { accountId: await this.journalPosting.findAccountIdByCode(INVENTORY_RAW_MATERIALS_CODE), credit: Number(saved.subtotal), description: 'Raw materials returned to supplier' },
      ];
      if (Number(saved.vatAmount) > 0) {
        lines.push({ accountId: await this.journalPosting.findAccountIdByCode(VAT_RECEIVABLE_CODE), credit: Number(saved.vatAmount), description: 'Input VAT reversed (debit note)' });
      }
      if (Number(saved.appliedToOrder) > 0) {
        lines.push({ accountId: await this.journalPosting.findAccountIdByCode(ACCOUNTS_PAYABLE_CODE), debit: Number(saved.appliedToOrder), description: `Debit note — ${poNumber}` });
      }
      if (Number(saved.refundAmount) > 0 && saved.bankAccountId && refundJournalAccountId) {
        lines.push({ accountId: refundJournalAccountId, debit: Number(saved.refundAmount), description: 'Refund from supplier' });
      }
      await this.journalPosting.postForSource('purchase_return', saved.id, saved.date, `Purchase return ${saved.returnNumber} — ${poNumber}`, lines, decidedBy, saved.returnNumber, manager);
      return saved;
    });

    await this.activityLog.log({
      action: 'purchase_return.approved',
      entityType: 'purchase_return',
      entityId: saved.id,
      userId: decidedBy.userId,
      userEmail: decidedBy.email,
      details: {
        returnNumber: saved.returnNumber,
        poNumber,
        total: Number(saved.total),
        appliedToOrder: Number(saved.appliedToOrder),
        refundAmount: Number(saved.refundAmount),
      },
    });

    return saved;
  }

  // Debit Note PDF - what was sent back, at the order's prices.
  async generateDebitNotePdf(id: string) {
    const item = await this.findOne(id);
    const order = await this.dataSource.manager.findOne(PurchaseOrder, { where: { id: item.purchaseOrderId } });
    const supplier = await this.dataSource.manager.findOne(Supplier, { where: { id: item.supplierId } });
    if (!order || !supplier) throw new NotFoundException('Purchase order or supplier not found');
    const settings = await this.settingsService.get();
    const logoBase64 = await this.settingsService.getLogoBase64();
    const materials = await this.dataSource.manager.find(RawMaterial, { where: { id: In(item.items.map((i) => i.rawMaterialId).concat('')) } });
    const pdfItems = item.items.map((i) => ({
      description: materials.find((m) => m.id === i.rawMaterialId)?.name || 'Item',
      quantity: Number(i.quantity),
      unit: i.unit,
      unitPrice: Number(i.costPerUnit),
      vatRate: Number(i.vatRate),
      lineTotal: this.round3(Number(i.quantity) * Number(i.costPerUnit)),
    }));
    return generateInvoicePdf({
      invoiceNumber: item.returnNumber,
      version: 1,
      issueDate: item.date,
      quotationNumber: order.poNumber,
      referenceLabel: 'PO No',
      companyName: settings.companyName,
      companyVatin: settings.companyVatin || 'OM1000000000',
      companyAddress: settings.companyAddress,
      companyPhone: settings.companyPhone,
      customerName: supplier.name,
      customerAddress: supplier.address,
      customerPhone: supplier.phone,
      customerVatin: supplier.vatin || undefined,
      items: pdfItems,
      grossAmount: Number(item.subtotal),
      discountAmount: 0,
      taxableAmount: Number(item.subtotal),
      vatAmount: Number(item.vatAmount),
      netAmount: Number(item.total),
      vatExcluded: false,
      logoBase64,
      template: settings.defaultInvoiceTemplate,
      documentType: 'debit_note',
      partyLabel: 'SUPPLIER',
    });
  }

  async reject(id: string, reason: string, decidedBy: ActorRef) {
    const item = await this.findOne(id);
    if (item.status !== PurchaseReturnStatus.PENDING) {
      throw new BadRequestException(`Only pending returns can be rejected (this one is ${item.status})`);
    }
    item.status = PurchaseReturnStatus.REJECTED;
    item.rejectionReason = reason;
    item.decidedByUserId = decidedBy.userId;
    item.decidedByEmail = decidedBy.email;
    item.decidedAt = new Date();
    const saved = await this.repo.save(item);
    await this.activityLog.log({
      action: 'purchase_return.rejected',
      entityType: 'purchase_return',
      entityId: saved.id,
      userId: decidedBy.userId,
      userEmail: decidedBy.email,
      details: { returnNumber: saved.returnNumber, reason },
    });
    return saved;
  }
}
