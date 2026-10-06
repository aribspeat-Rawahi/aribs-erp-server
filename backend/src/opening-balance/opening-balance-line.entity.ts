import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum OpeningBalanceKind {
  BANK = 'bank', // refId = bank_accounts.id, amount = balance
  CUSTOMER = 'customer', // refId = customers.id, one unpaid old invoice
  SUPPLIER = 'supplier', // refId = suppliers.id, one unpaid old bill
  RAW_MATERIAL = 'raw_material', // refId = raw_materials.id, quantity x unitCost
  FINISHED_GOOD = 'finished_good', // refId = finished_goods.id, quantity x unitCost
  ACCOUNT = 'account', // refId = accounts.id, debit or credit
}

// One line typed on the Accounting > Opening Balances page. Lines are a
// draft: nothing touches the books until "Finalize", which turns them all
// into invoices, bills, bank transactions, stock batches and one journal
// entry in a single transaction (OpeningBalanceService.finalize).
@Index(['kind'])
@Entity('opening_balance_lines')
export class OpeningBalanceLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  kind: OpeningBalanceKind;

  @Column({ type: 'varchar', length: 36 })
  refId: string;

  // Old invoice / bill number (customer and supplier lines).
  @Column({ type: 'varchar', length: 100, nullable: true })
  documentNumber: string | null;

  @Column({ type: 'date', nullable: true })
  documentDate: string | null;

  @Column({ type: 'date', nullable: true })
  dueDate: string | null;

  // Stock lines.
  @Column('decimal', { precision: 12, scale: 3, nullable: true })
  quantity: number | null;

  @Column('decimal', { precision: 12, scale: 3, nullable: true })
  unitCost: number | null;

  // Bank / customer / supplier lines (always positive), and stock value.
  @Column('decimal', { precision: 14, scale: 3, default: 0 })
  amount: number;

  // Other-account lines: exactly one of these is above zero.
  @Column('decimal', { precision: 14, scale: 3, default: 0 })
  debit: number;

  @Column('decimal', { precision: 14, scale: 3, default: 0 })
  credit: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  // What finalize created from this line (invoice / purchase order /
  // bank transaction / batch id).
  @Column({ type: 'varchar', length: 36, nullable: true })
  postedRefId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  createdByEmail: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
