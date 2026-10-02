import { IsString, IsNumber, IsOptional, IsBoolean, Min } from 'class-validator';

export class CreateFundTransferDto {
  @IsString()
  fromAccountId: string;

  @IsString()
  toAccountId: string;

  @IsNumber()
  @Min(0.001)
  amount: number;

  @IsOptional()
  @IsString()
  date?: string; // defaults to today

  @IsOptional()
  @IsString()
  note?: string;

  // Optional — when true, the source account is debited now but the
  // destination account isn't credited until the transfer is later
  // confirmed received (FundTransferService.clear()). Defaults to false
  // (the normal, instant transfer).
  @IsOptional()
  @IsBoolean()
  inTransit?: boolean;
}

export class UpdateFundTransferDto {
  @IsOptional()
  @IsString()
  fromAccountId?: string;

  @IsOptional()
  @IsString()
  toAccountId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.001)
  amount?: number;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
