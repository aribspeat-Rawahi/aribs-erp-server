import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { JournalEntry } from './journal-entry.entity';

// One Debit-or-Credit line of a Journal Entry, posted against a single
// Chart-of-Accounts account. Exactly one of debit/credit is expected to be
// non-zero per line (the service validates this on create), and the sum
// of all lines' debit must equal the sum of all lines' credit for the
// parent entry to be considered balanced.
@Entity('journal_entry_lines')
export class JournalEntryLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => JournalEntry, (entry) => entry.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'journalEntryId' })
  journalEntry: JournalEntry;

  @Column()
  journalEntryId: string;

  // References Account.id — no DB foreign key, same no-FK convention used
  // throughout this codebase (e.g. Reimbursement.employeeId).
  @Column()
  accountId: string;

  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  debit: number;

  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  credit: number;

  @Column({ nullable: true })
  description?: string;
}
