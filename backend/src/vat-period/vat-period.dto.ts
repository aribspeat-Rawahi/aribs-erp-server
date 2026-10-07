import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class FileVatPeriodDto {
  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  otaReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ReopenVatPeriodDto {
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason: string;
}

export class VatPeriodSettingsDto {
  @IsInt()
  @IsIn([1, 3])
  vatPeriodMonths: number;

  @IsInt()
  @Min(1)
  @Max(12)
  vatPeriodStartMonth: number;
}
