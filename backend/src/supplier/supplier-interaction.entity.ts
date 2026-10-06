import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { InteractionType } from '../common/interaction-type.enum';

// CRM Step 6 — Activity/Interaction Log, supplier side (mirrors
// CustomerInteraction). Append-only from the UI (add + delete, no edit).
@Index(['supplierId'])
@Entity('supplier_interactions')
export class SupplierInteraction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  supplierId: string;

  @Column({ type: 'enum', enum: InteractionType, default: InteractionType.NOTE })
  type: InteractionType;

  @Column({ nullable: true })
  subject: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'date' })
  interactionDate: string;

  @Column({ nullable: true })
  createdByEmail: string;

  @CreateDateColumn()
  createdAt: Date;
}
