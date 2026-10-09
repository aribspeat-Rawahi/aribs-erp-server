import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

// One uploaded journal file (Accounting > Journals > Import). Its entries
// are journal entries with sourceType 'journal_import' and sourceId
// '<batch id>:<n>'; bank/cash lines also created the bank transactions
// listed in bankTransactionIds. Undo removes all of it together.
@Entity('journal_import_batches')
export class JournalImportBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  fileName: string;

  @Column({ type: 'int' })
  entryCount: number;

  @Column({ type: 'int' })
  lineCount: number;

  @Column('decimal', { precision: 16, scale: 3 })
  totalDebit: number;

  @Column({ type: 'date' })
  firstDate: string;

  @Column({ type: 'date' })
  lastDate: string;

  // JSON array of bank_transactions ids created by this file
  @Column({ type: 'longtext' })
  bankTransactionIds: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  createdByEmail: string | null;

  @CreateDateColumn()
  createdAt: Date;
}

// "Your account name -> ERP account", remembered so the same name in the
// next file is matched without asking again.
@Entity('journal_import_mappings')
export class JournalImportMapping {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // trimmed + lower-cased name as written in the file
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 200 })
  sourceName: string;

  @Column({ type: 'varchar', length: 36 })
  accountId: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
