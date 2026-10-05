import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BankAccount } from '../bank-account/bank-account.entity';
import { BankTransaction, BankTransactionType } from '../bank-account/bank-transaction.entity';

// One bank/cash movement inside a transaction: row-locks the account,
// refuses a withdrawal the balance can't cover (same rule as every
// create() in the app), updates the balance and records the bank
// transaction. Returns the new transaction's id. Used by the "Undo"
// of deleted money records.
export async function applyBankMovement(
  manager: EntityManager,
  opts: { accountId: string; type: BankTransactionType; amount: number; date: string; note: string },
): Promise<string> {
  const amount = Math.round(Number(opts.amount) * 1000) / 1000;
  const account = await manager.findOne(BankAccount, { where: { id: opts.accountId }, lock: { mode: 'pessimistic_write' } });
  if (!account) throw new BadRequestException('The bank/cash account used by this record no longer exists - restore that account first.');
  if (opts.type === BankTransactionType.WITHDRAWAL) {
    if (Number(account.currentBalance) < amount - 0.0005) {
      throw new BadRequestException(
        `Not enough balance in ${account.name} (${Number(account.currentBalance).toFixed(3)} OMR) to put back ${amount.toFixed(3)} OMR.`,
      );
    }
    account.currentBalance = Math.round((Number(account.currentBalance) - amount) * 1000) / 1000;
  } else {
    account.currentBalance = Math.round((Number(account.currentBalance) + amount) * 1000) / 1000;
  }
  await manager.save(account);
  const txn = await manager.save(manager.create(BankTransaction, { bankAccountId: account.id, type: opts.type, amount, date: opts.date, note: opts.note }));
  return txn.id;
}

// The captured row of a deleted record, with date/time columns back as
// Date objects so it can be inserted again unchanged.
export function rowForInsert(data: Record<string, unknown>, dateTimeKeys: string[] = ['createdAt', 'updatedAt']) {
  const out: Record<string, unknown> = { ...data };
  for (const k of dateTimeKeys) if (typeof out[k] === 'string') out[k] = new Date(out[k] as string);
  return out;
}
