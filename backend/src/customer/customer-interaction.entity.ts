import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { InteractionType } from '../common/interaction-type.enum';

// CRM Step 6 — Activity/Interaction Log. One row per logged interaction
// with a customer (a call, meeting, email, note, ...). Append-only from
// the UI (add + delete, no edit) since it's a chronological record of
// what happened, not editable business data.
@Index(['customerId'])
@Entity('customer_interactions')
export class CustomerInteraction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  customerId: string;

  @Column({ type: 'enum', enum: InteractionType, default: InteractionType.NOTE })
  type: InteractionType;

  @Column({ nullable: true })
  subject: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  // Defaults to today (service-side) but can be back-dated for a call
  // that happened a few days ago and is only being logged now.
  @Column({ type: 'date' })
  interactionDate: string;

  // Denormalized — who logged this entry, from the JWT (email is more
  // readable than a bare userId when scanning the log later).
  @Column({ nullable: true })
  createdByEmail: string;

  @CreateDateColumn()
  createdAt: Date;
}
