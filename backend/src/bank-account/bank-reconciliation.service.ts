import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import { BankAccount } from './bank-account.entity';
import { BankTransaction, BankTransactionType } from './bank-transaction.entity';
import { BankReconciliation } from './bank-reconciliation.entity';
import { omanToday } from '../common/oman-date';

interface ActorRef {
  userId?: string;
  email?: string;
}

interface ItemCopy {
  id: string;
  type: BankTransactionType;
  amount: number;
  date: string;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const isDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

// Bank Reconciliation: tick off the ERP's bank lines against the bank
// statement. A reconciliation can only be completed when the previous
// statement's closing balance plus the ticked lines equals the new
// statement's closing balance exactly - so every completed statement
// proves the ERP and the bank agree up to that day. Lines that are in the
// ERP but not yet on the statement (cheques in transit) stay unticked and
// carry over to the next statement.
@Injectable()
export class BankReconciliationService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  private signed(t: { type: BankTransactionType; amount: number | string }) {
    return t.type === BankTransactionType.DEPOSIT ? Number(t.amount) : -Number(t.amount);
  }

  private async account(id: string, manager: EntityManager = this.dataSource.manager, lock = false) {
    const acc = await manager.findOne(BankAccount, { where: { id }, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}) });
    if (!acc) throw new NotFoundException('Bank/cash account not found');
    return acc;
  }

  private async last(bankAccountId: string, manager: EntityManager = this.dataSource.manager) {
    return manager.findOne(BankReconciliation, { where: { bankAccountId }, order: { statementDate: 'DESC', createdAt: 'DESC' } });
  }

  // ERP balance at the end of `date` (opening balance + every line up to it)
  private async bookBalance(acc: BankAccount, date: string, manager: EntityManager) {
    const [row] = await manager.query(
      `SELECT COALESCE(SUM(CASE WHEN type = 'deposit' THEN amount ELSE -amount END), 0) AS net
         FROM bank_transactions WHERE bankAccountId = ? AND date <= ?`,
      [acc.id, date],
    );
    return r3(Number(acc.openingBalance || 0) + Number(row?.net || 0));
  }

  private checkStatementDate(statementDate: unknown, last: BankReconciliation | null) {
    if (!isDate(statementDate)) throw new BadRequestException('Statement date must be YYYY-MM-DD.');
    if (statementDate > omanToday()) throw new BadRequestException('The statement date can not be in the future.');
    const lastDate = last ? String(last.statementDate).slice(0, 10) : null;
    if (lastDate && statementDate <= lastDate) {
      throw new BadRequestException(`This account is already reconciled up to ${lastDate}. Pick a later statement date.`);
    }
  }

  // Everything the Reconcile screen needs for one statement.
  async prepare(bankAccountId: string, statementDate: string) {
    const acc = await this.account(bankAccountId);
    const last = await this.last(bankAccountId);
    this.checkStatementDate(statementDate, last);
    const transactions = await this.dataSource.manager.find(BankTransaction, {
      where: { bankAccountId, reconciliationId: IsNull() },
      order: { date: 'ASC', createdAt: 'ASC' },
    });
    const due = transactions.filter((t) => String(t.date).slice(0, 10) <= statementDate);
    return {
      account: { id: acc.id, name: acc.name, type: acc.type },
      lastReconciliation: last
        ? { id: last.id, statementDate: String(last.statementDate).slice(0, 10), statementBalance: Number(last.statementBalance) }
        : null,
      openingBalance: last ? r3(Number(last.statementBalance)) : r3(Number(acc.openingBalance || 0)),
      bookBalance: await this.bookBalance(acc, statementDate, this.dataSource.manager),
      transactions: due.map((t) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        date: String(t.date).slice(0, 10),
        note: t.note,
        category: t.category || null,
      })),
      laterUnreconciled: transactions.length - due.length,
    };
  }

  async complete(
    bankAccountId: string,
    dto: { statementDate: string; statementBalance: number; transactionIds: string[] },
    actor: ActorRef = {},
  ) {
    const ids = Array.isArray(dto.transactionIds) ? [...new Set(dto.transactionIds.map(String))] : [];
    const statementBalance = Number(dto.statementBalance);
    if (!Number.isFinite(statementBalance)) throw new BadRequestException('Enter the closing balance shown on the bank statement.');

    return this.dataSource.transaction(async (manager) => {
      // one reconciliation per account at a time
      const acc = await this.account(bankAccountId, manager, true);
      const last = await this.last(bankAccountId, manager);
      this.checkStatementDate(dto.statementDate, last);

      const txns = ids.length ? await manager.find(BankTransaction, { where: { id: In(ids) }, lock: { mode: 'pessimistic_write' } }) : [];
      if (txns.length !== ids.length) throw new BadRequestException('Some ticked lines no longer exist - reload and try again.');
      for (const t of txns) {
        if (t.bankAccountId !== bankAccountId) throw new BadRequestException('A ticked line belongs to another account.');
        if (t.reconciliationId) throw new BadRequestException('A ticked line is already reconciled - reload and try again.');
        if (String(t.date).slice(0, 10) > dto.statementDate) {
          throw new BadRequestException(`A ticked line is dated ${String(t.date).slice(0, 10)}, after the statement date.`);
        }
      }

      const opening = last ? r3(Number(last.statementBalance)) : r3(Number(acc.openingBalance || 0));
      const cleared = r3(opening + txns.reduce((s, t) => s + this.signed(t), 0));
      const difference = r3(statementBalance - cleared);
      if (Math.abs(difference) > 0.0005) {
        throw new BadRequestException(
          `Not balanced: the ticked lines give ${cleared.toFixed(3)} but the statement says ${statementBalance.toFixed(3)} ` +
            `(difference ${difference.toFixed(3)}). Tick the missing lines, or record bank charges/interest that are on the statement but not in the ERP.`,
        );
      }

      const items: ItemCopy[] = txns.map((t) => ({ id: t.id, type: t.type, amount: r3(Number(t.amount)), date: String(t.date).slice(0, 10) }));
      const rec = await manager.save(
        manager.create(BankReconciliation, {
          bankAccountId,
          statementDate: dto.statementDate,
          statementBalance: r3(statementBalance),
          openingBalance: opening,
          bookBalance: await this.bookBalance(acc, dto.statementDate, manager),
          items: JSON.stringify(items),
          createdByEmail: actor.email || null,
        }),
      );
      if (ids.length) await manager.update(BankTransaction, { id: In(ids) }, { reconciliationId: rec.id });
      return this.describe(rec, manager);
    });
  }

  // A completed statement plus whether any of its ticked lines has since
  // been changed or deleted (which would make it no longer add up).
  private async describe(rec: BankReconciliation, manager: EntityManager = this.dataSource.manager) {
    const items: ItemCopy[] = JSON.parse(rec.items || '[]');
    const now = items.length ? await manager.find(BankTransaction, { where: { id: In(items.map((i) => i.id)) } }) : [];
    const byId = new Map(now.map((t) => [t.id, t]));
    const problems: string[] = [];
    for (const i of items) {
      const t = byId.get(i.id);
      if (!t) problems.push(`${i.date} ${i.type} ${i.amount.toFixed(3)} was deleted`);
      else if (t.type !== i.type || Math.abs(Number(t.amount) - i.amount) > 0.0005 || String(t.date).slice(0, 10) !== i.date) {
        problems.push(`${i.date} ${i.type} ${i.amount.toFixed(3)} was changed`);
      } else if (t.reconciliationId !== rec.id) problems.push(`${i.date} ${i.type} ${i.amount.toFixed(3)} was un-ticked`);
    }
    return {
      id: rec.id,
      bankAccountId: rec.bankAccountId,
      statementDate: String(rec.statementDate).slice(0, 10),
      statementBalance: Number(rec.statementBalance),
      openingBalance: Number(rec.openingBalance),
      bookBalance: Number(rec.bookBalance),
      inTransit: r3(Number(rec.bookBalance) - Number(rec.statementBalance)),
      lineCount: items.length,
      createdByEmail: rec.createdByEmail,
      createdAt: rec.createdAt,
      problems,
    };
  }

  async list(bankAccountId: string) {
    await this.account(bankAccountId);
    const recs = await this.dataSource.manager.find(BankReconciliation, {
      where: { bankAccountId },
      order: { statementDate: 'DESC', createdAt: 'DESC' },
    });
    return Promise.all(recs.map((r) => this.describe(r)));
  }

  // Only the latest statement of an account can be undone (later ones
  // start from its closing balance).
  async undo(id: string) {
    return this.dataSource.transaction(async (manager) => {
      const rec = await manager.findOne(BankReconciliation, { where: { id } });
      if (!rec) throw new NotFoundException('Reconciliation not found');
      await this.account(rec.bankAccountId, manager, true);
      const latest = await this.last(rec.bankAccountId, manager);
      if (latest && latest.id !== rec.id) {
        throw new BadRequestException(`Undo the later statement (${String(latest.statementDate).slice(0, 10)}) first.`);
      }
      await manager.update(BankTransaction, { reconciliationId: rec.id }, { reconciliationId: null });
      await manager.delete(BankReconciliation, { id: rec.id });
      return { undone: true };
    });
  }
}
