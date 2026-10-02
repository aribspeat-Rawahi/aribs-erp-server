import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ProductionOrderStatus {
  PLANNED = 'planned', // created, materials not yet consumed
  COMPLETED = 'completed', // materials consumed, finished goods stocked in
  CANCELLED = 'cancelled',
}

@Entity('production_orders')
export class ProductionOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  finishedGoodId: string;

  // How many units of the finished good this run is producing.
  @Column('decimal', { precision: 12, scale: 3 })
  quantityToProduce: number;

  @Column({ type: 'enum', enum: ProductionOrderStatus, default: ProductionOrderStatus.PLANNED })
  status: ProductionOrderStatus;

  @Column({ nullable: true })
  notes: string;

  @Column({ nullable: true })
  completedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
