import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

export class CreateTaxPaymentDto {
  @IsString()
  period: string;

  @IsNumber()
  @Min(0.001)
  amount: number;

  @IsOptional()
  @IsString()
  datePaid?: string; // defaults to today

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  note?: string;

  // If set, also records an automatic withdrawal on this bank/cash
  // account. Omit for a record-only payment.
  @IsOptional()
  @IsString()
  bankAccountId?: string;
}

export class UpdateTaxPaymentDto {
  @IsOptional()
  @IsString()
  period?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.001)
  amount?: number;

  @IsOptional()
  @IsString()
  datePaid?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  bankAccountId?: string;
}
