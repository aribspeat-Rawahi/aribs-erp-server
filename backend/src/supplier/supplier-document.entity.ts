import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

// One row per uploaded document for a supplier — CR Paper, Vat Reg.
// Paper, Riyada, or Others (fixed dropdown, see PARTY_DOCUMENT_TYPES in
// dto/supplier.dto.ts). A supplier can have several, added via the "Add
// Another Document" button.
@Index(['supplierId'])
@Entity('supplier_documents')
export class SupplierDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  supplierId: string;

  @Column()
  docType: string;

  @Column()
  originalName: string;

  @Column()
  filePath: string;

  @CreateDateColumn()
  uploadedAt: Date;
}
