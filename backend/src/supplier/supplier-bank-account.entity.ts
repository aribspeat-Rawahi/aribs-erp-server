import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

// One row per bank account a supplier has given us. A supplier can have
// more than one (different currencies/branches), added via the "Add
// Another Account" button on the Bank Details form — hence its own table
// rather than columns on Supplier.
@Index(['supplierId'])
@Entity('supplier_bank_accounts')
export class SupplierBankAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  supplierId: string;

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

  @Column({ nullable: true })
  statementOriginalName: string;

  @Column({ nullable: true })
  statementPath: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
