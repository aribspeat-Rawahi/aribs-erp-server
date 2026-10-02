import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import { Customer } from './customer.entity';
import { CustomerBankAccount } from './customer-bank-account.entity';
import { CustomerDocument } from './customer-document.entity';
import { CustomerInteraction } from './customer-interaction.entity';
import { CreateCustomerDto } from './dto/customer.dto';
import { EmailService } from '../common/email.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { Invoice } from '../invoice/invoice.entity';
import { Quotation } from '../quotation/quotation.entity';
import { DeliveryNote } from '../delivery-note/delivery-note.entity';

@Injectable()
export class CustomerService {
  constructor(
    @InjectRepository(Customer)
    private repo: Repository<Customer>,
    // Plain repo injections (not the sibling services) so there's no
    // circular dependency — CustomerBankAccountService/CustomerDocumentService
    // depend on CustomerService, not the other way round. Same pattern as
    // EmployeeService's cleanup of EmployeeDocument in HR.
    @InjectRepository(CustomerBankAccount)
    private bankAccountRepo: Repository<CustomerBankAccount>,
    @InjectRepository(CustomerDocument)
    private documentRepo: Repository<CustomerDocument>,
    @InjectRepository(CustomerInteraction)
    private interactionRepo: Repository<CustomerInteraction>,
    @InjectRepository(Invoice)
    private invoiceRepo: Repository<Invoice>,
    @InjectRepository(Quotation)
    private quotationRepo: Repository<Quotation>,
    @InjectRepository(DeliveryNote)
    private deliveryNoteRepo: Repository<DeliveryNote>,
    private emailService: EmailService,
    private activityLog: ActivityLogService,
  ) {}

  findAll() {
    return this.repo.find();
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Customer not found');
    return item;
  }

  create(dto: CreateCustomerDto) {
    const item = this.repo.create(dto);
    return this.repo.save(item);
  }

  async update(id: string, dto: Partial<CreateCustomerDto>) {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  // All quotations/invoices/delivery notes issued to this customer —
  // shown as the customer's document history and used to build the
  // "view/download" list on the customer detail screen.
  async history(id: string) {
    await this.findOne(id); // 404s if the customer doesn't exist
    const [invoices, quotations, deliveryNotes] = await Promise.all([
      this.invoiceRepo.find({ where: { customerId: id }, order: { createdAt: 'DESC' } }),
      this.quotationRepo.find({ where: { customerId: id }, order: { createdAt: 'DESC' } }),
      this.deliveryNoteRepo.find({ where: { customerId: id }, order: { createdAt: 'DESC' } }),
    ]);
    return { invoices, quotations, deliveryNotes };
  }

  // Admin-only (enforced by @Roles on the controller). Notifies
  // MD/CEO/GM by email since deleting a customer can't be undone.
  //
  // The customer's bank accounts and documents (Bank Details / Documents
  // sections) have no TypeORM cascade — plain FK columns, not relations —
  // so their rows and uploaded files are cleaned up here explicitly, same
  // as Employee's own photo/document cleanup in HR.
  async remove(id: string, deletedBy?: { userId?: string; email?: string }) {
    const item = await this.findOne(id);

    const bankAccounts = await this.bankAccountRepo.find({ where: { customerId: id } });
    for (const acc of bankAccounts) {
      if (acc.statementPath && fs.existsSync(acc.statementPath)) fs.unlinkSync(acc.statementPath);
    }
    if (bankAccounts.length > 0) await this.bankAccountRepo.remove(bankAccounts);

    const documents = await this.documentRepo.find({ where: { customerId: id } });
    for (const doc of documents) {
      if (fs.existsSync(doc.filePath)) fs.unlinkSync(doc.filePath);
    }
    if (documents.length > 0) await this.documentRepo.remove(documents);

    const interactions = await this.interactionRepo.find({ where: { customerId: id } });
    if (interactions.length > 0) await this.interactionRepo.remove(interactions);

    await this.repo.remove(item);
    await this.activityLog.log({
      action: 'customer.deleted',
      entityType: 'customer',
      entityId: id,
      userId: deletedBy?.userId,
      userEmail: deletedBy?.email,
      details: { name: item.name },
    });
    await this.emailService.sendCustomerDeletedNotice(item.name, deletedBy?.email);
    return { deleted: true };
  }
}
