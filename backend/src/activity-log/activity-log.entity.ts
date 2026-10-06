import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

// A general-purpose audit trail. Any service can call
// ActivityLogService.log(...) to record a sensitive action — invoice
// edits, VAT-exclude overrides, manual price changes, stock adjustments,
// user role changes, etc. This is what lets "who changed this price and
// when" be answered later.
@Index(['createdAt'])
@Entity('activity_logs')
export class ActivityLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ nullable: true })
  userId: string; // who did it (nullable: system-triggered actions have no user)

  @Column({ nullable: true })
  userEmail: string; // denormalized for easy reading without a join

  @Column()
  action: string; // e.g. 'invoice.vat_excluded', 'price.override', 'stock.adjust'

  @Index()
  @Column({ nullable: true })
  entityType: string; // e.g. 'invoice', 'raw_material'

  @Index()
  @Column({ nullable: true })
  entityId: string;

  @Column({ type: 'text', nullable: true })
  details: string; // free-form JSON string with before/after or context

  @CreateDateColumn()
  createdAt: Date;
}
