import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// One completed bank reconciliation: the bank statement up to
// `statementDate` was checked line by line against the ERP, and the ticked
// lines (`items`) plus the previous statement's closing balance add up to
// the statement's closing balance exactly. `items` keeps a copy of each
// ticked line so a later change or delete of one of them can be spotted.
@Index(['bankAccountId', 'statementDate'])
@Entity('bank_reconciliations')
export class BankReconciliation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  bankAccountId: string;

  @Column({ type: 'date' })
  statementDate: string;

  // closing balance printed on the bank statement
  @Column('decimal', { precision: 14, scale: 3 })
  statementBalance: number;

  // where this statement started: the previous reconciliation's closing
  // balance, or the account's opening balance for the first one
  @Column('decimal', { precision: 14, scale: 3 })
  openingBalance: number;

  // ERP balance on statementDate (all lines up to that day) - the
  // difference to statementBalance is what is still in transit
  @Column('decimal', { precision: 14, scale: 3 })
  bookBalance: number;

  // [{ id, type, amount, date }] of the ticked lines
  @Column({ type: 'longtext' })
  items: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  createdByEmail: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
