import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { FixedAsset, FixedAssetCategory, FixedAssetStatus } from './fixed-asset.entity';
import { CreateFixedAssetDto, UpdateFixedAssetDto, DisposeFixedAssetDto } from './dto/fixed-asset.dto';
import { BankAccount } from '../bank-account/bank-account.entity';
import { BankTransaction, BankTransactionType } from '../bank-account/bank-transaction.entity';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { BankAccountService } from '../bank-account/bank-account.service';
import { JournalPostingService, PostingLine } from '../journal/journal-posting.service';

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
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `FA-${date}-${rand}`;
  }

  private round3(n: number) {
    return Math.round(n * 1000) / 1000;
  }

  // Straight-line monthly depreciation, capped so an asset never
  // depreciates past (cost - salvageValue).
  computeMonthlyDepreciation(asset: FixedAsset): number {
    const depreciableBase = this.round3(Number(asset.cost) - Number(asset.salvageValue));
    const remaining = this.round3(depreciableBase - Number(asset.accumulatedDepreciation));
    if (remaining <= 0) return 0;
    const monthly = this.round3(depreciableBase / asset.usefulLifeMonths);
    return Math.min(monthly, remaining);
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
    const date = dto.purchaseDate || new Date().toISOString().slice(0, 10);
    const cost = Number(dto.cost);
    const salvageValue = Number(dto.salvageValue || 0);
    if (salvageValue >= cost) {
      throw new BadRequestException('Salvage value must be less than the asset cost.');
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      let bankTransactionId: string | undefined;
      if (dto.bankAccountId) {
        const account = await manager.findOne(BankAccount, {
          where: { id: dto.bankAccountId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!account) throw new NotFoundException('Bank/cash account not found');
        if (Number(account.currentBalance) < cost) {
          throw new BadRequestException(`Insufficient balance in ${account.name} to purchase this asset.`);
        }
        account.currentBalance = Number(account.currentBalance) - cost;
        await manager.save(account);
        const txn = await manager.save(
          manager.create(BankTransaction, {
            bankAccountId: account.id,
            type: BankTransactionType.WITHDRAWAL,
            amount: cost,
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
        notes: dto.notes,
        createdByUserId: actor.userId,
        createdByEmail: actor.email,
      });
      const savedItem = await manager.save(item);
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

    try {
      const assetAccountId = await this.journalPosting.findAccountIdByCode(CATEGORY_ACCOUNT_CODE[saved.savedItem.category]);
      const lines: PostingLine[] = [{ accountId: assetAccountId, debit: cost, description: 'Fixed asset purchase' }];
      if (dto.bankAccountId) {
        const bankJournalAccountId = await this.bankAccountService.ensureJournalAccountId(dto.bankAccountId);
        lines.push({ accountId: bankJournalAccountId, credit: cost, description: 'Asset paid from account' });
      } else {
        const apAccountId = await this.journalPosting.findAccountIdByCode(ACCOUNTS_PAYABLE_CODE);
        lines.push({ accountId: apAccountId, credit: cost, description: 'Asset purchased on credit' });
      }
      await this.journalPosting.postForSource(
        'fixed_asset_purchase',
        saved.savedItem.id,
        date,
        `Fixed asset purchase — ${saved.savedItem.assetNumber}`,
        lines,
        actor,
        saved.savedItem.assetNumber,
      );
    } catch (err) {
      console.error(`Auto-posting failed for fixed_asset_purchase ${saved.savedItem.id}:`, err);
    }

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
    if (Number(item.accumulatedDepreciation) > 0 || item.status === FixedAssetStatus.DISPOSED) {
      throw new BadRequestException(
        'This asset already has posted depreciation history — use Dispose instead of deleting it.',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      if (item.bankAccountId) {
        const account = await manager.findOne(BankAccount, {
          where: { id: item.bankAccountId },
          lock: { mode: 'pessimistic_write' },
        });
        if (account) {
          account.currentBalance = Number(account.currentBalance) + Number(item.cost);
          await manager.save(account);
          await manager.save(
            manager.create(BankTransaction, {
              bankAccountId: account.id,
              type: BankTransactionType.DEPOSIT,
              amount: Number(item.cost),
              date: new Date().toISOString().slice(0, 10),
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

  // Posts one month of straight-line depreciation for a single asset,
  // regardless of the cron schedule — used by both the manual per-asset
  // trigger endpoint and runMonthlyDepreciation() below. No-op (returns
  // null) if the asset is disposed, inactive-for-this-period, or already
  // fully depreciated.
  private async postDepreciationFor(asset: FixedAsset, period: string, actor: ActorRef) {
    if (asset.status !== FixedAssetStatus.ACTIVE) return null;
    const amount = this.computeMonthlyDepreciation(asset);
    if (amount <= 0) {
      asset.lastDepreciationPeriod = period;
      await this.repo.save(asset);
      return null;
    }

    asset.accumulatedDepreciation = this.round3(Number(asset.accumulatedDepreciation) + amount);
    asset.lastDepreciationPeriod = period;
    await this.repo.save(asset);

    try {
      const expenseAccountId = await this.journalPosting.findAccountIdByCode(DEPRECIATION_EXPENSE_CODE);
      const accumAccountId = await this.journalPosting.findAccountIdByCode(ACCUMULATED_DEPRECIATION_CODE);
      await this.journalPosting.postForSource(
        'fixed_asset_depreciation',
        `${asset.id}-${period}`,
        `${period}-01`,
        `Depreciation — ${asset.assetNumber} (${period})`,
        [
          { accountId: expenseAccountId, debit: amount, description: 'Monthly depreciation' },
          { accountId: accumAccountId, credit: amount, description: 'Monthly depreciation' },
        ],
        actor,
        asset.assetNumber,
      );
    } catch (err) {
      console.error(`Auto-posting failed for fixed_asset_depreciation ${asset.id}-${period}:`, err);
    }
    return amount;
  }

  // Runs at 07:00 on the 1st of every month — after recurring-invoice
  // generation (06:00) and before payment reminders (08:00), same
  // @nestjs/schedule Cron pattern used by both. Idempotent per asset per
  // calendar month via lastDepreciationPeriod, so it's safe if the server
  // restarts and the job fires again, or if it's also triggered manually
  // the same month via the endpoints below.
  @Cron('0 7 1 * *')
  async runMonthlyDepreciation() {
    if (String(this.config.get('FIXED_ASSET_DEPRECIATION_ENABLED')).toLowerCase() === 'false') return;
    const period = new Date().toISOString().slice(0, 7); // "YYYY-MM"
    const assets = await this.repo.find({ where: { status: FixedAssetStatus.ACTIVE } });
    let posted = 0;
    for (const asset of assets) {
      if (asset.lastDepreciationPeriod === period) continue;
      try {
        const amount = await this.postDepreciationFor(asset, period, {});
        if (amount) posted++;
      } catch (err) {
        this.logger.error(`Monthly depreciation failed for asset ${asset.id}:`, err as Error);
      }
    }
    this.logger.log(`Monthly depreciation run (${period}): ${posted} of ${assets.length} asset(s) posted.`);
  }

  // Manual trigger for a single asset's CURRENT-month depreciation —
  // useful right after registering an asset mid-testing, or to catch up
  // one asset without waiting for the 1st. Refuses if already posted for
  // the current period.
  async depreciateNow(id: string, actor: ActorRef) {
    const asset = await this.findOne(id);
    if (asset.status !== FixedAssetStatus.ACTIVE) {
      throw new BadRequestException('Only an active asset can be depreciated.');
    }
    const period = new Date().toISOString().slice(0, 7);
    if (asset.lastDepreciationPeriod === period) {
      throw new BadRequestException(`Depreciation for ${period} has already been posted for this asset.`);
    }
    const amount = await this.postDepreciationFor(asset, period, actor);
    if (!amount) {
      throw new BadRequestException('This asset is already fully depreciated.');
    }
    await this.activityLog.log({
      action: 'fixed_asset.depreciated_manually',
      entityType: 'fixed_asset',
      entityId: asset.id,
      userId: actor.userId,
      userEmail: actor.email,
      details: { assetNumber: asset.assetNumber, period, amount },
    });
    return this.findOne(id);
  }

  // Admin-triggered run of the full monthly job on demand (e.g. right
  // after deploy, to confirm it's wired up without waiting for the 1st).
  async runDepreciationNow() {
    await this.runMonthlyDepreciation();
    return { ran: true };
  }

  // Retires an asset: reverses (Cr) its full original cost and (Dr) its
  // accumulated depreciation off the books, records any sale/scrap
  // proceeds, and posts the resulting gain or loss. See the inline
  // comments below for why this always balances.
  async dispose(id: string, dto: DisposeFixedAssetDto, actor: ActorRef) {
    const asset = await this.findOne(id);
    if (asset.status !== FixedAssetStatus.ACTIVE) {
      throw new BadRequestException('This asset has already been disposed.');
    }
    const proceeds = Number(dto.disposalProceeds || 0);
    if (proceeds > 0 && !dto.bankAccountId) {
      throw new BadRequestException('Select the account disposal proceeds were deposited into.');
    }
    const date = dto.disposalDate || new Date().toISOString().slice(0, 10);
    const netBookValue = this.round3(Number(asset.cost) - Number(asset.accumulatedDepreciation));
    const gainLoss = this.round3(proceeds - netBookValue);

    const saved = await this.dataSource.transaction(async (manager) => {
      if (proceeds > 0 && dto.bankAccountId) {
        const account = await manager.findOne(BankAccount, {
          where: { id: dto.bankAccountId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!account) throw new NotFoundException('Bank/cash account not found');
        account.currentBalance = Number(account.currentBalance) + proceeds;
        await manager.save(account);
        await manager.save(
          manager.create(BankTransaction, {
            bankAccountId: account.id,
            type: BankTransactionType.DEPOSIT,
            amount: proceeds,
            date,
            note: `Fixed asset disposal proceeds — ${asset.assetNumber}`,
          }),
        );
      }
      asset.status = FixedAssetStatus.DISPOSED;
      asset.disposalDate = date;
      asset.disposalProceeds = proceeds;
      if (dto.bankAccountId) asset.bankAccountId = dto.bankAccountId;
      return manager.save(asset);
    });

    await this.activityLog.log({
      action: 'fixed_asset.disposed',
      entityType: 'fixed_asset',
      entityId: saved.id,
      userId: actor.userId,
      userEmail: actor.email,
      details: { assetNumber: saved.assetNumber, proceeds, netBookValue, gainLoss },
    });

    try {
      const assetAccountId = await this.journalPosting.findAccountIdByCode(CATEGORY_ACCOUNT_CODE[saved.category]);
      const accumAccountId = await this.journalPosting.findAccountIdByCode(ACCUMULATED_DEPRECIATION_CODE);
      // Credits: original cost (removes the asset) + a gain, if any.
      // Debits: accumulated depreciation (removes the contra-asset) +
      // proceeds received + a loss, if any. These always balance — see
      // the derivation in this service's module-level design notes.
      const lines: PostingLine[] = [
        { accountId: assetAccountId, credit: Number(saved.cost), description: 'Asset disposed — remove cost' },
        { accountId: accumAccountId, debit: Number(saved.accumulatedDepreciation), description: 'Asset disposed — remove accumulated depreciation' },
      ];
      if (proceeds > 0 && dto.bankAccountId) {
        const bankJournalAccountId = await this.bankAccountService.ensureJournalAccountId(dto.bankAccountId);
        lines.push({ accountId: bankJournalAccountId, debit: proceeds, description: 'Disposal proceeds received' });
      }
      if (gainLoss > 0) {
        const gainAccountId = await this.journalPosting.findAccountIdByCode(GAIN_ON_DISPOSAL_CODE);
        lines.push({ accountId: gainAccountId, credit: gainLoss, description: 'Gain on disposal' });
      } else if (gainLoss < 0) {
        const lossAccountId = await this.journalPosting.findAccountIdByCode(LOSS_ON_DISPOSAL_CODE);
        lines.push({ accountId: lossAccountId, debit: -gainLoss, description: 'Loss on disposal' });
      }
      await this.journalPosting.postForSource(
        'fixed_asset_disposal',
        saved.id,
        date,
        `Fixed asset disposal — ${saved.assetNumber}`,
        lines,
        actor,
        saved.assetNumber,
      );
    } catch (err) {
      console.error(`Auto-posting failed for fixed_asset_disposal ${saved.id}:`, err);
    }

    return saved;
  }
}
