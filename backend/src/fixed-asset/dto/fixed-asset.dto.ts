import { IsString, IsNumber, IsOptional, IsEnum, Min, IsInt } from 'class-validator';
import { FixedAssetCategory } from '../fixed-asset.entity';

export class CreateFixedAssetDto {
  @IsString()
  name: string;

  @IsEnum(FixedAssetCategory)
  category: FixedAssetCategory;

  @IsOptional()
  @IsString()
  purchaseDate?: string; // defaults to today

  @IsNumber()
  @Min(0.001)
  cost: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  salvageValue?: number;

  @IsInt()
  @Min(1)
  usefulLifeMonths: number;

  @IsOptional()
  @IsString()
  bankAccountId?: string; // omit to record the purchase against Accounts Payable instead

  @IsOptional()
  @IsString()
  notes?: string;
}

// Only fields that don't disturb the purchase journal entry / bank
// transaction already posted at creation — see FixedAssetService.update()
// for why cost/category/bankAccountId/purchaseDate aren't editable here.
export class UpdateFixedAssetDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  salvageValue?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  usefulLifeMonths?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class DisposeFixedAssetDto {
  @IsOptional()
  @IsString()
  disposalDate?: string; // defaults to today

  @IsNumber()
  @Min(0)
  disposalProceeds: number;

  // Required when disposalProceeds > 0 (see FixedAssetService.dispose()).
  @IsOptional()
  @IsString()
  bankAccountId?: string;
}
