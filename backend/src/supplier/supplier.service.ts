import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as fs from 'fs';
import { Supplier } from './supplier.entity';
import { SupplierBankAccount } from './supplier-bank-account.entity';
import { SupplierDocument } from './supplier-document.entity';
import { SupplierInteraction } from './supplier-interaction.entity';
import { PurchaseOrder } from './purchase-order.entity';
import { PurchaseOrderItem } from './purchase-order-item.entity';
import { CreateSupplierDto } from './dto/supplier.dto';
import { EmailService } from '../common/email.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

@Injectable()
export class SupplierService {
  constructor(
    @InjectRepository(Supplier)
    private repo: Repository<Supplier>,
    // Plain repo injections (not the sibling services) so there's no
    // circular dependency — same pattern as CustomerService's cleanup of
    // its own bank accounts/documents/interactions.
    @InjectRepository(SupplierBankAccount)
    private bankAccountRepo: Repository<SupplierBankAccount>,
    @InjectRepository(SupplierDocument)
    private documentRepo: Repository<SupplierDocument>,
    @InjectRepository(SupplierInteraction)
    private interactionRepo: Repository<SupplierInteraction>,
    @InjectRepository(PurchaseOrder)
    private purchaseOrderRepo: Repository<PurchaseOrder>,
    @InjectRepository(PurchaseOrderItem)
    private purchaseOrderItemRepo: Repository<PurchaseOrderItem>,
    private emailService: EmailService,
    private activityLog: ActivityLogService,
  ) {}

  findAll() {
    return this.repo.find();
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Supplier not found');
    return item;
  }

  create(dto: CreateSupplierDto) {
    const item = this.repo.create(dto);
    return this.repo.save(item);
  }

  async update(id: string, dto: Partial<CreateSupplierDto>) {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  // All purchase orders placed with this supplier (each with its line
  // items) — shown on the supplier detail screen, same idea as
  // CustomerService.history() for invoices/quotations/delivery notes.
  async history(id: string) {
    await this.findOne(id); // 404s if the supplier doesn't exist
    const orders = await this.purchaseOrderRepo.find({ where: { supplierId: id }, order: { createdAt: 'DESC' } });
    const orderIds = orders.map((o) => o.id);
    const items = orderIds.length
      ? await this.purchaseOrderItemRepo.find({ where: { purchaseOrderId: In(orderIds) } })
      : [];
    const itemsByOrder = new Map<string, PurchaseOrderItem[]>();
    for (const item of items) {
      const list = itemsByOrder.get(item.purchaseOrderId) || [];
      list.push(item);
      itemsByOrder.set(item.purchaseOrderId, list);
    }
    return { purchaseOrders: orders.map((o) => ({ ...o, items: itemsByOrder.get(o.id) || [] })) };
  }

  // Admin-only (enforced by @Roles on the controller). Notifies MD/CEO/GM
  // by email since deleting a supplier can't be undone. Purchase orders
  // already placed with this supplier are left as-is (same convention as
  // CustomerService.remove() leaving invoices/quotations untouched) — only
  // this supplier's own bank accounts/documents/interactions (which have
  // no TypeORM cascade — plain FK columns, not relations) are cleaned up.
  async remove(id: string, deletedBy?: { userId?: string; email?: string }) {
    const item = await this.findOne(id);

    const bankAccounts = await this.bankAccountRepo.find({ where: { supplierId: id } });
    for (const acc of bankAccounts) {
      if (acc.statementPath && fs.existsSync(acc.statementPath)) fs.unlinkSync(acc.statementPath);
    }
    if (bankAccounts.length > 0) await this.bankAccountRepo.remove(bankAccounts);

    const documents = await this.documentRepo.find({ where: { supplierId: id } });
    for (const doc of documents) {
      if (fs.existsSync(doc.filePath)) fs.unlinkSync(doc.filePath);
    }
    if (documents.length > 0) await this.documentRepo.remove(documents);

    const interactions = await this.interactionRepo.find({ where: { supplierId: id } });
    if (interactions.length > 0) await this.interactionRepo.remove(interactions);

    await this.repo.remove(item);
    await this.activityLog.log({
      action: 'supplier.deleted',
      entityType: 'supplier',
      entityId: id,
      userId: deletedBy?.userId,
      userEmail: deletedBy?.email,
      details: { name: item.name },
    });
    await this.emailService.sendSupplierDeletedNotice(item.name, deletedBy?.email);
    return { deleted: true };
  }
}
