import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// General company document library shown in Settings — trade license, VAT
// certificate, CR paper, insurance policy, or any other company-level
// paperwork that isn't tied to a specific customer/supplier/employee (those
// already have their own document tables). A single row is one uploaded
// file; there can be any number of them, unlike the single logoPath on
// Settings itself.
@Entity('company_documents')
export class CompanyDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // User-entered label, e.g. "Trade License", "VAT Certificate" — the
  // only field "Edit" changes (the file itself is immutable; re-upload a
  // new document instead of replacing this row's file).
  @Column()
  title: string;

  // Original uploaded file name (for display + a sensible download name),
  // separate from the sanitized name actually used on disk.
  @Column()
  originalName: string;

  @Column()
  filePath: string;

  @CreateDateColumn()
  uploadedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
