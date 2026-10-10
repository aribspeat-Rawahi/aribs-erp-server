import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { FixedAsset, FixedAssetCategory, FixedAssetStatus } from './fixed-asset.entity';
import { CreateFixedAssetDto, UpdateFixedAssetDto, DisposeFixedAssetDto } from './dto/fixed-asset.dto';
import { BankAccount } from '../bank-account/bank-account.entity';
import { BankTransaction, BankTransactionType } from '../bank-account/bank-transaction.entity';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { BankAccountService } from '../bank-account/bank-account.service';
import { JournalPostingService, PostingLine } from '../journal/journal-posting.service';
import { applyBankMovement, rowForInsert } from '../common/bank-movement.util';
import { Supplier } from '../supplier/supplier.entity';
import { PurchaseOrder, PurchaseOrderStatus } from '../supplier/purchase-order.entity';
import { PaymentStatus } from '../common/payment-type.enum';
import { omanToday } from '../common/oman-date';

interface ActorRef {
  userId?: string;
  email?: string;
}

// Chart-of-Accounts code each category's cost posts against.
const CATEGORY_ACCOUNT_CODE: Record<FixedAssetCategory, string> = {
  [FixedAssetCategory.MACHINERY_EQUIPMENT]: '1500',
  [FixedAssetCategory.FURNITURE_FIXTURES]: '1510',
  [FixedAssetCategory.VEHICLES]: '1520',
  [FixedAssetCategory.COMPUTER_OFFICE_EQUIPMENT]: '1530',
  [FixedAssetCategory.OTHER]: '1560',
};

const ACCUMULATED_DEPRECIATION_CODE = '1590';
const DEPRECIATION_EXPENSE_CODE = '700';
const ACCOUNTS_PAYABLE_CODE = '2000';
const GAIN_ON_DISPOSAL_CODE = '1404';
const LOSS_ON_DISPOSAL_CODE = '1504';

@Injectable()
export class FixedAssetService {
  private readonly logger = new Logger(FixedAssetService.name);

  constructor(
    @InjectRepository(FixedAsset)
    private repo: Repository<FixedAsset>,
    @InjectDataSource()
    private dataSource: DataSource,
    private activityLog: ActivityLogService,
    private bankAccountService: BankAccountService,
    private journalPosting: JournalPostingService,
    private config: ConfigService,
  ) {}

  private generateAssetNumber() {
    const date = omanToday().replace(/-/g, '');
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `FA-${date}-${rand}`;
  }

  private round3(n: number) {
    return Math.round(n * 1000) / 1000;
  }

  findAll() {
    return this.repo.find({ order: { purchaseDate: 'DESC', createdAt: 'DESC' } });
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Fixed asset not found');
    return item;
  }

  // Registers a new asset and (inside one DB transaction) optionally pays
  // for it from a bank/cash account, mirroring PurchaseReturn's optional-
  // bank-leg pattern. With no bankAccountId, the purchase is recorded as a
  // credit against Accounts Payable instead (Dr {category account} / Cr
  // 2000) — useful when the supplier bill hasn't been paid yet.
  async create(dto: CreateFixedAssetDto, actor: ActorRef) {
    const date = dto.purchaseDate || omanToday();
    await this.journalPosting.assertDateOpen(date, 'This asset purchase');
    const cost = Number(dto.cost);
    const vat = Math.round(Number(dto.vatAmount || 0) * 1000) / 1000;
    const salvageValue = Number(dto.salvageValue || 0);
    if (salvageValue >= cost) {
      throw new BadRequestException('Salvage value must be less than the asset cost.');
    }
    // paid now (bank/cash) or on credit (a supplier bill) - never neither,
    // or the purchase has no other side in the books
    if (!dto.bankAccountId && !dto.supplierId) {
      throw new BadRequestException('Choose the bank/cash account it was paid from, or the supplier if it was bought on credit.');
    }
    // input VAT can only be claimed with the supplier's tax invoice
    if (vat > 0 && (!dto.supplierId || !dto.supplierInvoiceNumber?.trim())) {
      throw new BadRequestException("To claim the VAT, enter the supplier and its tax invoice number. Otherwise include the VAT in the cost.");
    }
    const gross = Math.round((cost + vat) * 1000) / 1000;

    const saved = await this.dataSource.transaction(async (manager) => {
      let bankTransactionId: string | undefined;
      if (dto.supplierId && !(await manager.findOne(Supplier, { where: { id: dto.supplierId } }))) {
        throw new NotFoundException('Supplier not found');
      }
      if (dto.bankAccountId) {
        const account = await manager.findOne(BankAccount, {
          where: { id: dto.bankAccountId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!account) throw new NotFoundException('Bank/cash account not found');
        if (Number(account.currentBalance) < gross) {
          throw new BadRequestException(`Insufficient balance in ${account.name} to purchase this asset.`);
        }
        account.currentBalance = Number(account.currentBalance) - gross;
        await manager.save(account);
        const txn = await manager.save(
          manager.create(BankTransaction, {
            bankAccountId: account.id,
            type: BankTransactionType.WITHDRAWAL,
            amount: gross,
            date,
            note: `Fixed asset purchase — ${dto.name}`,
          }),
        );
        bankTransactionId = txn.id;
      }

      const item = manager.create(FixedAsset, {
        assetNumber: this.generateAssetNumber(),
        name: dto.name,
        category: dto.category,
        purchaseDate: date,
        cost,
        salvageValue,
        usefulLifeMonths: dto.usefulLifeMonths,
        accumulatedDepreciation: 0,
        status: FixedAssetStatus.ACTIVE,
        bankAccountId: dto.bankAccountId,
        vatAmount: vat,
        supplierId: dto.supplierId || null,
        supplierInvoiceNumber: dto.supplierInvoiceNumber?.trim() || null,
        notes: dto.notes,
        createdByUserId: actor.userId,
        createdByEmail: actor.email,
      });
      const savedItem = await manager.save(item);
      if (!dto.bankAccountId) {
        savedItem.purchaseOrderId = await this.createBill(manager, savedItem);
        await manager.save(savedItem);
      }
      return { savedItem, bankTransactionId };
    });

    await this.activityLog.log({
      action: 'fixed_asset.created',
      entityType: 'fixed_asset',
      entityId: saved.savedItem.id,
      userId: actor.userId,
      userEmail: actor.email,
      details: { assetNumber: saved.savedItem.assetNumber, name: saved.savedItem.name, cost: saved.savedItem.cost },
    });

    await this.postPurchaseJournal(saved.savedItem, actor);

    return saved.savedItem;
  }

  // Only non-financial fields are editable here — cost, category and
  // bankAccountId stay fixed after creation since they're tied to the
  // purchase journal entry and (if set) an already-posted bank
  // transaction; reopening those would require reversing and re-applying
  // real money movement for a field that rarely needs correcting after
  // the fact. Use remove() (while undepreciated) or dispose() instead if
  // an asset was genuinely registered wrong.
  async update(id: string, dto: UpdateFixedAssetDto) {
    const item = await this.findOne(id);
    if (item.status === FixedAssetStatus.DISPOSED) {
      throw new BadRequestException('This asset has been disposed and can no longer be edited.');
    }
    if (dto.salvageValue != null && Number(dto.salvageValue) >= Number(item.cost)) {
      throw new BadRequestException('Salvage value must be less than the asset cost.');
    }
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  // Only allowed before any depreciation has posted — otherwise the asset
  // has already affected real Journal Entries across (possibly) several
  // periods and should be disposed instead, which keeps that history intact.
  async remove(id: string, actor: ActorRef) {
    const item = await this.findOne(id);
    // its purchase is in the books on that date - closed periods stay as filed
    await this.journalPosting.assertDateOpen(item.purchaseDate, 'This asset purchase', undefined, { existing: true });
    if (Number(item.accumulatedDepreciation) > 0 || item.status === FixedAssetStatus.DISPOSED) {
      throw new BadRequestException(
        'This asset already has posted depreciation history — use Dispose instead of deleting it.',
      );
    }

    const gross = Math.round((Number(item.cost) + Number(item.vatAmount || 0)) * 1000) / 1000;
    await this.dataSource.transaction(async (manager) => {
      if (item.purchaseOrderId) {
        const bill = await manager.findOne(PurchaseOrder, { where: { id: item.purchaseOrderId }, lock: { mode: 'pessimistic_write' } });
        if (bill && Number(bill.paidAmount || 0) > 0.0005) {
          throw new BadRequestException(`Its supplier bill ${bill.poNumber} is already (partly) paid - delete those payments first.`);
        }
        if (bill) await manager.remove(bill);
      }
      if (item.bankAccountId) {
        const account = await manager.findOne(BankAccount, {
          where: { id: item.bankAccountId },
          lock: { mode: 'pessimistic_write' },
        });
        if (account) {
          account.currentBalance = Number(account.currentBalance) + gross;
          await manager.save(account);
          await manager.save(
            manager.create(BankTransaction, {
              bankAccountId: account.id,
              type: BankTransactionType.DEPOSIT,
              amount: gross,
              date: omanToday(),
              note: `Fixed asset purchase reversed — ${item.assetNumber}`,
            }),
          );
        }
      }
      await manager.remove(item);
    });

    await this.activityLog.log({
      action: 'fixed_asset.deleted',
      entityType: 'fixed_asset',
      entityId: id,
      userId: actor.userId,
      userEmail: actor.email,
      details: { assetNumber: item.assetNumber, name: item.name },
    });

    try {
      await this.journalPosting.removeForSource('fixed_asset_purchase', id);
    } catch (err) {
      console.error(`Removing auto-posted journal entry failed for fixed_asset_purchase ${id}:`, err);
    }
    return { deleted: true };
  }

  // ---- depreciation (straight line, IAS 16) ----
  // Each month is posted on its LAST day, after the month has ended. The
  // first month is pro-rata by the days the asset was held (bought on the
  // 16th of a 31-day month = 16/31 of a month); a disposal mid-month
  // depreciates up to the disposal date. Months that were missed (server
  // down, asset entered late) are caught up one by one. Months that fall
  // in closed books (opening balance date / filed VAT return) can't be
  // posted there, so they are posted together on the first open day.
  private dateStr(d: string | Date): string {
    if (d instanceof Date) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return String(d).slice(0, 10);
  }

  private daysInMonth(period: string) {
    const [y, m] = period.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  private monthEnd(period: string) {
    return `${period}-${String(this.daysInMonth(period)).padStart(2, '0')}`;
  }

  private shiftPeriod(period: string, months: number) {
    const [y, m] = period.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + months, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private addDays(date: string, n: number) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  // last day of the month before the current one (Oman time)
  private lastCompletedMonthEnd() {
    return this.monthEnd(this.shiftPeriod(omanToday().slice(0, 7), -1));
  }

  // Depreciates a (row-locked) asset up to and including `through`, inside
  // the caller's transaction, so the asset and its journal entries are
  // saved together or not at all. Returns the amount posted.
  private async depreciateThrough(manager: EntityManager, asset: FixedAsset, through: string, actor: ActorRef): Promise<number> {
    if (asset.status !== FixedAssetStatus.ACTIVE) return 0;
    const purchase = this.dateStr(asset.purchaseDate);
    if (through < purchase) return 0;
    const base = this.round3(Number(asset.cost) - Number(asset.salvageValue));
    const life = Math.max(1, Number(asset.usefulLifeMonths) || 1);
    const monthly = base / life;
    const lastPeriod = through.slice(0, 7);
    let period = asset.lastDepreciationPeriod ? this.shiftPeriod(asset.lastDepreciationPeriod, 1) : purchase.slice(0, 7);
    if (period > lastPeriod) return 0;

    const lock = await this.journalPosting.lockedThrough(manager);
    const expenseAccountId = await this.journalPosting.findAccountIdByCode(DEPRECIATION_EXPENSE_CODE);
    const accumAccountId = await this.journalPosting.findAccountIdByCode(ACCUMULATED_DEPRECIATION_CODE);
    const post = (sourceId: string, date: string, memo: string, amount: number) =>
      this.journalPosting.postForSource(
        'fixed_asset_depreciation',
        sourceId,
        date,
        memo,
        [
          { accountId: expenseAccountId, debit: amount, description: 'Depreciation' },
          { accountId: accumAccountId, credit: amount, description: 'Depreciation' },
        ],
        actor,
        asset.assetNumber,
        manager,
      );

    let accumulated = this.round3(Number(asset.accumulatedDepreciation));
    let total = 0;
    const closed = { amount: 0, from: '', to: '' };
    for (; period <= lastPeriod; period = this.shiftPeriod(period, 1)) {
      const remaining = this.round3(base - accumulated);
      if (remaining <= 0) {
        period = lastPeriod;
        break;
      }
      const monthStart = `${period}-01`;
      const start = purchase > monthStart ? purchase : monthStart;
      const end = through < this.monthEnd(period) ? through : this.monthEnd(period);
      const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
      const dim = this.daysInMonth(period);
      const amount = Math.min(this.round3(days >= dim ? monthly : (monthly * days) / dim), remaining);
      if (amount <= 0) continue;
      if (lock && end <= lock) {
        closed.amount = this.round3(closed.amount + amount);
        closed.from = closed.from || period;
        closed.to = period;
      } else {
        const partial = days < dim ? ` - ${days} of ${dim} days` : '';
        await post(`${asset.id}-${period}`, end, `Depreciation - ${asset.assetNumber} (${period}${partial})`, amount);
      }
      accumulated = this.round3(accumulated + amount);
      total = this.round3(total + amount);
    }
    if (closed.amount > 0 && lock) {
      const range = closed.from === closed.to ? closed.from : `${closed.from} to ${closed.to}`;
      await post(
        `${asset.id}-${closed.from}-${closed.to}`,
        this.addDays(lock, 1),
        `Depreciation - ${asset.assetNumber} (${range}, closed period caught up)`,
        closed.amount,
      );
    }
    asset.accumulatedDepreciation = accumulated;
    asset.lastDepreciationPeriod = period > lastPeriod ? lastPeriod : period;
    await manager.save(asset);
    return total;
  }

  private async depreciateAssetThrough(id: string, through: string, actor: ActorRef) {
    return this.dataSource.transaction(async (manager) => {
      const asset = await manager.findOne(FixedAsset, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!asset) throw new NotFoundException('Fixed asset not found');
      return this.depreciateThrough(manager, asset, through, actor);
    });
  }

  // Runs every day at 07:00 and posts every completed month that is not
  // posted yet (normally just last month, on the 1st). Running daily means
  // a missed run (server asleep on the 1st) is caught up the next day.
  // Idempotent: lastDepreciationPeriod records the last month posted.
  @Cron('0 7 * * *')
  async runMonthlyDepreciation() {
    if (String(this.config.get('FIXED_ASSET_DEPRECIATION_ENABLED')).toLowerCase() === 'false') return;
    if (await this.journalPosting.waitingForOpening()) {
      this.logger.log('Depreciation skipped: opening balances are not finalized yet.');
      return { posted: 0, assets: 0 };
    }
    const through = this.lastCompletedMonthEnd();
    const lastPeriod = through.slice(0, 7);
    const assets = await this.repo.find({ where: { status: FixedAssetStatus.ACTIVE } });
    let posted = 0;
    for (const asset of assets) {
      if (asset.lastDepreciationPeriod && asset.lastDepreciationPeriod >= lastPeriod) continue;
      try {
        if (await this.depreciateAssetThrough(asset.id, through, {})) posted++;
      } catch (err) {
        this.logger.error(`Depreciation failed for asset ${asset.assetNumber}:`, err as Error);
      }
    }
    if (posted) this.logger.log(`Depreciation through ${lastPeriod}: ${posted} of ${assets.length} asset(s) posted.`);
    return { posted, assets: assets.length };
  }

  // Manual catch-up for one asset: posts every completed month not posted
  // yet. The current month posts after it ends.
  async depreciateNow(id: string, actor: ActorRef) {
    const asset = await this.findOne(id);
    if (asset.status !== FixedAssetStatus.ACTIVE) {
      throw new BadRequestException('Only an active asset can be depreciated.');
    }
    await this.journalPosting.assertBooksStarted('Depreciation');
    const through = this.lastCompletedMonthEnd();
    const amount = await this.depreciateAssetThrough(id, through, actor);
    if (!amount) {
      const fresh = await this.findOne(id);
      if (this.round3(Number(fresh.cost) - Number(fresh.salvageValue) - Number(fresh.accumulatedDepreciation)) <= 0) {
        throw new BadRequestException('This asset is already fully depreciated.');
      }
      throw new BadRequestException(
        `Nothing to post: depreciation is up to date through ${through}. This month's depreciation posts after the month ends.`,
      );
    }
    await this.activityLog.log({
      action: 'fixed_asset.depreciated_manually',
      entityType: 'fixed_asset',
      entityId: asset.id,
      userId: actor.userId,
      userEmail: actor.email,
      details: { assetNumber: asset.assetNumber, through, amount },
    });
    return this.findOne(id);
  }

  // Admin-triggered run of the full job on demand.
  async runDepreciationNow() {
    const r = await this.runMonthlyDepreciation();
    return { ran: true, ...(r || {}) };
  }

  // Retires an asset. First depreciates it up to the disposal date, then
  // removes its cost (Cr) and accumulated depreciation (Dr), records the
  // money received and posts the gain or loss. A sale is a taxable supply
  // under the Oman VAT law: the VAT charged to the buyer (5%) is output VAT
  // (Cr 2100) and appears on the VAT return. All in one transaction.
  async dispose(id: string, dto: DisposeFixedAssetDto, actor: ActorRef) {
    const proceeds = this.round3(Number(dto.disposalProceeds || 0));
    const vat = this.round3(Number(dto.vatAmount || 0));
    const gross = this.round3(proceeds + vat);
    if (vat > 0 && proceeds <= 0) throw new BadRequestException('VAT can only be charged on a sale price.');
    if (vat > 0 && Math.abs(vat - this.round3(proceeds * 0.05)) > 0.001) {
      throw new BadRequestException(`VAT on a sale price of ${proceeds.toFixed(3)} OMR is ${this.round3(proceeds * 0.05).toFixed(3)} OMR (5%).`);
    }
    if (gross > 0 && !dto.bankAccountId) {
      throw new BadRequestException('Select the account disposal proceeds were deposited into.');
    }
    if (vat > 0) {
      const [s] = await this.dataSource.query('SELECT companyVatin FROM settings WHERE id = 1');
      if (!String(s?.companyVatin || '').trim()) {
        throw new BadRequestException('Enter the company VATIN in Settings before charging VAT.');
      }
    }
    const date = dto.disposalDate || omanToday();
    await this.journalPosting.assertDateOpen(date, 'This disposal');
    if (date > omanToday()) throw new BadRequestException('The disposal date cannot be in the future.');
    const bankJournalAccountId = gross > 0 && dto.bankAccountId ? await this.bankAccountService.ensureJournalAccountId(dto.bankAccountId) : null;
    const assetAccountId = await this.journalPosting.findAccountIdByCode(CATEGORY_ACCOUNT_CODE[(await this.findOne(id)).category]);
    const accumAccountId = await this.journalPosting.findAccountIdByCode(ACCUMULATED_DEPRECIATION_CODE);

    const result = await this.dataSource.transaction(async (manager) => {
      const asset = await manager.findOne(FixedAsset, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!asset) throw new NotFoundException('Fixed asset not found');
      if (asset.status !== FixedAssetStatus.ACTIVE) throw new BadRequestException('This asset has already been disposed.');
      const purchase = this.dateStr(asset.purchaseDate);
      if (date < purchase) throw new BadRequestException(`The disposal date is before the purchase date (${purchase}).`);
      if (asset.lastDepreciationPeriod && date < this.monthEnd(asset.lastDepreciationPeriod)) {
        throw new BadRequestException(
          `Depreciation is already posted through ${this.monthEnd(asset.lastDepreciationPeriod)}. Use a disposal date on or after it.`,
        );
      }
      const depreciated = await this.depreciateThrough(manager, asset, date, actor);
      const accumulated = this.round3(Number(asset.accumulatedDepreciation));
      const netBookValue = this.round3(Number(asset.cost) - accumulated);
      const gainLoss = this.round3(proceeds - netBookValue);

      if (gross > 0 && dto.bankAccountId) {
        await applyBankMovement(manager, {
          accountId: dto.bankAccountId,
          type: BankTransactionType.DEPOSIT,
          amount: gross,
          date,
          note: `Fixed asset sold - ${asset.assetNumber}${vat > 0 ? ` (incl. VAT ${vat.toFixed(3)})` : ''}`,
        });
      }
      asset.status = FixedAssetStatus.DISPOSED;
      asset.disposalDate = date;
      asset.disposalProceeds = proceeds;
      asset.disposalVat = vat;
      asset.disposalBuyer = dto.buyer?.trim() || null;
      if (dto.bankAccountId) asset.bankAccountId = dto.bankAccountId;
      const saved = await manager.save(asset);

      // Credits: cost + output VAT + gain. Debits: accumulated
      // depreciation + money received + loss. Balances because
      // gain/loss = proceeds - (cost - accumulated).
      const lines: PostingLine[] = [
        { accountId: assetAccountId, credit: Number(saved.cost), description: 'Asset disposed - remove cost' },
      ];
      if (accumulated > 0) lines.push({ accountId: accumAccountId, debit: accumulated, description: 'Asset disposed - remove accumulated depreciation' });
      if (gross > 0 && bankJournalAccountId) lines.push({ accountId: bankJournalAccountId, debit: gross, description: 'Sale proceeds received' });
      if (vat > 0) lines.push({ accountId: await this.journalPosting.findAccountIdByCode('2100'), credit: vat, description: 'Output VAT on asset sale' });
      if (gainLoss > 0) lines.push({ accountId: await this.journalPosting.findAccountIdByCode(GAIN_ON_DISPOSAL_CODE), credit: gainLoss, description: 'Gain on disposal' });
      else if (gainLoss < 0) lines.push({ accountId: await this.journalPosting.findAccountIdByCode(LOSS_ON_DISPOSAL_CODE), debit: -gainLoss, description: 'Loss on disposal' });
      await this.journalPosting.postForSource(
        'fixed_asset_disposal',
        saved.id,
        date,
        `Fixed asset disposal - ${saved.assetNumber}${saved.disposalBuyer ? ` (sold to ${saved.disposalBuyer})` : ''}`,
        lines,
        actor,
        saved.assetNumber,
        manager,
      );
      return { saved, netBookValue, gainLoss, depreciated };
    });

    await this.activityLog.log({
      action: 'fixed_asset.disposed',
      entityType: 'fixed_asset',
      entityId: id,
      userId: actor.userId,
      userEmail: actor.email,
      details: { assetNumber: result.saved.assetNumber, proceeds, vat, netBookValue: result.netBookValue, gainLoss: result.gainLoss, depreciatedToDate: result.depreciated },
    });
    return result.saved;
  }

  // Supplier bill for an asset bought on credit: a received purchase order
  // with no items, so it shows under the supplier and is paid with Pay Bill.
  // Its journal is the asset's own purchase entry (Cr 2000), not a GRN.
  private async createBill(manager: EntityManager, item: FixedAsset): Promise<string> {
    const vat = Number(item.vatAmount || 0);
    const gross = Math.round((Number(item.cost) + vat) * 1000) / 1000;
    const order = await manager.save(
      manager.create(PurchaseOrder, {
        supplierId: item.supplierId!,
        status: PurchaseOrderStatus.RECEIVED,
        poNumber: `TMP-${randomUUID().replace(/-/g, '').slice(0, 24)}`,
        notes: `Fixed asset ${item.assetNumber} - ${item.name}${item.supplierInvoiceNumber ? ` (supplier invoice ${item.supplierInvoiceNumber})` : ''}`,
        receivedAt: new Date(`${String(item.purchaseDate).slice(0, 10)}T00:00:00Z`),
        subtotal: Number(item.cost),
        vatAmount: vat,
        total: gross,
        receivedSubtotal: Number(item.cost),
        receivedVat: vat,
        receivedTotal: gross,
        paidAmount: 0,
        paymentStatus: PaymentStatus.DUE,
        fixedAssetId: item.id,
      }),
    );
    order.poNumber = `PO-${String(item.purchaseDate).slice(0, 4)}-${String(order.sequenceNumber).padStart(4, '0')}`;
    await manager.save(order);
    return order.id;
  }

  // Dr the asset's category account / Cr the bank account it was paid
  // from, or Cr Accounts Payable when bought on credit.
  private async postPurchaseJournal(item: FixedAsset, actor: ActorRef) {
    try {
      const cost = Number(item.cost);
      const vat = Number(item.vatAmount || 0);
      const gross = Math.round((cost + vat) * 1000) / 1000;
      const assetAccountId = await this.journalPosting.findAccountIdByCode(CATEGORY_ACCOUNT_CODE[item.category]);
      const lines: PostingLine[] = [{ accountId: assetAccountId, debit: cost, description: 'Fixed asset purchase' }];
      if (vat > 0) {
        lines.push({ accountId: await this.journalPosting.findAccountIdByCode('1400'), debit: vat, description: 'Input VAT on fixed asset' });
      }
      if (item.bankAccountId) {
        const bankJournalAccountId = await this.bankAccountService.ensureJournalAccountId(item.bankAccountId);
        lines.push({ accountId: bankJournalAccountId, credit: gross, description: 'Asset paid from account' });
      } else {
        const apAccountId = await this.journalPosting.findAccountIdByCode(ACCOUNTS_PAYABLE_CODE);
        lines.push({ accountId: apAccountId, credit: gross, description: 'Asset purchased on credit' });
      }
      await this.journalPosting.postForSource(
        'fixed_asset_purchase',
        item.id,
        item.purchaseDate,
        `Fixed asset purchase — ${item.assetNumber}`,
        lines,
        actor,
        item.assetNumber,
      );
    } catch (err) {
      console.error(`Auto-posting failed for fixed_asset_purchase ${item.id}:`, err);
    }
  }

  // Undo of a deleted asset (no depreciation posted yet): same
  // id/number/date. If it was paid from an account, the delete put the
  // money back with a reversal deposit (kept in the bank history), so the
  // undo takes it out again; the purchase journal entry is re-posted.
  async restoreDeleted(data: Record<string, unknown>, actor: ActorRef = {}) {
    const saved = await this.dataSource.transaction(async (manager) => {
      if (data.bankAccountId) {
        await applyBankMovement(manager, {
          accountId: String(data.bankAccountId),
          type: BankTransactionType.WITHDRAWAL,
          amount: Math.round((Number(data.cost) + Number(data.vatAmount || 0)) * 1000) / 1000,
          date: String(data.purchaseDate),
          note: `Fixed asset purchase — ${data.name} (restored)`,
        });
      }
      await manager.insert(FixedAsset, { ...rowForInsert(data), accumulatedDepreciation: 0, status: FixedAssetStatus.ACTIVE } as any);
      const restored = await manager.findOneOrFail(FixedAsset, { where: { id: String(data.id) } });
      // bought on credit: the delete removed its unpaid bill, so make a new one
      if (!restored.bankAccountId && restored.supplierId) {
        restored.purchaseOrderId = await this.createBill(manager, restored);
        await manager.save(restored);
      }
      return restored;
    });
    await this.postPurchaseJournal(saved, actor);
    return saved;
  }
}
