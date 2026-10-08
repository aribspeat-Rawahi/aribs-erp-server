import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { Reimbursement, ReimbursementStatus } from './reimbursement.entity';
import {
  CreateReimbursementDto,
  UpdateReimbursementDto,
  MarkReimbursementPaidDto,
} from './dto/reimbursement.dto';
import { verifyFileSignature } from '../common/file-signature.util';
import { BankAccountService } from '../bank-account/bank-account.service';
import { BankTransactionType } from '../bank-account/bank-transaction.entity';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { JournalPostingService } from '../journal/journal-posting.service';
import { discardFile } from '../common/discard-file.util';
import { omanToday, omanDate } from '../common/oman-date';

interface ActorRef {
  userId?: string;
  email?: string;
}

// Auto-posted Employee-Reimbursements expense account code (Dr side of
// every reimbursement paid with a bank/cash leg — see postJournalEntry()).
// Matches the DEFAULT_ACCOUNTS seed in journal/account.service.ts.
const EMPLOYEE_REIMBURSEMENTS_CODE = '5700';

@Injectable()
export class ReimbursementService {
  private uploadDir: string;

  constructor(
    @InjectRepository(Reimbursement)
    private repo: Repository<Reimbursement>,
    private bankAccountService: BankAccountService,
    private activityLog: ActivityLogService,
    private config: ConfigService,
    private journalPosting: JournalPostingService,
  ) {
    this.uploadDir = this.config.get('REIMBURSEMENT_RECEIPT_UPLOAD_DIR') || './uploads/reimbursement-receipts';
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  // Same generator convention as BatchTrackingService's batch numbers.
  private generateClaimNumber() {
    const date = omanToday().replace(/-/g, '');
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `RB-${date}-${rand}`;
  }

  findAll() {
    return this.repo.find({ order: { date: 'DESC', createdAt: 'DESC' } });
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Reimbursement claim not found');
    return item;
  }

  async create(dto: CreateReimbursementDto, requestedBy: ActorRef) {
    const item = this.repo.create({
      ...dto,
      claimNumber: this.generateClaimNumber(),
      date: dto.date || omanToday(),
      status: ReimbursementStatus.PENDING,
      requestedByUserId: requestedBy.userId,
      requestedByEmail: requestedBy.email,
    });
    const saved = await this.repo.save(item);
    await this.activityLog.log({
      action: 'reimbursement.created',
      entityType: 'reimbursement',
      entityId: saved.id,
      userId: requestedBy.userId,
      userEmail: requestedBy.email,
      details: { claimNumber: saved.claimNumber, employeeId: saved.employeeId, amount: saved.amount, category: saved.category },
    });
    return saved;
  }

  // Only while still PENDING — once approved/rejected/paid, changing the
  // amount or employee after the fact would make the decision/payment
  // trail inconsistent with what was actually approved.
  async update(id: string, dto: UpdateReimbursementDto) {
    const item = await this.findOne(id);
    if (item.status !== ReimbursementStatus.PENDING) {
      throw new BadRequestException(`Only pending claims can be edited (this one is ${item.status})`);
    }
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  async remove(id: string) {
    const item = await this.findOne(id);
    if (item.status !== ReimbursementStatus.PENDING) {
      throw new BadRequestException(
        `Only pending claims can be deleted (this one is ${item.status}) — approved/rejected/paid claims are kept for the audit trail.`,
      );
    }
    // parked, not deleted, so "Undo" can bring it back
    discardFile(item.receiptFilePath);
    await this.repo.remove(item);
    await this.activityLog.log({
      action: 'reimbursement.deleted',
      entityType: 'reimbursement',
      entityId: id,
      details: { claimNumber: item.claimNumber, employeeId: item.employeeId, amount: item.amount },
    });
    return { deleted: true };
  }

  async approve(id: string, decidedBy: ActorRef) {
    const item = await this.findOne(id);
    if (item.status !== ReimbursementStatus.PENDING) {
      throw new BadRequestException(`Only pending claims can be approved (this one is ${item.status})`);
    }
    item.status = ReimbursementStatus.APPROVED;
    item.decidedByUserId = decidedBy.userId;
    item.decidedByEmail = decidedBy.email;
    item.decidedAt = new Date();
    const saved = await this.repo.save(item);
    await this.activityLog.log({
      action: 'reimbursement.approved',
      entityType: 'reimbursement',
      entityId: saved.id,
      userId: decidedBy.userId,
      userEmail: decidedBy.email,
      details: { claimNumber: saved.claimNumber, employeeId: saved.employeeId, amount: saved.amount },
    });
    return saved;
  }

  async reject(id: string, reason: string, decidedBy: ActorRef) {
    const item = await this.findOne(id);
    if (item.status !== ReimbursementStatus.PENDING) {
      throw new BadRequestException(`Only pending claims can be rejected (this one is ${item.status})`);
    }
    item.status = ReimbursementStatus.REJECTED;
    item.rejectionReason = reason;
    item.decidedByUserId = decidedBy.userId;
    item.decidedByEmail = decidedBy.email;
    item.decidedAt = new Date();
    const saved = await this.repo.save(item);
    await this.activityLog.log({
      action: 'reimbursement.rejected',
      entityType: 'reimbursement',
      entityId: saved.id,
      userId: decidedBy.userId,
      userEmail: decidedBy.email,
      details: { claimNumber: saved.claimNumber, employeeId: saved.employeeId, reason },
    });
    return saved;
  }

  // Only an APPROVED claim can be paid. If a bankAccountId is given, this
  // also records a real withdrawal on that account (via BankAccountService,
  // which already guards against insufficient balance) so Cash & Bank
  // stays in sync automatically instead of relying on a second manual
  // entry there. Leaving bankAccountId blank keeps this a record-only
  // payment, same as how Expense never touches bank-account at all.
  async markPaid(id: string, dto: MarkReimbursementPaidDto, decidedBy: ActorRef) {
    const item = await this.findOne(id);
    if (item.status !== ReimbursementStatus.APPROVED) {
      throw new BadRequestException(`Only approved claims can be marked paid (this one is ${item.status})`);
    }

    if (dto.bankAccountId) {
      const txn = await this.bankAccountService.addTransaction(dto.bankAccountId, {
        type: BankTransactionType.WITHDRAWAL,
        amount: Number(item.amount),
        date: omanToday(),
        note: `Reimbursement ${item.claimNumber} — ${item.category}`,
      });
      item.bankAccountId = dto.bankAccountId;
      item.bankTransactionId = txn.id;
    }

    item.status = ReimbursementStatus.PAID;
    item.paymentMethod = dto.paymentMethod;
    item.paymentNote = dto.note;
    item.paidAt = new Date();
    const saved = await this.repo.save(item);
    await this.activityLog.log({
      action: 'reimbursement.paid',
      entityType: 'reimbursement',
      entityId: saved.id,
      userId: decidedBy.userId,
      userEmail: decidedBy.email,
      details: {
        claimNumber: saved.claimNumber,
        employeeId: saved.employeeId,
        amount: saved.amount,
        paymentMethod: saved.paymentMethod,
        bankAccountId: saved.bankAccountId,
      },
    });

    // Only when a real bank/cash withdrawal was recorded above — a
    // record-only payment (no bankAccountId) doesn't touch the ledger,
    // same as how Expense never touches bank-account at all. Best-effort:
    // the payout itself already succeeded, so a posting failure here is
    // logged rather than surfaced as an error on markPaid.
    if (saved.bankAccountId) {
      try {
        const expenseAccountId = await this.journalPosting.findAccountIdByCode(EMPLOYEE_REIMBURSEMENTS_CODE);
        const bankJournalAccountId = await this.bankAccountService.ensureJournalAccountId(saved.bankAccountId);
        await this.journalPosting.postForSource(
          'reimbursement',
          saved.id,
          omanToday(),
          `Reimbursement ${saved.claimNumber} — ${saved.category}`,
          [
            { accountId: expenseAccountId, debit: Number(saved.amount), description: 'Employee reimbursement' },
            { accountId: bankJournalAccountId, credit: Number(saved.amount), description: 'Reimbursement payout' },
          ],
          decidedBy,
          saved.claimNumber,
        );
      } catch (err) {
        console.error(`Auto-posting failed for reimbursement ${saved.id}:`, err);
      }
    }

    return saved;
  }

  // Sums PAID claims by their actual payout date (paidAt), not the date
  // the expense was incurred — this is what should count against a
  // period's cash-out, mirroring ExpenseService.getTotalInRange(). Small
  // expected volume, so filtering in JS instead of a DB date-range query
  // on a nullable Date column keeps this simple.
  async getPaidTotalInRange(startDate: string, endDate: string) {
    const all = await this.repo.find({ where: { status: ReimbursementStatus.PAID } });
    const inRange = all.filter((r) => {
      if (!r.paidAt) return false;
      const paidDate = omanDate(r.paidAt);
      return paidDate >= startDate && paidDate <= endDate;
    });
    const total = inRange.reduce((sum, r) => sum + Number(r.amount), 0);
    return { total, count: inRange.length };
  }

  // Day-by-day PAID totals within a range — feeds the Dashboard's daily
  // Sales vs Expenses trend chart, mirroring ExpenseService.getDailyExpenses().
  async getPaidDailyTotals(startDate: string, endDate: string) {
    const all = await this.repo.find({ where: { status: ReimbursementStatus.PAID } });
    const byDate = new Map<string, number>();
    for (const r of all) {
      if (!r.paidAt) continue;
      const paidDate = omanDate(r.paidAt);
      if (paidDate < startDate || paidDate > endDate) continue;
      byDate.set(paidDate, (byDate.get(paidDate) || 0) + Number(r.amount));
    }
    return byDate;
  }

  // Count + total of currently PENDING claims — feeds the Dashboard's
  // combined Alerts card (see ReportingService.getDashboardAlerts()).
  async getPendingSummary() {
    const pending = await this.repo.find({ where: { status: ReimbursementStatus.PENDING } });
    return { count: pending.length, totalAmount: pending.reduce((sum, r) => sum + Number(r.amount), 0) };
  }

  // Saves/replaces the receipt scan (PDF or image) for this claim. Old
  // file (if any, and if its extension differs from the new one) is
  // removed so we don't accumulate orphaned files on repeated edits.
  async saveReceiptFile(id: string, file: Express.Multer.File) {
    const item = await this.findOne(id);
    const { extension: ext } = verifyFileSignature(file.buffer, ['pdf', 'jpeg', 'png']);
    const fileName = `${id}${ext}`;
    const filePath = path.join(this.uploadDir, fileName);

    if (item.receiptFilePath && item.receiptFilePath !== filePath && fs.existsSync(item.receiptFilePath)) {
      fs.unlinkSync(item.receiptFilePath);
    }

    fs.writeFileSync(filePath, file.buffer);
    item.receiptFilePath = filePath;
    return this.repo.save(item);
  }

  async getReceiptFilePath(id: string): Promise<string> {
    const item = await this.findOne(id);
    if (!item.receiptFilePath || !fs.existsSync(item.receiptFilePath)) {
      throw new NotFoundException('No receipt file uploaded for this claim');
    }
    return path.resolve(item.receiptFilePath);
  }
}
