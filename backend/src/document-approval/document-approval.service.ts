import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';
import {
  APPROVAL_DOCUMENT_TYPES,
  APPROVER_ROLES,
  ApprovalDocumentType,
  ApprovalRule,
  DocumentApproval,
  DocumentApprovalStatus,
} from './document-approval.entity';
import { User } from '../auth/user.entity';
import { EmailService } from '../common/email.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

export interface ApprovalActor {
  userId?: string;
  email?: string;
  role?: string;
}

// What the owning module does when its document is finally approved or
// rejected. Runs inside the decision's transaction.
export interface ApprovalHandler {
  label: string; // "Purchase order"
  onApproved(manager: EntityManager, documentId: string, actor: ApprovalActor): Promise<void>;
  onRejected(manager: EntityManager, documentId: string, actor: ApprovalActor, comment: string | null): Promise<void>;
}

export interface RuleBandInput {
  upToAmount: number | null;
  steps: string[][];
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const LABELS: Record<ApprovalDocumentType, string> = {
  purchase_order: 'Purchase order',
  purchase_requisition: 'Purchase requisition',
};

// Approval engine (amount bands -> one or more approval steps by role).
// Rules:
// - any ONE user holding one of a step's roles decides that step; Admin can
//   decide any step;
// - nobody approves their own document (segregation of duties);
// - in a 2-step approval the two approvers must be different people;
// - a rejection ends the round; the document can be edited and resubmitted.
@Injectable()
export class DocumentApprovalService {
  private readonly logger = new Logger(DocumentApprovalService.name);
  private handlers = new Map<ApprovalDocumentType, ApprovalHandler>();

  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private email: EmailService,
    private activityLog: ActivityLogService,
  ) {}

  registerHandler(type: ApprovalDocumentType, handler: ApprovalHandler) {
    this.handlers.set(type, handler);
  }

  // ---- rules --------------------------------------------------------------

  async getRules() {
    const rules = await this.dataSource.manager.find(ApprovalRule, {});
    const out: Record<string, RuleBandInput[]> = {};
    for (const t of APPROVAL_DOCUMENT_TYPES) {
      out[t] = rules
        .filter((r) => r.documentType === t)
        .map((r) => ({ upToAmount: r.upToAmount === null ? null : Number(r.upToAmount), steps: JSON.parse(r.steps) as string[][] }))
        .sort((a, b) => (a.upToAmount === null ? 1 : b.upToAmount === null ? -1 : a.upToAmount - b.upToAmount));
    }
    return out;
  }

  async setRules(type: string, bands: RuleBandInput[], actor: ApprovalActor) {
    if (!APPROVAL_DOCUMENT_TYPES.includes(type as ApprovalDocumentType)) throw new BadRequestException('Unknown document type.');
    if (!Array.isArray(bands)) throw new BadRequestException('Send a list of amount bands.');
    const clean = bands.map((b, i) => {
      const up = b.upToAmount === null || b.upToAmount === undefined || (b.upToAmount as unknown) === '' ? null : r3(Number(b.upToAmount));
      if (up !== null && (!Number.isFinite(up) || up <= 0)) throw new BadRequestException(`Band ${i + 1}: "up to" must be a positive amount, or empty for no limit.`);
      if (!Array.isArray(b.steps) || b.steps.length < 1 || b.steps.length > 3) throw new BadRequestException(`Band ${i + 1}: give 1 to 3 approval steps.`);
      const steps = b.steps.map((s, j) => {
        const roles = [...new Set((s || []).map((x) => String(x).toLowerCase()))].filter((x) => APPROVER_ROLES.includes(x));
        if (!roles.length) throw new BadRequestException(`Band ${i + 1}, step ${j + 1}: choose at least one role.`);
        return roles;
      });
      return { upToAmount: up, steps };
    });
    const limits = clean.map((b) => b.upToAmount);
    if (limits.filter((x) => x === null).length > 1) throw new BadRequestException('Only one band can have no upper limit.');
    const numeric = limits.filter((x): x is number => x !== null);
    if (new Set(numeric).size !== numeric.length) throw new BadRequestException('Two bands have the same "up to" amount.');
    await this.dataSource.transaction(async (m) => {
      await m.delete(ApprovalRule, { documentType: type });
      for (const b of clean) {
        await m.save(m.create(ApprovalRule, { documentType: type as ApprovalDocumentType, upToAmount: b.upToAmount, steps: JSON.stringify(b.steps) }));
      }
    });
    await this.activityLog.log({
      userId: actor.userId,
      userEmail: actor.email,
      action: 'approval_rules.updated',
      entityType: 'approval_rules',
      entityId: type,
      details: { bands: clean },
    });
    return (await this.getRules())[type];
  }

  // The steps an amount needs; [] = no approval needed. Amounts above the
  // highest band with no "no limit" band use the highest band.
  async stepsFor(type: ApprovalDocumentType, amount: number, manager: EntityManager = this.dataSource.manager): Promise<string[][]> {
    const rules = (await manager.find(ApprovalRule, { where: { documentType: type } }))
      .map((r) => ({ up: r.upToAmount === null ? null : Number(r.upToAmount), steps: JSON.parse(r.steps) as string[][] }))
      .sort((a, b) => (a.up === null ? 1 : b.up === null ? -1 : a.up - b.up));
    if (!rules.length) return [];
    const band = rules.find((r) => r.up === null || amount <= r.up + 0.0005) || rules[rules.length - 1];
    return band.steps;
  }

  // ---- requests ----------------------------------------------------------

  // Starts (or restarts) approval for a document inside the caller's
  // transaction. Any step still pending from an earlier round is cancelled.
  // Returns 'approved' when no approval is needed.
  async start(
    manager: EntityManager,
    input: { type: ApprovalDocumentType; documentId: string; documentNumber: string; amount: number; summary?: string; requestedBy: ApprovalActor },
  ): Promise<'approved' | 'pending'> {
    await this.cancelPending(manager, input.type, input.documentId);
    const plan = await this.stepsFor(input.type, input.amount, manager);
    if (!plan.length) return 'approved';
    const [last] = await manager.query(
      'SELECT COALESCE(MAX(round), 0) AS r FROM document_approvals WHERE documentType = ? AND documentId = ?',
      [input.type, input.documentId],
    );
    const row = await manager.save(
      manager.create(DocumentApproval, {
        documentType: input.type,
        documentId: input.documentId,
        documentNumber: input.documentNumber,
        amount: r3(input.amount),
        round: Number(last?.r || 0) + 1,
        step: 1,
        totalSteps: plan.length,
        roles: JSON.stringify(plan[0]),
        plan: JSON.stringify(plan),
        status: DocumentApprovalStatus.PENDING,
        summary: input.summary?.slice(0, 255) || null,
        requestedByUserId: input.requestedBy.userId || null,
        requestedByEmail: input.requestedBy.email || null,
      }),
    );
    this.notify(row).catch((e) => this.logger.warn(`Approval email failed: ${e?.message || e}`));
    return 'pending';
  }

  async cancelPending(manager: EntityManager, type: ApprovalDocumentType, documentId: string) {
    await manager.update(
      DocumentApproval,
      { documentType: type, documentId, status: DocumentApprovalStatus.PENDING },
      { status: DocumentApprovalStatus.CANCELLED, decidedAt: new Date() },
    );
  }

  private canDecide(row: DocumentApproval, actor: ApprovalActor): string | null {
    const roles = JSON.parse(row.roles) as string[];
    if (actor.role !== 'admin' && !roles.includes(String(actor.role))) {
      return `Step ${row.step} of this approval is for: ${roles.join(', ')}.`;
    }
    if (row.requestedByUserId && actor.userId === row.requestedByUserId) {
      return 'You cannot approve your own request - another approver must decide it.';
    }
    return null;
  }

  async decide(id: string, action: 'approve' | 'reject', actor: ApprovalActor, comment?: string) {
    const note = comment?.trim() || null;
    if (action === 'reject' && !note) throw new BadRequestException('Give a reason for the rejection.');
    const result = await this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(DocumentApproval, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!row) throw new NotFoundException('Approval request not found');
      if (row.status !== DocumentApprovalStatus.PENDING) throw new BadRequestException(`This request is already ${row.status}.`);
      const problem = this.canDecide(row, actor);
      if (problem) throw new BadRequestException(problem);
      if (action === 'approve' && row.step > 1) {
        const earlier = await manager.findOne(DocumentApproval, {
          where: { documentType: row.documentType, documentId: row.documentId, round: row.round, status: DocumentApprovalStatus.APPROVED, decidedByUserId: actor.userId || '' },
        });
        if (earlier) throw new BadRequestException('You approved an earlier step of this request - the next step needs a different approver.');
      }
      const handler = this.handlers.get(row.documentType);
      if (!handler) throw new BadRequestException('This document type cannot be decided here.');

      row.status = action === 'approve' ? DocumentApprovalStatus.APPROVED : DocumentApprovalStatus.REJECTED;
      row.decidedByUserId = actor.userId || null;
      row.decidedByEmail = actor.email || null;
      row.decidedAt = new Date();
      row.comment = note;
      await manager.save(row);

      let next: DocumentApproval | null = null;
      if (action === 'reject') {
        await handler.onRejected(manager, row.documentId, actor, note);
      } else if (row.step < row.totalSteps) {
        const plan = JSON.parse(row.plan) as string[][];
        next = await manager.save(
          manager.create(DocumentApproval, {
            ...row,
            id: undefined,
            step: row.step + 1,
            roles: JSON.stringify(plan[row.step]),
            status: DocumentApprovalStatus.PENDING,
            decidedByUserId: null,
            decidedByEmail: null,
            decidedAt: null,
            comment: null,
            createdAt: undefined,
          }),
        );
      } else {
        await handler.onApproved(manager, row.documentId, actor);
      }
      return { row, next, label: handler.label };
    });

    const { row, next, label } = result;
    await this.activityLog.log({
      userId: actor.userId,
      userEmail: actor.email,
      action: `${row.documentType}.${action === 'approve' ? 'approved' : 'rejected'}`,
      entityType: row.documentType,
      entityId: row.documentId,
      details: { documentNumber: row.documentNumber, step: row.step, of: row.totalSteps, comment: row.comment, amount: Number(row.amount) },
    });
    if (next) {
      this.notify(next).catch((e) => this.logger.warn(`Approval email failed: ${e?.message || e}`));
    } else if (row.requestedByEmail) {
      const verdict = action === 'approve' ? 'approved' : 'rejected';
      this.email
        .sendPlainNotice(
          [row.requestedByEmail],
          `${label} ${row.documentNumber} ${verdict}`,
          `${label} ${row.documentNumber} (${Number(row.amount).toFixed(3)} OMR) was ${verdict} by ${actor.email || 'an approver'}.` +
            (row.comment ? `\n\nComment: ${row.comment}` : ''),
        )
        .catch((e) => this.logger.warn(`Approval email failed: ${e?.message || e}`));
    }
    return { status: next ? 'next_step' : row.status, step: row.step, totalSteps: row.totalSteps };
  }

  private async notify(row: DocumentApproval) {
    const roles = JSON.parse(row.roles) as string[];
    const users = await this.dataSource.manager.find(User, {
      where: { role: In([...roles, 'admin']) as any, active: true, deletedAt: IsNull() },
    });
    const to = users.filter((u) => u.id !== row.requestedByUserId && u.email).map((u) => u.email);
    const label = LABELS[row.documentType];
    await this.email.sendPlainNotice(
      to,
      `Approval needed: ${label} ${row.documentNumber}`,
      `${label} ${row.documentNumber} for ${Number(row.amount).toFixed(3)} OMR needs approval` +
        (row.totalSteps > 1 ? ` (step ${row.step} of ${row.totalSteps})` : '') +
        `${row.requestedByEmail ? `, requested by ${row.requestedByEmail}` : ''}.` +
        (row.summary ? `\n\n${row.summary}` : '') +
        '\n\nReview it on the Approvals page.',
    );
  }

  // ---- lists --------------------------------------------------------------

  async pending(actor: ApprovalActor) {
    const rows = await this.dataSource.manager.find(DocumentApproval, { where: { status: DocumentApprovalStatus.PENDING }, order: { createdAt: 'ASC' } });
    return rows.map((r) => {
      const problem = this.canDecide(r, actor);
      return { ...this.view(r), canDecide: !problem, cannotDecideReason: problem };
    });
  }

  async history(type: ApprovalDocumentType, documentId: string) {
    const rows = await this.dataSource.manager.find(DocumentApproval, {
      where: { documentType: type, documentId, status: Not(DocumentApprovalStatus.CANCELLED) },
      order: { round: 'ASC', step: 'ASC' },
    });
    return rows.map((r) => this.view(r));
  }

  // pending steps keyed by document id - for list pages
  async pendingByDocument(type: ApprovalDocumentType, ids: string[]) {
    if (!ids.length) return new Map<string, ReturnType<DocumentApprovalService['view']>>();
    const rows = await this.dataSource.manager.find(DocumentApproval, {
      where: { documentType: type, documentId: In(ids), status: DocumentApprovalStatus.PENDING },
    });
    return new Map(rows.map((r) => [r.documentId, this.view(r)]));
  }

  // the latest decision per document (the rejection reason, who approved)
  async lastDecisionByDocument(type: ApprovalDocumentType, ids: string[]) {
    if (!ids.length) return new Map<string, ReturnType<DocumentApprovalService['view']>>();
    const rows = await this.dataSource.manager.find(DocumentApproval, {
      where: { documentType: type, documentId: In(ids), status: In([DocumentApprovalStatus.APPROVED, DocumentApprovalStatus.REJECTED]) },
      order: { decidedAt: 'ASC' },
    });
    return new Map(rows.map((r) => [r.documentId, this.view(r)]));
  }

  private view(r: DocumentApproval) {
    return {
      id: r.id,
      documentType: r.documentType,
      documentId: r.documentId,
      documentNumber: r.documentNumber,
      amount: Number(r.amount),
      round: r.round,
      step: r.step,
      totalSteps: r.totalSteps,
      roles: JSON.parse(r.roles) as string[],
      status: r.status,
      summary: r.summary,
      requestedByEmail: r.requestedByEmail,
      decidedByEmail: r.decidedByEmail,
      decidedAt: r.decidedAt,
      comment: r.comment,
      createdAt: r.createdAt,
    };
  }
}
