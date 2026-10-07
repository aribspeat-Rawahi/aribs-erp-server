import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// Which Chart-of-Accounts Asset line a new asset's cost is posted against
// (see FixedAssetService.CATEGORY_ACCOUNT_CODE) — matches the existing
// 1500/1510/1520/1530 fixed-asset accounts, plus OTHER for anything that
// doesn't fit those four (posts to 1560 Other Long-Term Asset instead).
export enum FixedAssetCategory {
  MACHINERY_EQUIPMENT = 'machinery_equipment',
  FURNITURE_FIXTURES = 'furniture_fixtures',
  VEHICLES = 'vehicles',
  COMPUTER_OFFICE_EQUIPMENT = 'computer_office_equipment',
  OTHER = 'other',
}

export enum FixedAssetStatus {
  ACTIVE = 'active',
  DISPOSED = 'disposed',
}

// A single Property/Plant & Equipment item — a machine, a vehicle, office
// furniture, etc. Straight-line depreciation only (Dep/month = (cost -
// salvageValue) / usefulLifeMonths), auto-posted monthly by
// FixedAssetService.runMonthlyDepreciation() (a @Cron job) until the asset
// is fully depreciated or disposed via dispose().
@Entity('fixed_assets')
export class FixedAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Human-readable reference, e.g. "FA-20260924-A1B2C3" — same generator
  // pattern as transferNumber/returnNumber/claimNumber.
  @Column({ unique: true })
  assetNumber: string;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: FixedAssetCategory })
  category: FixedAssetCategory;

  @Column({ type: 'date' })
  purchaseDate: string;

  @Column('decimal', { precision: 12, scale: 3 })
  cost: number;

  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  salvageValue: number;

  @Column('int')
  usefulLifeMonths: number;

  // Running total posted by the monthly depreciation job — never exceeds
  // (cost - salvageValue).
  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  accumulatedDepreciation: number;

  // "YYYY-MM" of the last month depreciation was posted for this asset —
  // makes the monthly cron idempotent (skips an asset already run for the
  // current period instead of relying on a slower journal-entry lookup).
  @Column({ nullable: true })
  lastDepreciationPeriod?: string;

  @Column({ type: 'enum', enum: FixedAssetStatus, default: FixedAssetStatus.ACTIVE })
  status: FixedAssetStatus;

  @Column({ type: 'date', nullable: true })
  disposalDate?: string;

  @Column('decimal', { precision: 12, scale: 3, nullable: true })
  disposalProceeds?: number;

  // If set, the purchase was paid from (and any disposal proceeds are
  // deposited back into) this bank/cash account — same optional-bank-leg
  // convention as Expense/PurchaseReturn. No DB foreign key, same
  // convention used throughout this codebase.
  @Column({ nullable: true })
  bankAccountId?: string;

  // Input VAT on the purchase (Dr 1400, claimable with the supplier's tax
  // invoice). Not part of the asset cost or its depreciation.
  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  vatAmount: number;

  @Column({ type: 'varchar', length: 36, nullable: true })
  supplierId: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  supplierInvoiceNumber: string | null;

  // bought on credit: the supplier bill (a purchase order) it created
  @Column({ type: 'varchar', length: 36, nullable: true })
  purchaseOrderId: string | null;

  @Column({ nullable: true, type: 'text' })
  notes?: string;

  @Column({ nullable: true })
  createdByUserId?: string;
  @Column({ nullable: true })
  createdByEmail?: string;

  @CreateDateColumn()
  createdAt: Date;
}
