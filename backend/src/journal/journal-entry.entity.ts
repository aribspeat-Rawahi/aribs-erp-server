import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { JournalEntryLine } from './journal-entry-line.entity';

// A full double-entry Journal Entry — one transaction, made up of two or
// more lines (see JournalEntryLine) whose total Debit must equal total
// Credit (enforced in JournalEntryService.create()). This is a manual
// bookkeeping tool sitting alongside (not replacing) Expense/Reimbursement/
// Invoice — those stay the day-to-day operational records; Journal Entries
// are for adjusting entries, opening balances, depreciation, corrections,
// and anything else that needs proper double-entry treatment.
@Entity('journal_entries')
export class JournalEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Human-readable reference, e.g. "JE-20260924-A1B2C3" — same generation
  // pattern as Reimbursement.claimNumber / batch numbers.
  @Column({ unique: true })
  entryNumber: string;

  @Column({ type: 'date' })
  date: string;

  // Optional external reference (invoice #, cheque #, contract #...).
  @Column({ nullable: true })
  reference?: string;

  @Column({ type: 'text' })
  memo: string;

  @Column({ nullable: true })
  createdByUserId?: string;
  @Column({ nullable: true })
  createdByEmail?: string;

  // Set only on entries created automatically by JournalPostingService
  // (Expense/Invoice/Reimbursement/Fund Transfer/Tax Payment auto-posting)
  // — sourceType/sourceId identify the record that generated this entry,
  // so it can be found and regenerated (deleted + recreated) whenever
  // that source changes, instead of being reversed line by line. A
  // manual entry made from the Journals tab leaves all three unset.
  @Column({ default: false })
  autoPosted: boolean;
  @Column({ nullable: true })
  sourceType?: string;
  @Column({ nullable: true })
  sourceId?: string;

  @OneToMany(() => JournalEntryLine, (line) => line.journalEntry, { cascade: true })
  lines: JournalEntryLine[];

  @CreateDateColumn()
  createdAt: Date;
}
