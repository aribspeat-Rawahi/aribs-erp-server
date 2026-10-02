import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// CRM Step 7 — Approval Workflow. A generic "this needs sign-off before
// it takes effect" row, used for the gates that can block a self-serve
// invoice/quotation submission, plus (since) Salary Advance requests:
//   - credit_limit_override — the invoice would push the customer's
//     outstanding balance over their Customer.creditLimit
//   - large_discount        — the discount exceeds DISCOUNT_APPROVAL_
//     THRESHOLD_PERCENT of the subtotal
//   - vat_exclude           — VAT is being deliberately excluded for a
//     customer who is normally VAT-applicable
//   - salary_advance        — an employee's salary advance request (see
//     SalaryAdvanceRequest/SalaryAdvanceService) — unlike the three
//     above, the underlying record already exists as PENDING when this
//     is created; approve()/reject() here just flip its status rather
//     than replaying a stored create/update payload.
// Separate from QuotationEditRequest (which already handles a
// different-day price edit on an existing quotation) — that mechanism
// is untouched; this one covers everything else. The Approvals
// dashboard combines both into one list for the approver.
export enum ApprovalRequestType {
  CREDIT_LIMIT_OVERRIDE = 'credit_limit_override',
  LARGE_DISCOUNT = 'large_discount',
  VAT_EXCLUDE = 'vat_exclude',
  SALARY_ADVANCE = 'salary_advance',
}

export enum ApprovalRequestStatus {
  PENDING = 'pending',
  // Transitional state set atomically by claimPending() the instant an
  // approve/reject action starts, so a double-click or two concurrent
  // approvals can't both pass the PENDING check and replay the payload
  // twice. Moves to APPROVED/REJECTED once the work finishes.
  PROCESSING = 'processing',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('approval_requests')
export class ApprovalRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: ApprovalRequestType })
  type: ApprovalRequestType;

  // 'invoice' | 'quotation' — which service's create()/update() to
  // replay once approved.
  @Column()
  entityType: string;

  // Set only when this request is for editing an EXISTING invoice/
  // quotation (update); null means it's for a brand-new one (create).
  @Column({ nullable: true })
  targetId?: string;

  // Required for the invoice/quotation gates; left unset for a
  // salary_advance request (which has no customer — see employeeId on
  // SalaryAdvanceRequest instead, referenced via targetId).
  @Column({ nullable: true })
  customerId?: string;

  // The full create/update DTO, exactly as submitted, stored as JSON —
  // replayed verbatim (with the gate checks skipped) once approved.
  @Column({ type: 'text' })
  payload: string;

  // Human-readable explanation shown on the Approvals dashboard, e.g.
  // "Outstanding balance would become 1,250.000 OMR, over the 1,000.000
  // OMR credit limit." Can combine more than one triggered gate.
  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'enum', enum: ApprovalRequestStatus, default: ApprovalRequestStatus.PENDING })
  status: ApprovalRequestStatus;

  @Column({ nullable: true })
  requestedByUserId?: string;

  @Column({ nullable: true })
  requestedByEmail?: string;

  @Column({ nullable: true })
  approvedByUserId?: string;

  @Column({ nullable: true })
  approvedByEmail?: string;

  @Column({ nullable: true })
  decidedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;
}
