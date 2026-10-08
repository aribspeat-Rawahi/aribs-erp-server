import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SalaryAdvanceRequest, SalaryAdvanceStatus } from './salary-advance.entity';
import { EmployeeService } from './employee.service';
import { CreateSalaryAdvanceDto, DisburseSalaryAdvanceDto } from './dto/salary-advance.dto';
import { ApprovalService } from '../approval/approval.service';
import { ApprovalRequestType, ApprovalRequestStatus } from '../approval/approval-request.entity';
import { BankTransactionType } from '../bank-account/bank-transaction.entity';
import { BankAccountService } from '../bank-account/bank-account.service';
import { JournalPostingService } from '../journal/journal-posting.service';
import { omanToday } from '../common/oman-date';

interface ActorRef {
  userId?: string;
  email?: string;
}

// Matches the Employee Salary Advances asset account added in
// account.service.ts's DEFAULT_ACCOUNTS.
const SALARY_ADVANCE_ASSET_CODE = '1320';

@Injectable()
export class SalaryAdvanceService {
  constructor(
    @InjectRepository(SalaryAdvanceRequest)
    private repo: Repository<SalaryAdvanceRequest>,
    private employeeService: EmployeeService,
    private approvalService: ApprovalService,
    private bankAccountService: BankAccountService,
    private journalPosting: JournalPostingService,
  ) {}

  findAll() {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  // Creates the record as PENDING, then immediately pushes a matching
  // row into the shared approval_requests queue so it shows up on the
  // Approvals dashboard's waiting list — same "create-then-queue" shape
  // used by Invoice/Quotation's own approval gates.
  async create(dto: CreateSalaryAdvanceDto, requestedBy: ActorRef = {}) {
    const employee = await this.employeeService.findOne(dto.employeeId);

    const advance = await this.repo.save(
      this.repo.create({
        employeeId: dto.employeeId,
        employeeName: employee.name,
        amount: dto.amount,
        reason: dto.reason,
        status: SalaryAdvanceStatus.PENDING,
        requestedByUserId: requestedBy.userId,
        requestedByEmail: requestedBy.email,
      }),
    );

    const approvalRequest = await this.approvalService.create({
      type: ApprovalRequestType.SALARY_ADVANCE,
      entityType: 'salary_advance',
      targetId: advance.id,
      payload: { advanceId: advance.id },
      reason: `Salary advance requested — ${employee.name}: ${Number(dto.amount).toFixed(3)} OMR. ${dto.reason}`,
      requestedBy,
    });

    advance.approvalRequestId = approvalRequest.id;
    return this.repo.save(advance);
  }

  // Replays the approve decision onto the SalaryAdvanceRequest row —
  // unlike Invoice/Quotation, there's no create/update payload to
  // replay, just a status flip, since the record already exists.
  async applyApprovedRequest(approvalRequestId: string, approvedBy: ActorRef = {}) {
    const request = await this.approvalService.claimPending(approvalRequestId, 'salary_advance');
    const advance = await this.repo.findOne({ where: { id: request.targetId } });
    if (!advance) throw new NotFoundException('Salary advance request not found');

    advance.status = SalaryAdvanceStatus.APPROVED;
    advance.decidedByUserId = approvedBy.userId;
    advance.decidedByEmail = approvedBy.email;
    advance.decidedAt = new Date();
    const saved = await this.repo.save(advance);

    await this.approvalService.markDecided(approvalRequestId, ApprovalRequestStatus.APPROVED, approvedBy);
    return saved;
  }

  async rejectRequest(approvalRequestId: string, decidedBy: ActorRef = {}) {
    const request = await this.approvalService.reject(approvalRequestId, 'salary_advance', decidedBy);
    const advance = await this.repo.findOne({ where: { id: request.targetId } });
    if (advance) {
      advance.status = SalaryAdvanceStatus.REJECTED;
      advance.decidedByUserId = decidedBy.userId;
      advance.decidedByEmail = decidedBy.email;
      advance.decidedAt = new Date();
      await this.repo.save(advance);
    }
    return request;
  }

  // The actual payout — only once approved. If dto.bankAccountId is
  // set, records a real withdrawal (same optional-bank-sync convention
  // as Payroll.markPaid) and auto-posts Dr 1320 Employee Salary
  // Advances / Cr {bank}. It's an asset, not an expense — the company
  // is owed this money back (e.g. deducted from a future payroll run
  // by hand; no automatic linkage to Payroll yet).
  async disburse(id: string, dto: DisburseSalaryAdvanceDto, actor: ActorRef = {}) {
    const advance = await this.repo.findOne({ where: { id } });
    if (!advance) throw new NotFoundException('Salary advance request not found');
    if (advance.status !== SalaryAdvanceStatus.APPROVED) {
      throw new BadRequestException('Only an approved salary advance can be disbursed.');
    }
    if (advance.disbursed) {
      throw new BadRequestException('This salary advance has already been disbursed.');
    }

    if (dto.bankAccountId) {
      const txn = await this.bankAccountService.addTransaction(dto.bankAccountId, {
        type: BankTransactionType.WITHDRAWAL,
        amount: Number(advance.amount),
        date: omanToday(),
        note: `Salary advance — ${advance.employeeName}`,
      });
      advance.bankAccountId = dto.bankAccountId;
      advance.bankTransactionId = txn.id;
    }

    advance.disbursed = true;
    await this.journalPosting.assertDateOpen(omanToday(), 'Paying an advance today');
    advance.disbursedDate = omanToday();
    const saved = await this.repo.save(advance);

    if (saved.bankAccountId) {
      try {
        const advanceAccountId = await this.journalPosting.findAccountIdByCode(SALARY_ADVANCE_ASSET_CODE);
        const bankJournalAccountId = await this.bankAccountService.ensureJournalAccountId(saved.bankAccountId);
        await this.journalPosting.postForSource(
          'salary_advance',
          saved.id,
          saved.disbursedDate!,
          `Salary advance — ${saved.employeeName}`,
          [
            { accountId: advanceAccountId, debit: Number(saved.amount), description: 'Employee Salary Advance' },
            { accountId: bankJournalAccountId, credit: Number(saved.amount), description: 'Advance payout' },
          ],
          actor,
          saved.employeeName,
        );
      } catch (err) {
        console.error(`Auto-posting failed for salary advance ${saved.id}:`, err);
      }
    }

    return saved;
  }
}
