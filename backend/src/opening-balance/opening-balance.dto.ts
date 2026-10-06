import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { OpeningBalanceKind } from './opening-balance-line.entity';

export class SetOpeningDateDto {
  @IsDateString()
  openingBalanceDate: string;
}

// One line on the Opening Balances page. Which fields matter depends on
// `kind` (checked in OpeningBalanceService.validateLine).
export class SaveOpeningLineDto {
  @IsEnum(OpeningBalanceKind)
  kind: OpeningBalanceKind;

  @IsUUID()
  refId: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  documentNumber?: string;

  @IsOptional()
  @IsDateString()
  documentDate?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  unitCost?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  debit?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  credit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}
