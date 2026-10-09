import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { BankAccount, BankAccountType } from './bank-account.entity';
import { BankReconciliation } from './bank-reconciliation.entity';
import { BankTransaction, BankTransactionType } from './bank-transaction.entity';
import { CreateBankAccountDto, CreateBankTransactionDto, UpdateBankAccountDto } from './dto/bank-account.dto';
import { AccountService } from '../journal/account.service';
import { JournalPostingService } from '../journal/journal-posting.service';
import { BANK_TRANSACTION_CATEGORY_ACCOUNT_CODE } from './bank-transaction-category.enum';
import { omanToday } from '../common/oman-date';

interface ActorRef {
  userId?: string;
  email?: string;
}

@Injectable()
export class BankAccountService {
  constructor(
    @InjectRepository(BankAccount)
    private accountRepo: Repository<BankAccount>,
    @InjectRepository(BankTransaction)
    private txnRepo: Repository<BankTransaction>,
    private journalAccountService: AccountService,
    private journalPosting: JournalPostingService,
  ) {}

  // Picks (or creates) the Chart-of-Accounts Asset account a new
  // BankAccount should link to. Cash-type accounts share "1000 Cash in
  // Hand" for the first one created; every bank-type account (and any
  // additional cash-type one) gets its own freshly-created account so
  // each shows as its own line in the Trial Balance.
  private async linkToJournalAccount(bankAccount: BankAccount) {
    if (bankAccount.type === BankAccountType.CASH) {
      const cashInHand = await this.journalAccountService.findByCode('1000');
      const alreadyClaimed = cashInHand
        ? await this.accountRepo.findOne({ where: { journalAccountId: cashInHand.id } })
        : null;
      if (cashInHand && !alreadyClaimed) return cashInHand;
      return this.journalAccountService.createLinkedAssetAccount(bankAccount.name, 1000);
    }
    const name = bankAccount.bankName ? `Bank — ${bankAccount.bankName} — ${bankAccount.name}` : `Bank — ${bankAccount.name}`;
    return this.journalAccountService.createLinkedAssetAccount(name, 1013);
  }

  // Lazily links a BankAccount created before this feature existed, the
  // first time auto-posting needs its journalAccountId. Idempotent — a
  // bank account that's already linked is returned as-is.
  async ensureJournalAccountId(bankAccountId: string): Promise<string> {
    const item = await this.findOne(bankAccountId);
    if (item.journalAccountId) return item.journalAccountId;
    const linked = await this.linkToJournalAccount(item);
    item.journalAccountId = linked.id;
    await this.accountRepo.save(item);
    return linked.id;
  }

  findAll() {
    return this.accountRepo.find({ order: { name: 'ASC' } });
  }

  async findOne(id: string) {
    const item = await this.accountRepo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Bank/cash account not found');
    return item;
  }

  async create(dto: CreateBankAccountDto, actor: { userId?: string; email?: string } = {}) {
    const opening = dto.openingBalance ?? 0;
    // Once the books have started, money in a new account must come from
    // somewhere (a dated deposit or a fund transfer) - an "opening balance"
    // then would land in Opening Balance Equity dated today.
    if (opening !== 0 && (await this.journalPosting.lockedThrough())) {
      throw new BadRequestException(
        'The opening balances are already finalized, so a new account starts at 0. Put the money in with a dated deposit or a Fund Transfer.',
      );
    }
    const item = this.accountRepo.create({
      ...dto,
      openingBalance: opening,
      currentBalance: opening,
    });
    const saved = await this.accountRepo.save(item);

    // Auto-link to a Chart-of-Accounts Asset account so this bank/cash
    // account participates in auto-posting double-entry. Best-effort —
    // never blocks creating the bank account itself; an unlinked account
    // just gets linked lazily the first time auto-posting needs it (see
    // ensureJournalAccountId()).
    try {
      const linked = await this.linkToJournalAccount(saved);
      saved.journalAccountId = linked.id;
      await this.accountRepo.save(saved);
    } catch {
      /* linked lazily later if this failed */
    }

    // Before the opening balances are finalized, finalizing posts this
    // balance (Dr bank / Cr 3900) as of the opening date.
    return saved;
  }

  async update(id: string, dto: UpdateBankAccountDto) {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.accountRepo.save(item);
  }

  async remove(id: string) {
    const item = await this.findOne(id);
    // its balance is part of the books - deleting the account would leave
    // money in the Balance Sheet with no account behind it
    if ((await this.journalPosting.lockedThrough()) && Number(item.currentBalance) !== 0) {
      throw new BadRequestException(`${item.name} still has a balance of ${Number(item.currentBalance).toFixed(3)} OMR. Move it to another account first (Fund Transfer).`);
    }
    // .remove() (not .delete()) so the transaction history is kept with
    // the delete record and comes back on "Undo"
    const txns = await this.txnRepo.find({ where: { bankAccountId: id } });
    // its bank reconciliations go with it (an Undo brings the lines back
    // unreconciled)
    for (const t of txns) t.reconciliationId = null;
    await this.accountRepo.manager.delete(BankReconciliation, { bankAccountId: id });
    if (txns.length) await this.txnRepo.remove(txns);
    await this.journalPosting.removeForSource('bank_opening', id);
    await this.accountRepo.remove(item);
    return { deleted: true };
  }

  async listTransactions(bankAccountId: string) {
    await this.findOne(bankAccountId); // 404s if the account doesn't exist
    return this.txnRepo.find({ where: { bankAccountId }, order: { date: 'DESC', createdAt: 'DESC' } });
  }

  // Records a deposit/withdrawal and keeps the account's running
  // currentBalance in sync so reads never need to re-sum transactions.
  // If dto.category is set, also auto-posts a Journal Entry (Dr/Cr
  // against the matching Chart-of-Accounts code — see
  // bank-transaction-category.enum.ts) — see CreateBankTransactionDto
  // for why this is optional rather than always-on.
  async addTransaction(bankAccountId: string, dto: CreateBankTransactionDto, actor: ActorRef = {}) {
    const account = await this.findOne(bankAccountId);
    await this.journalPosting.assertDateOpen(dto.date || omanToday(), 'This transaction');
    const amount = Number(dto.amount);

    if (dto.type === BankTransactionType.WITHDRAWAL && Number(account.currentBalance) < amount) {
      throw new BadRequestException('Insufficient balance for this withdrawal.');
    }

    const txn = this.txnRepo.create({
      bankAccountId,
      type: dto.type,
      amount,
      date: dto.date || omanToday(),
      note: dto.note,
      category: dto.category,
    });
    await this.txnRepo.save(txn);

    account.currentBalance =
      dto.type === BankTransactionType.DEPOSIT
        ? Number(account.currentBalance) + amount
        : Number(account.currentBalance) - amount;
    await this.accountRepo.save(account);

    if (dto.category) {
      try {
        const categoryAccountId = await this.journalAccountService.findByCode(
          BANK_TRANSACTION_CATEGORY_ACCOUNT_CODE[dto.category],
        );
        const bankJournalAccountId = await this.ensureJournalAccountId(bankAccountId);
        if (categoryAccountId) {
          const lines =
            dto.type === BankTransactionType.DEPOSIT
              ? [
                  { accountId: bankJournalAccountId, debit: amount, description: dto.note || 'Deposit' },
                  { accountId: categoryAccountId.id, credit: amount, description: dto.note || 'Deposit' },
                ]
              : [
                  { accountId: categoryAccountId.id, debit: amount, description: dto.note || 'Withdrawal' },
                  { accountId: bankJournalAccountId, credit: amount, description: dto.note || 'Withdrawal' },
                ];
          await this.journalPosting.postForSource(
            'bank_transaction',
            txn.id,
            txn.date,
            dto.note || `${dto.type === BankTransactionType.DEPOSIT ? 'Deposit' : 'Withdrawal'} — ${account.name}`,
            lines,
            actor,
          );
        }
      } catch (err) {
        console.error(`Auto-posting failed for bank_transaction ${txn.id}:`, err);
      }
    }

    return txn;
  }

  // Sum of every account's current balance — used by the dashboard's
  // "Bank Accounts" panel and the You'll Receive/Pay style summary.
  async getTotalBalance() {
    const accounts = await this.findAll();
    return accounts.reduce((sum, a) => sum + Number(a.currentBalance), 0);
  }

  // Dashboard's "My Wallets" card — total balance across every cash/bank
  // account, plus total deposits (inflows) and withdrawals (outflows)
  // across all of them within a date range.
  async getWalletSummary(startDate: string, endDate: string) {
    const [balance, txns] = await Promise.all([
      this.getTotalBalance(),
      this.txnRepo.find({ where: { date: Between(startDate, endDate) } }),
    ]);
    let inflows = 0;
    let outflows = 0;
    for (const t of txns) {
      if (t.type === BankTransactionType.DEPOSIT) inflows += Number(t.amount);
      else outflows += Number(t.amount);
    }
    return { balance, inflows, outflows };
  }

  // Dashboard's "Cash & Bank Activity" table — per account, Opening/In/
  // Out/Closing for a date range. Closing is always the account's live
  // currentBalance (no transaction is ever dated in the future), and
  // Opening is reconstructed by removing the range's own activity from
  // it — there's no stored historical snapshot to read instead.
  async getActivityInRange(startDate: string, endDate: string) {
    const accounts = await this.findAll();
    const txns = await this.txnRepo.find({ where: { date: Between(startDate, endDate) } });
    const byAccount = new Map<string, { in: number; out: number }>();
    for (const t of txns) {
      const entry = byAccount.get(t.bankAccountId) || { in: 0, out: 0 };
      if (t.type === BankTransactionType.DEPOSIT) entry.in += Number(t.amount);
      else entry.out += Number(t.amount);
      byAccount.set(t.bankAccountId, entry);
    }
    return accounts.map((a) => {
      const activity = byAccount.get(a.id) || { in: 0, out: 0 };
      const closing = Number(a.currentBalance);
      const opening = closing - activity.in + activity.out;
      return {
        accountId: a.id,
        accountName: a.name,
        type: a.type,
        opening,
        in: activity.in,
        out: activity.out,
        closing,
      };
    });
  }
}
