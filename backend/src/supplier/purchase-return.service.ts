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

  // Already-APPROVED return quantity for a given PO+material, so a
  // second (or third...) return request against the same order can never
  // return more than was actually received.
  private async alreadyReturnedQty(purchaseOrderId: string, rawMaterialId: string) {
    const approved = await this.repo.find({
      where: { purchaseOrderId, status: PurchaseReturnStatus.APPROVED },
      relations: ['items'],
    });
    let qty = 0;
    for (const r of approved) {
      for (const i of r.items) {
        if (i.rawMaterialId === rawMaterialId) qty += Number(i.quantity);
      }
    }
    return qty;
  }

  async create(dto: CreatePurchaseReturnDto, requestedBy: ActorRef) {
    const order = await this.dataSource.manager.findOne(PurchaseOrder, { where: { id: dto.purchaseOrderId } });
    if (!order) throw new NotFoundException('Purchase order not found');
    if (order.status !== PurchaseOrderStatus.RECEIVED) {
      throw new BadRequestException(`Only a received order can be returned (this one is ${order.status})`);
    }

    const rawMaterialIds = dto.items.map((i) => i.rawMaterialId);
    const poItems = await this.poItemRepo.find({
      where: { purchaseOrderId: order.id, rawMaterialId: In(rawMaterialIds) },
    });
    const poItemByMaterial = new Map(poItems.map((i) => [i.rawMaterialId, i]));

    let subtotal = 0;
    let vatAmount = 0;
    const itemRows: { rawMaterialId: string; quantity: number; costPerUnit: number; vatRate: number }[] = [];
    for (const line of dto.items) {
      const poItem = poItemByMaterial.get(line.rawMaterialId);
      if (!poItem) {
        throw new BadRequestException(`This purchase order has no line for the selected material (${line.rawMaterialId})`);
      }
      const alreadyReturned = await this.alreadyReturnedQty(order.id, line.rawMaterialId);
      const remaining = this.round3(Number(poItem.quantity) - alreadyReturned);
      if (Number(line.quantity) > remaining + 0.001) {
        throw new BadRequestException(
          `Cannot return ${line.quantity} — only ${remaining} of this material remains returnable on this order.`,
        );
      }
      const lineTotal = this.round3(Number(line.quantity) * Number(poItem.costPerUnit));
      subtotal += lineTotal;
      vatAmount += this.round3((lineTotal * Number(poItem.vatRate)) / 100);
      itemRows.push({
        rawMaterialId: line.rawMaterialId,
        quantity: Number(line.quantity),
        costPerUnit: Number(poItem.costPerUnit),
        vatRate: Number(poItem.vatRate),
      });
    }
    subtotal = this.round3(subtotal);
    vatAmount = this.round3(vatAmount);

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
      bankAccountId: dto.bankAccountId,
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
    await this.repo.remove(item);
    return { deleted: true };
  }

  // Decreases raw material stock and (optionally) records a real bank/cash
  // deposit — both inside one DB transaction with row locks, then
  // auto-posts the Journal Entry. Refusing a negative stock or balance is
  // impossible here by construction (create() already capped the
  // returnable quantity against what was received), but the lock still
  // guards against a concurrent stock change from elsewhere.
  async approve(id: string, decidedBy: ActorRef) {
    const saved = await this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(PurchaseReturn, { where: { id }, relations: ['items'] });
      if (!item) throw new NotFoundException('Purchase return not found');
      if (item.status !== PurchaseReturnStatus.PENDING) {
        throw new BadRequestException(`Only pending returns can be approved (this one is ${item.status})`);
      }

      for (const line of item.items) {
        const material = await manager.findOne(RawMaterial, {
          where: { id: line.rawMaterialId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!material) throw new NotFoundException('Raw material not found');
        const newQty = Number(material.quantityInStock) - Number(line.quantity);
        if (newQty < 0) {
          throw new BadRequestException(`Insufficient stock of ${material.name} to process this return.`);
        }
        material.quantityInStock = newQty;
        await manager.save(material);
      }

      let bankTransactionId: string | undefined;
      if (item.bankAccountId) {
        const account = await manager.findOne(BankAccount, {
          where: { id: item.bankAccountId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!account) throw new NotFoundException('Bank/cash account not found');
        account.currentBalance = Number(account.currentBalance) + Number(item.total);
        await manager.save(account);
        const txn = await manager.save(
          manager.create(BankTransaction, {
            bankAccountId: account.id,
            type: BankTransactionType.DEPOSIT,
            amount: Number(item.total),
            date: item.date,
            note: `Purchase return refund — ${item.returnNumber}`,
          }),
        );
        bankTransactionId = txn.id;
      }

      item.status = PurchaseReturnStatus.APPROVED;
      item.bankTransactionId = bankTransactionId;
      item.decidedByUserId = decidedBy.userId;
      item.decidedByEmail = decidedBy.email;
      item.decidedAt = new Date();
      return manager.save(item);
    });

    await this.activityLog.log({
      action: 'purchase_return.approved',
      entityType: 'purchase_return',
      entityId: saved.id,
      userId: decidedBy.userId,
      userEmail: decidedBy.email,
      details: { returnNumber: saved.returnNumber, total: saved.total },
    });

    try {
      const inventoryAccountId = await this.journalPosting.findAccountIdByCode(INVENTORY_RAW_MATERIALS_CODE);
      const lines: PostingLine[] = [{ accountId: inventoryAccountId, credit: Number(saved.subtotal), description: 'Raw materials returned to supplier' }];
      if (Number(saved.vatAmount) > 0) {
        const vatAccountId = await this.journalPosting.findAccountIdByCode(VAT_RECEIVABLE_CODE);
        lines.push({ accountId: vatAccountId, credit: Number(saved.vatAmount), description: 'Input VAT reversed on return' });
      }
      if (saved.bankAccountId) {
        const bankJournalAccountId = await this.bankAccountService.ensureJournalAccountId(saved.bankAccountId);
        lines.push({ accountId: bankJournalAccountId, debit: Number(saved.total), description: 'Refund received' });
      } else {
        const apAccountId = await this.journalPosting.findAccountIdByCode(ACCOUNTS_PAYABLE_CODE);
        lines.push({ accountId: apAccountId, debit: Number(saved.total), description: 'Credit against payable' });
      }
      await this.journalPosting.postForSource(
        'purchase_return',
        saved.id,
        saved.date,
        `Purchase return ${saved.returnNumber}`,
        lines,
        decidedBy,
        saved.returnNumber,
      );
    } catch (err) {
      console.error(`Auto-posting failed for purchase_return ${saved.id}:`, err);
    }

    return saved;
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
