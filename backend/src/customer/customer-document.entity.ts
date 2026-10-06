import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

// One row per uploaded document for a customer — CR Paper, Vat Reg.
// Paper, Riyada, or Others (fixed dropdown, see PARTY_DOCUMENT_TYPES in
// dto/customer.dto.ts). A customer can have several, added via the "Add
// Another Document" button.
@Index(['customerId'])
@Entity('customer_documents')
export class CustomerDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  customerId: string;

  @Column()
  docType: string;

  // Original uploaded file name (for display + a sensible download name),
  // separate from the sanitized name actually used on disk.
  @Column()
  originalName: string;

  @Column()
  filePath: string;

  @CreateDateColumn()
  uploadedAt: Date;
}
