import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ApprovalRequest, ApprovalRequestStatus, ApprovalRequestType } from './approval-request.entity';
import { QuotationEditRequest, QuotationEditStatus } from '../quotation/quotation-edit-request.entity';
import { Quotation } from '../quotation/quotation.entity';
import { Customer } from '../customer/customer.entity';
import { EmailService } from '../common/email.service';

// A normalized row for the combined Approvals dashboard — one shape for
// both ApprovalRequest rows and the pre-existing QuotationEditRequest
// rows, so the frontend renders one list regardless of which table a
// pending item actually lives in.
export interface CombinedApprovalRow {
  id: string;
  kind: 'approval_request' | 'quotation_edit';
  type: string; // ApprovalRequestType value, or 'quotation_price_edit'
  entityType: 'invoice' | 'quotation' | 'salary_advance' | 'stock_in';
  targetId?: string;
  customerName?: string;
  reference?: string; // quotation/invoice number when known
  reason: string;
  requestedByEmail?: string;
  createdAt: Date;
}

@Injectable()
export class ApprovalService {
  constructor(
    @InjectRepository(ApprovalRequest)
    private repo: Repository<ApprovalRequest>,
    // Read-only repo injections (not their services/modules) purely to
    // build a friendlier dashboard label — same pattern used elsewhere
    // in this codebase to avoid circular module dependencies.
    @InjectRepository(QuotationEditRequest)
    private quotationEditRepo: Repository<QuotationEditRequest>,
    @InjectRepository(Quotation)
    private quotationRepo: Repository<Quotation>,
    @InjectRepository(Customer)
    private customerRepo: Repository<Customer>,
    private emailService: EmailService,
  ) {}

  async create(input: {
    type: ApprovalRequestType;
    entityType: 'invoice' | 'quotation' | 'salary_advance' | 'stock_in';
    targetId?: string;
    customerId?: string;
    payload: unknown;
    reason: string;
    requestedBy?: { userId?: string; email?: string };
  }) {
    const item = this.repo.create({
      type: input.type,
      entityType: input.entityType,
      targetId: input.targetId,
      customerId: input.customerId,
      payload: JSON.stringify(input.payload),
      reason: input.reason,
      status: ApprovalRequestStatus.PENDING,
      requestedByUserId: input.requestedBy?.userId,
      requestedByEmail: input.requestedBy?.email,
    });
    const saved = await this.repo.save(item);
    await this.emailService.sendApprovalRequestNotice(input.type, input.entityType, input.reason, input.requestedBy?.email);
    return saved;
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Approval request not found');
    return item;
  }

  // Called by InvoiceService/QuotationService right before they replay
  // the stored payload. Atomically flips PENDING -> PROCESSING with a
  // conditional UPDATE (status = PENDING in the WHERE clause) and checks
  // the affected row count, so two concurrent approve/reject calls (or a
  // double-click) can't both read PENDING and both proceed to replay the
  // payload — only the first UPDATE finds a matching row.
  async claimPending(id: string, entityType: 'invoice' | 'quotation' | 'salary_advance' | 'stock_in') {
    const item = await this.findOne(id);
    if (item.entityType !== entityType) {
      throw new BadRequestException(`This approval request is not for a ${entityType}`);
    }
    const result = await this.repo.update(
      { id, status: ApprovalRequestStatus.PENDING },
      { status: ApprovalRequestStatus.PROCESSING },
    );
    if (result.affected !== 1) {
      throw new BadRequestException(`This request is already ${item.status === ApprovalRequestStatus.PENDING ? 'being processed' : item.status}`);
    }
    return { ...item, status: ApprovalRequestStatus.PROCESSING };
  }

  // An approval whose replay failed (e.g. the item was deleted, books
  // closed) goes back to PENDING so it can be retried or rejected, instead
  // of staying stuck in PROCESSING.
  async releaseClaim(id: string) {
    await this.repo.update({ id, status: ApprovalRequestStatus.PROCESSING }, { status: ApprovalRequestStatus.PENDING });
  }

  async markDecided(id: string, status: ApprovalRequestStatus, decidedBy?: { userId?: string; email?: string }) {
    const item = await this.findOne(id);
    item.status = status;
    item.approvedByUserId = decidedBy?.userId;
    item.approvedByEmail = decidedBy?.email;
    item.decidedAt = new Date();
    return this.repo.save(item);
  }

  async reject(id: string, entityType: 'invoice' | 'quotation' | 'salary_advance' | 'stock_in', decidedBy?: { userId?: string; email?: string }) {
    await this.claimPending(id, entityType);
    return this.markDecided(id, ApprovalRequestStatus.REJECTED, decidedBy);
  }

  // Combined, normalized pending list for the Approvals dashboard —
  // merges this table's pending rows with the pre-existing
  // QuotationEditRequest table's pending rows (untouched, its own
  // approve/reject endpoints on QuotationController still apply to it).
  async findPendingCombined(): Promise<CombinedApprovalRow[]> {
    const [requests, edits] = await Promise.all([
      this.repo.find({ where: { status: ApprovalRequestStatus.PENDING }, order: { createdAt: 'ASC' } }),
      this.quotationEditRepo.find({ where: { status: QuotationEditStatus.PENDING }, order: { createdAt: 'ASC' } }),
    ]);

    // salary_advance requests have no customerId — filter those out
    // before querying Customer, rather than passing undefined into
    // In(...).
    const requestCustomerIds = requests.map((r) => r.customerId).filter((id): id is string => !!id);
    const quotationIds = Array.from(new Set(edits.map((e) => e.quotationId)));
    const quotations = quotationIds.length ? await this.quotationRepo.find({ where: { id: In(quotationIds) } }) : [];
    const quotationById = new Map(quotations.map((q) => [q.id, q]));

    const customerIds = Array.from(new Set([...requestCustomerIds, ...quotations.map((q) => q.customerId)]));
    const customers = customerIds.length ? await this.customerRepo.find({ where: { id: In(customerIds) } }) : [];
    const customerNameById = new Map(customers.map((c: Customer) => [c.id, c.name]));

    const fromRequests: CombinedApprovalRow[] = requests.map((r) => ({
      id: r.id,
      kind: 'approval_request',
      type: r.type,
      entityType: r.entityType as 'invoice' | 'quotation' | 'salary_advance' | 'stock_in',
      targetId: r.targetId || undefined,
      customerName: r.customerId ? customerNameById.get(r.customerId) : undefined,
      reason: r.reason,
      requestedByEmail: r.requestedByEmail || undefined,
      createdAt: r.createdAt,
    }));

    const fromEdits: CombinedApprovalRow[] = edits.map((e) => {
      const q = quotationById.get(e.quotationId);
      return {
        id: e.id,
        kind: 'quotation_edit',
        type: 'quotation_price_edit',
        entityType: 'quotation',
        targetId: e.quotationId,
        customerName: q ? customerNameById.get(q.customerId) : undefined,
        reference: q?.quotationNumber,
        reason: 'Different-day price/item change on an existing quotation',
        requestedByEmail: e.requestedByEmail || undefined,
        createdAt: e.createdAt,
      };
    });

    return [...fromRequests, ...fromEdits].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
}
