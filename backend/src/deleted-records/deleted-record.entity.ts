import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// Proof of every delete made in the ERP, plus what is needed to undo it.
// Written by DeletedRecordsInterceptor after a DELETE request succeeds;
// never removed (only the parked files expire).
@Entity('deleted_records')
export class DeletedRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ length: 60 })
  entityType: string; // e.g. 'invoice', 'customer', 'customer_document'

  @Column({ type: 'varchar', length: 64, nullable: true })
  entityId: string | null;

  // human summary, e.g. "Invoice INV-2026-0005 - Al Rawahi LLC - 75.600 OMR"
  @Column({ length: 500 })
  label: string;

  @Column({ length: 300 })
  route: string; // e.g. "DELETE /api/invoices/:id"

  // JSON: { rows: CapturedRow[], files: {from,to}[] }
  @Column({ type: 'longtext' })
  snapshot: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  deletedByUserId: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true })
  deletedByEmail: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true })
  deletedByName: string | null;
  @Column({ type: 'varchar', length: 20, nullable: true })
  deletedByRole: string | null;
  @Column({ type: 'varchar', length: 64, nullable: true })
  ipAddress: string | null;

  @Index()
  @CreateDateColumn()
  deletedAt: Date;

  @Column({ default: false })
  restorable: boolean;
  @Column({ type: 'varchar', length: 300, nullable: true })
  notRestorableReason: string | null;
  @Column({ type: 'datetime', nullable: true })
  restoreExpiresAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  restoredAt: Date | null;
  @Column({ type: 'varchar', length: 255, nullable: true })
  restoredByEmail: string | null;
}
