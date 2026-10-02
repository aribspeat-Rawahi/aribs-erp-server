import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PaymentType, PaymentStatus } from '../common/payment-type.enum';

export enum SalesOrderStatus {
  PENDING = 'pending', // created, stock not yet deducted
  COMPLETED = 'completed', // stock deducted, ready to invoice
  CANCELLED = 'cancelled',
}

@Entity('sales_orders')
export class SalesOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  customerId: string;

  @Column({ type: 'enum', enum: SalesOrderStatus, default: SalesOrderStatus.PENDING })
  status: SalesOrderStatus;

  @Column({ type: 'enum', enum: PaymentType, nullable: true })
  paymentType: PaymentType;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.DUE })
  paymentStatus: PaymentStatus;

  @Column({ nullable: true })
  notes: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
