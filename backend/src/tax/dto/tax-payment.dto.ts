import { IsString, IsNumber, IsOptional, Min, IsNotEmpty } from 'class-validator';

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
  // Required: every payment moves money in or out of a bank/cash account,
  // and that movement must reach the books (Cash in Hand is an account too).
  @IsString()
  @IsNotEmpty({ message: 'Choose the bank or cash account.' })
  bankAccountId: string;
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
