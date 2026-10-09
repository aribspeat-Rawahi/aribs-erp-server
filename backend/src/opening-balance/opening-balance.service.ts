import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Not } from 'typeorm';
import { OpeningBalanceKind, OpeningBalanceLine } from './opening-balance-line.entity';
import { SaveOpeningLineDto } from './opening-balance.dto';
import { Settings } from '../settings/settings.entity';
import { BankAccount } from '../bank-account/bank-account.entity';
import { BankTransaction } from '../bank-account/bank-transaction.entity';
import { BankAccountService } from '../bank-account/bank-account.service';
import { Customer } from '../customer/customer.entity';
import { Supplier } from '../supplier/supplier.entity';
import { RawMaterial } from '../inventory/raw-material.entity';
import { FinishedGood } from '../inventory/finished-good.entity';
import { RawMaterialBatch } from '../inventory/raw-material-batch.entity';
import { FinishedGoodBatch } from '../inventory/finished-good-batch.entity';
import { BatchTrackingService } from '../inventory/batch-tracking.service';
import { BatchSource } from '../inventory/batch-source.enum';
import { Account, AccountType } from '../journal/account.entity';
import { JournalEntry } from '../journal/journal-entry.entity';
import { JournalPostingService, PostingLine } from '../journal/journal-posting.service';
import { Invoice } from '../invoice/invoice.entity';
import { PurchaseOrder, PurchaseOrderStatus } from '../supplier/purchase-order.entity';
import { PaymentStatus } from '../common/payment-type.enum';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { assertQuantityForUnit } from '../units/units';

interface Actor {
  userId?: string;
  email?: string;
}

// Accounts whose opening balance comes from their own section (so the
// customer/supplier/stock/bank records always agree with the books).
const SECTION_ACCOUNT_CODES: Record<string, string> = {
  '1100': 'Customers (unpaid invoices)',
  '2000': 'Suppliers (unpaid bills)',
  '1200': 'Stock (raw materials)',
  '1210': 'Stock (finished goods)',
  '3900': 'the automatic balancing line',
};

const OPENING_SOURCE = 'opening_balance';
const OPENING_SOURCE_ID = 'opening';

// Accounting > Opening Balances. Closing balances of the old books are
// typed in as draft lines, checked, then "finalized" in one transaction:
//  - bank/cash  -> bank account balance + Dr bank
//  - customers  -> one opening invoice per unpaid old invoice + Dr 1100
//  - suppliers  -> one opening bill (purchase order) per unpaid bill + Cr 2000
//  - stock      -> an opening batch at its real cost + Dr 1200 / 1210
//  - other      -> Dr/Cr as typed (fixed assets, loans, VAT, capital...)
// The other side of everything is 3900 Opening Balance Equity, and the
// whole thing is ONE journal entry dated the opening date (balance sheet
// only - no profit or loss). After finalize nothing can be posted on or
// before the opening date (JournalPostingService.assertDateOpen).
@Injectable()
export class OpeningBalanceService {
  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private bankAccounts: BankAccountService,
    private batches: BatchTrackingService,
    private journalPosting: JournalPostingService,
    private activityLog: ActivityLogService,
  ) {}

  private round3(n: number) {
    return Math.round(Number(n || 0) * 1000) / 1000;
  }

  private async settings(manager: EntityManager = this.dataSource.manager, lock = false) {
    let s = await manager.findOne(Settings, { where: { id: 1 }, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}) });
    if (!s) s = await manager.save(manager.create(Settings, { id: 1 }));
    return s;
  }

  private assertNotFinalized(s: Settings) {
    if (s.openingBalanceFinalizedAt) {
      throw new BadRequestException('Opening balances are finalized and can no longer be changed. Correct them with a journal entry dated after the opening date.');
    }
  }

  private openingDate(s: Settings): string {
    if (!s.openingBalanceDate) throw new BadRequestException('Set the opening balance date first.');
    return String(s.openingBalanceDate).slice(0, 10);
  }

  // ---------------------------------------------------------------- read

  async getOverview() {
    const m = this.dataSource.manager;
    const s = await this.settings();
    const lines = await m.find(OpeningBalanceLine, { order: { createdAt: 'ASC' } });
    const [banks, customers, suppliers, raws, goods, accounts] = await Promise.all([
      m.find(BankAccount, { order: { name: 'ASC' } }),
      m.find(Customer, { where: { id: In(this.refIds(lines, OpeningBalanceKind.CUSTOMER)) } }),
      m.find(Supplier, { where: { id: In(this.refIds(lines, OpeningBalanceKind.SUPPLIER)) } }),
      m.find(RawMaterial, { order: { name: 'ASC' } }),
      m.find(FinishedGood, { order: { name: 'ASC' } }),
      m.find(Account, { order: { code: 'ASC' } }),
    ]);
    const name = <T extends { id: string; name: string }>(list: T[], id: string) => list.find((x) => x.id === id)?.name || '(deleted)';
    const lineFor = (kind: OpeningBalanceKind, refId: string) => lines.find((l) => l.kind === kind && l.refId === refId) || null;

    const finalized = !!s.openingBalanceFinalizedAt;
    const bankRows = banks.map((b) => {
      const line = lineFor(OpeningBalanceKind.BANK, b.id);
      return {
        bankAccountId: b.id,
        name: b.name,
        type: b.type,
        lineId: line?.id || null,
        // No line yet: the balance typed when the account was created
        // (finalize uses it). After finalize only what was posted counts -
        // an account opened later is not part of the opening balances.
        amount: line ? this.round3(line.amount) : finalized ? 0 : this.round3(b.openingBalance),
        fromAccountSetup: !finalized && !line && Number(b.openingBalance) !== 0,
        openedLater: finalized && !line,
      };
    });
    const stockRows = (kind: OpeningBalanceKind, items: (RawMaterial | FinishedGood)[]) =>
      items.map((it) => {
        const line = lineFor(kind, it.id);
        return {
          itemId: it.id,
          name: it.name,
          unit: it.unit,
          currentStock: this.round3(it.quantityInStock),
          currentCost: this.round3(it.costPerUnit),
          lineId: line?.id || null,
          quantity: line ? this.round3(line.quantity || 0) : null,
          unitCost: line ? this.round3(line.unitCost || 0) : null,
          value: line ? this.round3(line.amount) : null,
        };
      });
    const docRows = (kind: OpeningBalanceKind, parties: { id: string; name: string }[]) =>
      lines
        .filter((l) => l.kind === kind)
        .map((l) => ({
          id: l.id,
          partyId: l.refId,
          partyName: name(parties, l.refId),
          documentNumber: l.documentNumber,
          documentDate: l.documentDate,
          dueDate: l.dueDate,
          amount: this.round3(l.amount),
          note: l.note,
          postedRefId: l.postedRefId,
        }));
    const accountRows = lines
      .filter((l) => l.kind === OpeningBalanceKind.ACCOUNT)
      .map((l) => {
        const a = accounts.find((x) => x.id === l.refId);
        return { id: l.id, accountId: l.refId, code: a?.code, name: a?.name || '(deleted)', type: a?.type, debit: this.round3(l.debit), credit: this.round3(l.credit), note: l.note };
      });

    const summary = this.summarize(lines, bankRows.map((b) => b.amount));
    const linkedBankAccountIds = new Set(banks.map((b) => b.journalAccountId).filter(Boolean));
    return {
      openingBalanceDate: s.openingBalanceDate ? String(s.openingBalanceDate).slice(0, 10) : null,
      finalizedAt: s.openingBalanceFinalizedAt,
      finalizedBy: s.openingBalanceFinalizedBy,
      banks: bankRows,
      customers: docRows(OpeningBalanceKind.CUSTOMER, customers),
      suppliers: docRows(OpeningBalanceKind.SUPPLIER, suppliers),
      rawMaterials: stockRows(OpeningBalanceKind.RAW_MATERIAL, raws),
      finishedGoods: stockRows(OpeningBalanceKind.FINISHED_GOOD, goods),
      accounts: accountRows,
      // accounts that may get an "other account" line
      accountOptions: accounts
        .filter((a) => a.active !== false && this.accountProblem(a, linkedBankAccountIds) === null)
        .map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type })),
      summary,
      blockers: s.openingBalanceFinalizedAt ? [] : await this.blockers(),
      warnings: s.openingBalanceFinalizedAt ? [] : this.warnings(raws, goods, lines),
    };
  }

  private refIds(lines: OpeningBalanceLine[], kind: OpeningBalanceKind) {
    const ids = lines.filter((l) => l.kind === kind).map((l) => l.refId);
    return ids.length ? ids : [''];
  }

  // Debits = credits once 3900 Opening Balance Equity takes the difference.
  private summarize(lines: OpeningBalanceLine[], bankAmounts: number[]) {
    const sum = (kind: OpeningBalanceKind, f: (l: OpeningBalanceLine) => number) =>
      this.round3(lines.filter((l) => l.kind === kind).reduce((t, l) => t + f(l), 0));
    const bank = this.round3(bankAmounts.reduce((t, a) => t + a, 0));
    const customers = sum(OpeningBalanceKind.CUSTOMER, (l) => Number(l.amount));
    const suppliers = sum(OpeningBalanceKind.SUPPLIER, (l) => Number(l.amount));
    const rawMaterials = sum(OpeningBalanceKind.RAW_MATERIAL, (l) => Number(l.amount));
    const finishedGoods = sum(OpeningBalanceKind.FINISHED_GOOD, (l) => Number(l.amount));
    const otherDebit = sum(OpeningBalanceKind.ACCOUNT, (l) => Number(l.debit));
    const otherCredit = sum(OpeningBalanceKind.ACCOUNT, (l) => Number(l.credit));
    const totalDebit = this.round3(bank + customers + rawMaterials + finishedGoods + otherDebit);
    const totalCredit = this.round3(suppliers + otherCredit);
    // positive = credit balance on 3900 (normal for equity)
    const openingBalanceEquity = this.round3(totalDebit - totalCredit);
    return { bank, customers, suppliers, rawMaterials, finishedGoods, otherDebit, otherCredit, totalDebit, totalCredit, openingBalanceEquity };
  }

  // Records already in the books stop finalize: opening balances must be
  // the first thing in the books, or they mix with test data.
  private async blockers() {
    const rows: { sourceType: string | null; n: string }[] = await this.dataSource.manager
      .createQueryBuilder(JournalEntry, 'e')
      .select('e.sourceType', 'sourceType')
      .addSelect('COUNT(*)', 'n')
      .where('(e.sourceType IS NULL OR e.sourceType <> :src)', { src: OPENING_SOURCE })
      .groupBy('e.sourceType')
      .getRawMany();
    const bankTxns = await this.dataSource.manager.count(BankTransaction);
    const out = rows.map((r) => ({ what: this.sourceLabel(r.sourceType), count: Number(r.n) }));
    if (bankTxns > 0) out.push({ what: 'Bank transactions', count: bankTxns });
    return out;
  }

  private sourceLabel(t: string | null) {
    const labels: Record<string, string> = {
      invoice: 'Invoices',
      invoice_payment: 'Invoice payments',
      goods_receipt: 'Goods received (purchase orders)',
      supplier_payment: 'Supplier payments',
      expense: 'Expenses',
      bank_transaction: 'Bank transactions',
      fund_transfer: 'Fund transfers',
      tax_payment: 'Tax payments',
      sales_return: 'Sales returns',
      purchase_return: 'Purchase returns',
      production_order: 'Production orders',
      payroll: 'Payroll payments',
      payroll_accrual: 'Payroll accruals',
      journal_import: 'Imported journal entries',
      invoice_cogs: 'Invoice stock costs (COGS)',
      purchase_order: 'Purchase orders',
      vendor_credit: 'Vendor credits',
      vendor_credit_refund: 'Vendor credit refunds',
      vendor_prepayment: 'Vendor prepayments',
      vendor_prepayment_application: 'Vendor prepayment applications',
      fixed_asset_purchase: 'Fixed asset purchases',
      fixed_asset_depreciation: 'Fixed asset depreciation',
      fixed_asset_disposal: 'Fixed asset disposals',
      eosb_accrual: 'End-of-service accruals',
      income_tax_provision: 'Income tax provisions',
      reimbursement: 'Reimbursements',
      salary_advance: 'Salary advances',
      bank_opening: 'Bank account opening balances',
      vat_settlement: 'VAT settlements',
    };
    if (!t) return 'Manual journal entries';
    return labels[t] || `Journal entries (${t.replace(/_/g, ' ')})`;
  }

  private warnings(raws: RawMaterial[], goods: FinishedGood[], lines: OpeningBalanceLine[]) {
    const has = new Set(lines.filter((l) => l.kind === OpeningBalanceKind.RAW_MATERIAL || l.kind === OpeningBalanceKind.FINISHED_GOOD).map((l) => l.refId));
    const missing = [...raws, ...goods].filter((i) => Number(i.quantityInStock) > 0 && !has.has(i.id)).map((i) => i.name);
    return missing.length
      ? [`${missing.length} item(s) have stock but no opening line, so that stock stays at no value: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}`]
      : [];
  }

  // ---------------------------------------------------------------- edit

  async setDate(date: string, actor: Actor) {
    return this.dataSource.transaction(async (m) => {
      const s = await this.settings(m, true);
      this.assertNotFinalized(s);
      const d = date.slice(0, 10);
      // Lines dated after the new date would be outside the old books.
      const docLines = await m.find(OpeningBalanceLine, { where: { kind: In([OpeningBalanceKind.CUSTOMER, OpeningBalanceKind.SUPPLIER]) } });
      const after = docLines.filter((l) => l.documentDate && String(l.documentDate).slice(0, 10) > d);
      if (after.length) {
        throw new BadRequestException(`${after.length} invoice/bill line(s) are dated after ${d}. Change or remove them first.`);
      }
      s.openingBalanceDate = d;
      await m.save(s);
      await this.activityLog.log({ userId: actor.userId, userEmail: actor.email, action: 'opening_balance.date_set', entityType: 'settings', entityId: '1', details: { openingBalanceDate: d } });
      return { openingBalanceDate: d };
    });
  }

  async saveLine(dto: SaveOpeningLineDto, actor: Actor, id?: string) {
    return this.dataSource.transaction(async (m) => {
      const s = await this.settings(m, true);
      this.assertNotFinalized(s);
      const date = this.openingDate(s);
      let line: OpeningBalanceLine | null = null;
      if (id) {
        line = await m.findOne(OpeningBalanceLine, { where: { id } });
        if (!line) throw new NotFoundException('Opening balance line not found');
        if (line.kind !== dto.kind) throw new BadRequestException('A line cannot change its type.');
      } else if (
        [OpeningBalanceKind.BANK, OpeningBalanceKind.RAW_MATERIAL, OpeningBalanceKind.FINISHED_GOOD, OpeningBalanceKind.ACCOUNT].includes(dto.kind)
      ) {
        // one line per bank account / item / account: saving again updates it
        line = await m.findOne(OpeningBalanceLine, { where: { kind: dto.kind, refId: dto.refId } });
      }
      const values = await this.validateLine(m, dto, date, line?.id);
      const saved = await m.save(OpeningBalanceLine, { ...(line || {}), ...values, kind: dto.kind, refId: dto.refId, createdByEmail: line?.createdByEmail || actor.email || null });
      return saved;
    });
  }

  async removeLine(id: string) {
    return this.dataSource.transaction(async (m) => {
      const s = await this.settings(m, true);
      this.assertNotFinalized(s);
      const line = await m.findOne(OpeningBalanceLine, { where: { id } });
      if (!line) throw new NotFoundException('Opening balance line not found');
      await m.remove(line);
      return { deleted: true };
    });
  }

  private accountProblem(a: Account, linkedBankAccountIds: Set<string | undefined>): string | null {
    if (SECTION_ACCOUNT_CODES[a.code]) return `${a.code} ${a.name} is filled from ${SECTION_ACCOUNT_CODES[a.code]}.`;
    if (linkedBankAccountIds.has(a.id)) return `${a.code} ${a.name} belongs to a bank/cash account - use the Bank & Cash section.`;
    if (a.type === AccountType.REVENUE || a.type === AccountType.EXPENSE) {
      return `${a.code} ${a.name} is an income/expense account. Old income and expenses are already inside the profit you carry over - put that in Retained Earnings.`;
    }
    return null;
  }

  private async validateLine(m: EntityManager, dto: SaveOpeningLineDto, openingDate: string, lineId?: string) {
    const base = {
      documentNumber: null as string | null,
      documentDate: null as string | null,
      dueDate: null as string | null,
      quantity: null as number | null,
      unitCost: null as number | null,
      amount: 0,
      debit: 0,
      credit: 0,
      note: dto.note?.trim() || null,
    };
    switch (dto.kind) {
      case OpeningBalanceKind.BANK: {
        if (!(await m.findOne(BankAccount, { where: { id: dto.refId } }))) throw new NotFoundException('Bank/cash account not found');
        return { ...base, amount: this.round3(dto.amount ?? 0) };
      }
      case OpeningBalanceKind.CUSTOMER:
      case OpeningBalanceKind.SUPPLIER: {
        const isCustomer = dto.kind === OpeningBalanceKind.CUSTOMER;
        const party = isCustomer
          ? await m.findOne(Customer, { where: { id: dto.refId } })
          : await m.findOne(Supplier, { where: { id: dto.refId } });
        if (!party) throw new NotFoundException(isCustomer ? 'Customer not found' : 'Supplier not found');
        const number = dto.documentNumber?.trim();
        if (!number) throw new BadRequestException(isCustomer ? 'Enter the old invoice number.' : "Enter the supplier's bill number.");
        const amount = this.round3(dto.amount ?? 0);
        if (amount <= 0) throw new BadRequestException('Enter the unpaid amount (more than 0).');
        if (!dto.documentDate) throw new BadRequestException(isCustomer ? 'Enter the invoice date.' : 'Enter the bill date.');
        const docDate = dto.documentDate.slice(0, 10);
        if (docDate > openingDate) throw new BadRequestException(`The date must be on or before the opening date (${openingDate}).`);
        const due = dto.dueDate ? dto.dueDate.slice(0, 10) : null;
        if (due && due < docDate) throw new BadRequestException('The due date cannot be before the invoice/bill date.');
        // the same number twice would be the same invoice twice
        const dupWhere: any = { kind: dto.kind, documentNumber: number, ...(lineId ? { id: Not(lineId) } : {}) };
        if (!isCustomer) dupWhere.refId = dto.refId;
        if (await m.findOne(OpeningBalanceLine, { where: dupWhere })) {
          throw new BadRequestException(isCustomer ? `Invoice ${number} is already in the list.` : `Bill ${number} of this supplier is already in the list.`);
        }
        if (isCustomer && (await m.findOne(Invoice, { where: { invoiceNumber: number } }))) {
          throw new BadRequestException(`An invoice numbered ${number} already exists in the ERP. Use the old system's exact number, or add a prefix (e.g. OLD-${number}).`);
        }
        return { ...base, documentNumber: number, documentDate: docDate, dueDate: due, amount };
      }
      case OpeningBalanceKind.RAW_MATERIAL:
      case OpeningBalanceKind.FINISHED_GOOD: {
        const item =
          dto.kind === OpeningBalanceKind.RAW_MATERIAL
            ? await m.findOne(RawMaterial, { where: { id: dto.refId } })
            : await m.findOne(FinishedGood, { where: { id: dto.refId } });
        if (!item) throw new NotFoundException('Item not found');
        const quantity = this.round3(dto.quantity ?? 0);
        if (quantity <= 0) throw new BadRequestException('Enter the quantity on hand (more than 0).');
        assertQuantityForUnit(quantity, item.unit, 'Quantity');
        const unitCost = this.round3(dto.unitCost ?? 0);
        if (unitCost <= 0) throw new BadRequestException('Enter the cost per unit (more than 0) - stock is valued at cost.');
        return { ...base, quantity, unitCost, amount: this.round3(quantity * unitCost) };
      }
      case OpeningBalanceKind.ACCOUNT: {
        const account = await m.findOne(Account, { where: { id: dto.refId } });
        if (!account) throw new NotFoundException('Account not found');
        const banks = await m.find(BankAccount);
        const problem = this.accountProblem(account, new Set(banks.map((b) => b.journalAccountId)));
        if (problem) throw new BadRequestException(problem);
        const debit = this.round3(dto.debit ?? 0);
        const credit = this.round3(dto.credit ?? 0);
        if ((debit > 0) === (credit > 0)) throw new BadRequestException('Enter either a debit or a credit amount (one of them).');
        return { ...base, debit, credit };
      }
      default:
        throw new BadRequestException('Unknown line type');
    }
  }

  // ------------------------------------------------------------ finalize

  async finalize(actor: Actor) {
    // Bank accounts need their Chart-of-Accounts link before the main
    // transaction (linking creates accounts through another service).
    const banksBefore = await this.dataSource.manager.find(BankAccount);
    const bankGl = new Map<string, string>();
    for (const b of banksBefore) bankGl.set(b.id, await this.bankAccounts.ensureJournalAccountId(b.id));

    const result = await this.dataSource.transaction(async (m) => {
      const s = await this.settings(m, true);
      this.assertNotFinalized(s);
      const date = this.openingDate(s);

      const blockers = await this.blockers();
      if (blockers.length) {
        throw new BadRequestException(
          `Opening balances must be the first entries in the books. Delete these first (test data): ${blockers.map((b) => `${b.count} ${b.what}`).join(', ')}.`,
        );
      }

      const lines = await m.find(OpeningBalanceLine, { order: { createdAt: 'ASC' } });
      // everything is checked again - a customer, item or account may have
      // changed since the line was typed
      for (const l of lines) {
        await this.validateLine(m, l as unknown as SaveOpeningLineDto, date, l.id);
      }

      const code = async (c: string) => {
        const a = await m.findOne(Account, { where: { code: c } });
        if (!a) throw new BadRequestException(`Chart of Accounts code ${c} is missing.`);
        return a.id;
      };
      const journal: PostingLine[] = [];
      const counts = { banks: 0, invoices: 0, bills: 0, items: 0, accounts: 0 };

      // --- bank & cash
      const banks = await m.find(BankAccount, { lock: { mode: 'pessimistic_write' } });
      for (const b of banks) {
        let line = lines.find((l) => l.kind === OpeningBalanceKind.BANK && l.refId === b.id);
        const amount = this.round3(line ? line.amount : b.openingBalance);
        // keep a line for every account, so the page shows what was posted
        if (!line) {
          line = m.create(OpeningBalanceLine, { kind: OpeningBalanceKind.BANK, refId: b.id, amount, createdByEmail: actor.email || null });
          lines.push(line);
        }
        b.openingBalance = amount;
        b.currentBalance = amount; // no other bank transactions exist (checked above)
        b.journalAccountId = bankGl.get(b.id) || b.journalAccountId;
        await m.save(b);
        if (amount > 0) {
          journal.push({ accountId: b.journalAccountId!, debit: amount, description: `Opening balance - ${b.name}` });
          counts.banks++;
        }
        if (line) line.postedRefId = b.id;
      }

      // --- customers: one opening invoice per unpaid old invoice.
      // Negative sequence numbers keep the INV-YYYY-NNNN series gap-free.
      const minInv = await m.createQueryBuilder(Invoice, 'i').select('MIN(i.sequenceNumber)', 'min').getRawOne();
      let invSeq = Math.min(0, Number(minInv?.min || 0));
      const ar = await code('1100');
      for (const l of lines.filter((x) => x.kind === OpeningBalanceKind.CUSTOMER)) {
        invSeq -= 1;
        const amount = this.round3(l.amount);
        const res = await m.insert(Invoice, {
          sequenceNumber: invSeq,
          invoiceNumber: l.documentNumber!,
          customerId: l.refId,
          issueDate: String(l.documentDate).slice(0, 10),
          dueDate: l.dueDate ? String(l.dueDate).slice(0, 10) : (null as any),
          subtotal: amount,
          discountAmount: 0,
          vatAmount: 0,
          total: amount,
          vatExcluded: false,
          isOpening: true,
          paymentStatus: PaymentStatus.DUE,
          paidAmount: 0,
          deliveryStatus: 'delivered',
          deliveredAt: new Date(`${date}T00:00:00Z`),
          deliveredVia: 'opening',
          waitingForStock: false,
          cogsAmount: 0,
        });
        l.postedRefId = String(res.identifiers[0].id);
        journal.push({ accountId: ar, debit: amount, description: `Opening - unpaid invoice ${l.documentNumber}` });
        counts.invoices++;
      }

      // --- suppliers: one opening bill per unpaid bill
      const minPo = await m.createQueryBuilder(PurchaseOrder, 'p').select('MIN(p.sequenceNumber)', 'min').getRawOne();
      let poSeq = Math.min(0, Number(minPo?.min || 0));
      const ap = await code('2000');
      let billNo = await m.count(PurchaseOrder, { where: { isOpening: true } });
      for (const l of lines.filter((x) => x.kind === OpeningBalanceKind.SUPPLIER)) {
        poSeq -= 1;
        billNo += 1;
        const amount = this.round3(l.amount);
        const docDate = String(l.documentDate).slice(0, 10);
        const res = await m.insert(PurchaseOrder, {
          sequenceNumber: poSeq,
          poNumber: `OB-${String(billNo).padStart(4, '0')}`,
          supplierId: l.refId,
          status: PurchaseOrderStatus.RECEIVED,
          notes: `Opening balance - supplier bill ${l.documentNumber}${l.note ? ` - ${l.note}` : ''}`,
          receivedAt: new Date(`${docDate}T00:00:00Z`),
          subtotal: amount,
          vatAmount: 0,
          total: amount,
          paidAmount: 0,
          paymentStatus: PaymentStatus.DUE,
          receivedSubtotal: amount,
          receivedVat: 0,
          receivedTotal: amount,
          isOpening: true,
          openingReference: l.documentNumber,
          dueDate: l.dueDate ? String(l.dueDate).slice(0, 10) : null,
          createdAt: new Date(`${docDate}T00:00:00Z`),
        });
        l.postedRefId = String(res.identifiers[0].id);
        journal.push({ accountId: ap, credit: amount, description: `Opening - unpaid bill ${l.documentNumber}` });
        counts.bills++;
      }

      // --- stock: the opening line replaces whatever was typed in before
      // (old uncosted stock), as one opening batch at its real cost
      const rmAccount = await code('1200');
      const fgAccount = await code('1210');
      for (const l of lines.filter((x) => x.kind === OpeningBalanceKind.RAW_MATERIAL)) {
        const item = await m.findOne(RawMaterial, { where: { id: l.refId }, lock: { mode: 'pessimistic_write' } });
        if (!item) throw new NotFoundException('Raw material not found');
        await m.update(RawMaterialBatch, { rawMaterialId: item.id }, { quantityRemaining: 0 });
        const batch = await this.batches.createRawMaterialBatch(m, {
          rawMaterialId: item.id,
          quantity: Number(l.quantity),
          costPerUnit: Number(l.unitCost),
          source: BatchSource.OPENING_BALANCE,
          notes: 'Opening balance',
        });
        await m.update(RawMaterialBatch, { id: batch.id }, { receivedDate: date });
        item.quantityInStock = Number(l.quantity);
        item.costPerUnit = Number(l.unitCost);
        await m.save(item);
        l.postedRefId = batch.id;
        journal.push({ accountId: rmAccount, debit: this.round3(l.amount), description: `Opening stock - ${item.name}` });
        counts.items++;
      }
      for (const l of lines.filter((x) => x.kind === OpeningBalanceKind.FINISHED_GOOD)) {
        const item = await m.findOne(FinishedGood, { where: { id: l.refId }, lock: { mode: 'pessimistic_write' } });
        if (!item) throw new NotFoundException('Product not found');
        await m.update(FinishedGoodBatch, { finishedGoodId: item.id }, { quantityRemaining: 0 });
        const batch = await this.batches.createFinishedGoodBatch(m, {
          finishedGoodId: item.id,
          quantity: Number(l.quantity),
          source: BatchSource.OPENING_BALANCE,
        });
        await m.update(FinishedGoodBatch, { id: batch.id }, { producedDate: date });
        item.quantityInStock = Number(l.quantity);
        item.costPerUnit = Number(l.unitCost);
        await m.save(item);
        l.postedRefId = batch.id;
        journal.push({ accountId: fgAccount, debit: this.round3(l.amount), description: `Opening stock - ${item.name}` });
        counts.items++;
      }

      // --- other accounts
      for (const l of lines.filter((x) => x.kind === OpeningBalanceKind.ACCOUNT)) {
        journal.push({
          accountId: l.refId,
          debit: this.round3(l.debit),
          credit: this.round3(l.credit),
          description: l.note || 'Opening balance',
        });
        l.postedRefId = l.refId;
        counts.accounts++;
      }

      // --- 3900 Opening Balance Equity takes the difference
      const debit = this.round3(journal.reduce((t, x) => t + Number(x.debit || 0), 0));
      const credit = this.round3(journal.reduce((t, x) => t + Number(x.credit || 0), 0));
      const diff = this.round3(debit - credit);
      if (diff !== 0) {
        journal.push({
          accountId: await code('3900'),
          ...(diff > 0 ? { credit: diff } : { debit: -diff }),
          description: 'Opening Balance Equity',
        });
      }
      if (journal.length) {
        await this.journalPosting.postForSource(OPENING_SOURCE, OPENING_SOURCE_ID, date, `Opening balances as of ${date}`, journal, actor, 'Opening balances', m);
      }

      await m.save(lines);
      s.openingBalanceFinalizedAt = new Date();
      s.openingBalanceFinalizedBy = actor.email || null;
      await m.save(s);
      return { openingBalanceDate: date, ...counts, totalDebit: this.round3(Math.max(debit, credit)), openingBalanceEquity: diff };
    });

    await this.activityLog.log({
      userId: actor.userId,
      userEmail: actor.email,
      action: 'opening_balance.finalized',
      entityType: 'settings',
      entityId: '1',
      details: result,
    });
    return result;
  }
}
