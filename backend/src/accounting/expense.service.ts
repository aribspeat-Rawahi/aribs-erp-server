import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Between, DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { Expense, ExpenseCategory } from './expense.entity';
import { CreateExpenseDto, UpdateExpenseDto } from './dto/accounting.dto';
import { verifyFileSignature } from '../common/file-signature.util';
import { BankAccount } from '../bank-account/bank-account.entity';
import { BankTransaction, BankTransactionType } from '../bank-account/bank-transaction.entity';
import { BankAccountService } from '../bank-account/bank-account.service';
import { JournalPostingService } from '../journal/journal-posting.service';
import { omanToday } from '../common/oman-date';

interface ActorRef {
  userId?: string;
  email?: string;
}

// Which Chart-of-Accounts Expense account each ExpenseCategory posts its
// Debit to when auto-posting — reasonable defaults matched against the
// DEFAULT_ACCOUNTS seed in journal/account.service.ts. Editable here if
// the mapping ever needs to change; a category with no bankAccountId set
// on the expense never reaches this map (record-only expenses aren't
// auto-posted at all).
const EXPENSE_CATEGORY_ACCOUNT_CODE: Record<ExpenseCategory, string> = {
  [ExpenseCategory.RENT]: '656', // Rent
  [ExpenseCategory.UTILITIES]: '640', // Utilities
  [ExpenseCategory.SALARY]: '664', // Wages & Salaries
  [ExpenseCategory.RAW_MATERIAL]: '5100', // Raw Material Purchases
  [ExpenseCategory.MAINTENANCE]: '660', // Repairs & Maintenance
  [ExpenseCategory.TRANSPORT]: '644', // Automobile Expenses
  [ExpenseCategory.OTHER]: '628', // General Expenses
};

@Injectable()
export class ExpenseService {
  private uploadDir: string;

  constructor(
    @InjectRepository(Expense)
    private repo: Repository<Expense>,
    @InjectDataSource()
    private dataSource: DataSource,
    private config: ConfigService,
    private bankAccountService: BankAccountService,
    private journalPosting: JournalPostingService,
  ) {
    this.uploadDir = this.config.get('EXPENSE_INVOICE_UPLOAD_DIR') || './uploads/expense-invoices';
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  findAll() {
    return this.repo.find({ order: { date: 'DESC' } });
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Expense not found');
    return item;
  }

  // Auto-posts (or re-posts, or removes) Dr {category's mapped expense
  // account} / Cr {this expense's linked bank/cash account} — only when
  // bankAccountId is set (a record-only expense isn't auto-posted at
  // all, same as a manual-only Reimbursement). Best-effort and separate
  // from the balance-moving transaction, same reasoning as
  // FundTransferService.postJournalEntry().
  // Raw material is stock, not an expense: as an expense it never reached
  // inventory (1200), yet production took it out of 1200 again - costed
  // twice. It must come in through a Purchase Order (Receive goods).
  private assertNotRawMaterial(category: ExpenseCategory) {
    if (category === ExpenseCategory.RAW_MATERIAL) {
      throw new BadRequestException('Buy raw material with a Purchase Order (Suppliers > Purchase Orders > Receive), so it goes into stock at its cost.');
    }
  }

  private async postJournalEntry(item: Expense, actor: ActorRef, rethrow = false) {
    try {
      if (!item.bankAccountId) {
        await this.journalPosting.removeForSource('expense', item.id);
        return;
      }
      const expenseAccountId = await this.journalPosting.findAccountIdByCode(
        EXPENSE_CATEGORY_ACCOUNT_CODE[item.category],
      );
      const bankJournalAccountId = await this.bankAccountService.ensureJournalAccountId(item.bankAccountId);
      await this.journalPosting.postForSource(
        'expense',
        item.id,
        item.date,
        `Expense — ${item.category}${item.vendorName ? ' — ' + item.vendorName : ''}`,
        [
          { accountId: expenseAccountId, debit: Number(item.amount), description: item.description || item.category },
          { accountId: bankJournalAccountId, credit: Number(item.amount), description: 'Expense payment' },
        ],
        actor,
        item.invoiceNumber,
      );
    } catch (err) {
      if (rethrow) throw err;
      console.error(`Auto-posting failed for expense ${item.id}:`, err);
    }
  }

  // Books Health Check "Re-post": rebuilds this expense's journal entry.
  async repostJournal(id: string, actor: ActorRef = {}) {
    const item = await this.findOne(id);
    await this.postJournalEntry(item, actor, true);
    return { reposted: true };
  }

  // If bankAccountId is set, records a real withdrawal (row-locked, same
  // insufficient-balance guard as everywhere else money moves) inside
  // the same DB transaction as the expense row, then auto-posts the
  // Journal Entry.
  async create(dto: CreateExpenseDto, actor: ActorRef = {}) {
    this.assertNotRawMaterial(dto.category);
    const date = dto.date || omanToday();
    await this.journalPosting.assertDateOpen(date, 'This expense');

    const saved = await this.dataSource.transaction(async (manager) => {
      let bankTransactionId: string | undefined;
      if (dto.bankAccountId) {
        const account = await manager.findOne(BankAccount, {
          where: { id: dto.bankAccountId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!account) throw new NotFoundException('Bank/cash account not found');
        const amount = Number(dto.amount);
        if (Number(account.currentBalance) < amount) {
          throw new BadRequestException(`Insufficient balance in ${account.name} for this expense.`);
        }
        account.currentBalance = Number(account.currentBalance) - amount;
        await manager.save(account);
        const txn = await manager.save(
          manager.create(BankTransaction, {
            bankAccountId: account.id,
            type: BankTransactionType.WITHDRAWAL,
            amount,
            date,
            note: `Expense — ${dto.category}`,
          }),
        );
        bankTransactionId = txn.id;
      }

      return manager.save(
        manager.create(Expense, { ...dto, date, bankTransactionId }),
      );
    });

    await this.postJournalEntry(saved, actor);
    return saved;
  }

  // Reverses any old bank-sync effect first (guarded — refuses if the
  // account no longer has enough balance to give the money back), then
  // re-applies with the new values — same pattern as
  // TaxPaymentService.update().
  async update(id: string, dto: UpdateExpenseDto, actor: ActorRef = {}) {
    const saved = await this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(Expense, { where: { id } });
      if (!item) throw new NotFoundException('Expense not found');
      if (dto.category && dto.category !== item.category) this.assertNotRawMaterial(dto.category);
      await this.journalPosting.assertDateOpen(item.date, 'This expense', manager);
      if (dto.date) await this.journalPosting.assertDateOpen(dto.date, 'The new date', manager);

      if (item.bankAccountId && item.bankTransactionId) {
        const oldAccount = await manager.findOne(BankAccount, {
          where: { id: item.bankAccountId },
          lock: { mode: 'pessimistic_write' },
        });
        if (oldAccount) {
          oldAccount.currentBalance = Number(oldAccount.currentBalance) + Number(item.amount);
          await manager.save(oldAccount);
        }
        await manager.delete(BankTransaction, item.bankTransactionId);
      }

      const category = dto.category ?? item.category;
      const amount = dto.amount != null ? Number(dto.amount) : Number(item.amount);
      const date = dto.date ?? item.date;
      const bankAccountId = dto.bankAccountId !== undefined ? dto.bankAccountId || undefined : item.bankAccountId;
      // every expense is paid from a bank/cash account, so its cost reaches the books
      if (!bankAccountId) throw new BadRequestException('Choose the bank or cash account this expense was paid from.');

      let bankTransactionId: string | undefined;
      if (bankAccountId) {
        const account = await manager.findOne(BankAccount, {
          where: { id: bankAccountId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!account) throw new NotFoundException('Bank/cash account not found');
        if (Number(account.currentBalance) < amount) {
          throw new BadRequestException(`Insufficient balance in ${account.name} for this expense.`);
        }
        account.currentBalance = Number(account.currentBalance) - amount;
        await manager.save(account);
        const txn = await manager.save(
          manager.create(BankTransaction, {
            bankAccountId: account.id,
            type: BankTransactionType.WITHDRAWAL,
            amount,
            date,
            note: `Expense — ${category}`,
          }),
        );
        bankTransactionId = txn.id;
      }

      Object.assign(item, dto);
      item.category = category;
      item.amount = amount;
      item.date = date;
      item.bankAccountId = bankAccountId;
      item.bankTransactionId = bankTransactionId;
      return manager.save(item);
    });

    await this.postJournalEntry(saved, actor);
    return saved;
  }

  // Saves/replaces the invoice scan (PDF or image) for this expense. Old
  // file (if any, and if its extension differs from the new one) is
  // removed so we don't accumulate orphaned files on repeated edits.
  async saveInvoiceFile(id: string, file: Express.Multer.File) {
    const item = await this.findOne(id);
    const { extension: ext } = verifyFileSignature(file.buffer, ['pdf', 'jpeg', 'png']);
    const fileName = `${id}${ext}`;
    const filePath = path.join(this.uploadDir, fileName);

    if (item.invoiceFilePath && item.invoiceFilePath !== filePath && fs.existsSync(item.invoiceFilePath)) {
      fs.unlinkSync(item.invoiceFilePath);
    }

    fs.writeFileSync(filePath, file.buffer);
    item.invoiceFilePath = filePath;
    return this.repo.save(item);
  }

  async getInvoiceFilePath(id: string): Promise<string> {
    const item = await this.findOne(id);
    if (!item.invoiceFilePath || !fs.existsSync(item.invoiceFilePath)) {
      throw new NotFoundException('No invoice file uploaded for this expense');
    }
    return path.resolve(item.invoiceFilePath);
  }

  async getTotalInRange(startDate: string, endDate: string) {
    const expenses = await this.repo.find({ where: { date: Between(startDate, endDate) } });
    const byCategory: Record<string, number> = {};
    let total = 0;
    for (const e of expenses) {
      const amt = Number(e.amount);
      total += amt;
      byCategory[e.category] = (byCategory[e.category] || 0) + amt;
    }
    return { total, byCategory, count: expenses.length };
  }

  // Expenses grouped by calendar day within a date range — used by the
  // Dashboard's Sales vs Expenses daily trend chart.
  async getDailyExpenses(startDate: string, endDate: string) {
    const expenses = await this.repo.find({ where: { date: Between(startDate, endDate) } });
    const byDate = new Map<string, number>();
    for (const e of expenses) {
      byDate.set(e.date, (byDate.get(e.date) || 0) + Number(e.amount));
    }
    return byDate;
  }
}
