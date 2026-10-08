import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { randomUUID } from 'crypto';
import { JournalPostingService } from '../journal/journal-posting.service';
import { omanToday } from '../common/oman-date';

export const RAW_MATERIAL_INVENTORY_CODE = '1200';
export const FINISHED_GOODS_INVENTORY_CODE = '1210';
export const INVENTORY_ADJUSTMENT_CODE = '5110';

// Once the books have started (opening balances finalized), stock may only
// change through flows that also post to the ledger. Before that, stock is
// a draft that the opening balances replace.
export async function booksStarted(journal: JournalPostingService, manager?: EntityManager) {
  return !!(await journal.lockedThrough(manager));
}

export async function assertNoUnpostedStock(journal: JournalPostingService, qty: number | string | undefined, what: string) {
  if (Number(qty || 0) > 0 && (await booksStarted(journal))) {
    throw new BadRequestException(
      `${what}: stock can't be typed in here once the books have started - use "Add stock" (raw material), a production order, or a purchase order, so its value reaches the books.`,
    );
  }
}

// A manual stock change (Add stock, scan in/out): Dr/Cr the inventory
// account against 5110 Inventory Adjustments at cost, so the ledger keeps
// matching quantity x cost. Posted in the caller's transaction.
export async function postStockAdjustment(
  journal: JournalPostingService,
  manager: EntityManager,
  opts: { inventoryCode: string; amount: number; memo: string; actor?: { userId?: string; email?: string } },
) {
  const amount = Math.round(Number(opts.amount || 0) * 1000) / 1000;
  if (Math.abs(amount) < 0.0005 || !(await booksStarted(journal, manager))) return;
  const today = omanToday();
  await journal.assertDateOpen(today, 'This stock change', manager);
  const inventory = await journal.findAccountIdByCode(opts.inventoryCode);
  const adjustment = await journal.findAccountIdByCode(INVENTORY_ADJUSTMENT_CODE);
  const v = Math.abs(amount);
  await journal.postForSource(
    'stock_adjustment',
    randomUUID(),
    today,
    opts.memo,
    amount > 0
      ? [
          { accountId: inventory, debit: v, description: opts.memo },
          { accountId: adjustment, credit: v, description: opts.memo },
        ]
      : [
          { accountId: adjustment, debit: v, description: opts.memo },
          { accountId: inventory, credit: v, description: opts.memo },
        ],
    opts.actor || {},
    undefined,
    manager,
  );
}
