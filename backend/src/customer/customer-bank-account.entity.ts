import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

// One row per bank account a customer has given us. A customer can have
// more than one (different currencies/branches), added via the "Add
// Another Account" button on the Bank Details form — hence its own table
// rather than columns on Customer.
@Index(['customerId'])
@Entity('customer_bank_accounts')
export class CustomerBankAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Plain FK column, same pattern as AttendanceRecord.employeeId — no
  // TypeORM relation/join needed since we always look these up by
  // customerId directly.
  @Column()
  customerId: string;

  @Column({ nullable: true })
  accountName: string;

  @Column({ nullable: true })
  accountNumber: string;

  @Column({ nullable: true })
  bankName: string;

  @Column({ nullable: true })
  branchName: string;

  @Column({ nullable: true })
  branchCode: string;

  @Column({ nullable: true })
  swiftCode: string;

  @Column({ nullable: true })
  iban: string;

  // Original uploaded statement file name (for display), separate from
  // the sanitized name actually used on disk.
  @Column({ nullable: true })
  statementOriginalName: string;

  @Column({ nullable: true })
  statementPath: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
