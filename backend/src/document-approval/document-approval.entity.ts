import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ApprovalDocumentType = 'purchase_order' | 'purchase_requisition';
export const APPROVAL_DOCUMENT_TYPES: ApprovalDocumentType[] = ['purchase_order', 'purchase_requisition'];
export const APPROVER_ROLES = ['admin', 'ceo', 'md', 'accountant', 'production', 'sales'];

// One amount band of an approval rule. A document is matched to the first
// band (lowest upToAmount first, "no limit" last) its amount fits in; the
// band lists who approves at each step (any ONE user with one of a step's
// roles approves that step). No band for a document type = no approval.
@Index(['documentType'])
@Entity('approval_rules')
export class ApprovalRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40 })
  documentType: ApprovalDocumentType;

  // null = no upper limit
  @Column('decimal', { precision: 14, scale: 3, nullable: true })
  upToAmount: number | null;

  // JSON: [["accountant","md"], ["ceo"]] - roles per step, in order
  @Column({ type: 'text' })
  steps: string;

  @CreateDateColumn()
  createdAt: Date;
}

export enum DocumentApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled', // the document was edited, cancelled or deleted
}

// One approval step of one document. Steps are created one at a time:
// step 2 only after step 1 is approved. The roles are copied from the rule
// when the request starts, so a later rule change doesn't move a document
// already in progress.
@Index(['documentType', 'documentId'])
@Index(['status'])
@Entity('document_approvals')
export class DocumentApproval {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40 })
  documentType: ApprovalDocumentType;

  @Column({ type: 'varchar', length: 36 })
  documentId: string;

  @Column({ type: 'varchar', length: 40 })
  documentNumber: string;

  @Column('decimal', { precision: 14, scale: 3, default: 0 })
  amount: number;

  // which request round (a resubmitted document starts round 2)
  @Column({ type: 'int', default: 1 })
  round: number;

  @Column({ type: 'int' })
  step: number;

  @Column({ type: 'int' })
  totalSteps: number;

  // JSON array of roles allowed to decide this step
  @Column({ type: 'text' })
  roles: string;

  // JSON of all steps' roles for this round (to create the next step)
  @Column({ type: 'text' })
  plan: string;

  @Column({ type: 'varchar', length: 20, default: DocumentApprovalStatus.PENDING })
  status: DocumentApprovalStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  summary: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  requestedByUserId: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true })
  requestedByEmail: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  decidedByUserId: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true })
  decidedByEmail: string | null;
  @Column({ type: 'datetime', nullable: true })
  decidedAt: Date | null;
  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
