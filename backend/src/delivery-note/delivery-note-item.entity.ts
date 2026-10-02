import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('delivery_note_items')
export class DeliveryNoteItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  deliveryNoteId: string;

  @Column({ nullable: true })
  finishedGoodId: string;

  @Column()
  description: string;

  @Column('decimal', { precision: 12, scale: 3 })
  quantity: number;

  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  unitPrice: number;

  @Column('decimal', { precision: 5, scale: 2, default: 5.0 })
  vatRate: number;

  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  lineTotal: number;

  @CreateDateColumn()
  createdAt: Date;
}
