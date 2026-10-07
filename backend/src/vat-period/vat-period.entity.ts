import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum VatPeriodStatus {
  FILED = 'filed',
  REOPENED = 'reopened', // kept as history; a new row is made when it is filed again
}

// A VAT return marked as filed with the Oman Tax Authority. Filing closes
// the books up to endDate (JournalPostingService.lockedThrough). The VAT
// figures are a snapshot taken at filing, so what was declared can always
// be compared with the books later.
@Index(['status', 'endDate'])
@Entity('vat_periods')
export class VatPeriod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40 })
  label: string; // e.g. "VAT Oct-Dec 2026"

  @Column({ type: 'date' })
  startDate: string;

  @Column({ type: 'date' })
  endDate: string;

  @Column({ type: 'varchar', length: 20, default: VatPeriodStatus.FILED })
  status: VatPeriodStatus;

  // OTA acknowledgement / reference number of the return
  @Column({ type: 'varchar', length: 100, nullable: true })
  otaReference: string | null;

  @Column('decimal', { precision: 14, scale: 3, default: 0 })
  taxableSales: number;

  @Column('decimal', { precision: 14, scale: 3, default: 0 })
  outputVat: number;

  @Column('decimal', { precision: 14, scale: 3, default: 0 })
  taxablePurchases: number;

  @Column('decimal', { precision: 14, scale: 3, default: 0 })
  inputVat: number;

  // negative = refundable
  @Column('decimal', { precision: 14, scale: 3, default: 0 })
  netVat: number;

  @Column({ type: 'int', default: 0 })
  purchaseRowsMissingDocuments: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'datetime' })
  filedAt: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  filedBy: string | null;

  @Column({ type: 'datetime', nullable: true })
  reopenedAt: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reopenedBy: string | null;

  @Column({ type: 'text', nullable: true })
  reopenReason: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
