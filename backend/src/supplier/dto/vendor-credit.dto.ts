import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

export class CreateVendorCreditDto {
  @IsString()
  supplierId: string;

  @IsNumber()
  @Min(0.001)
  amount: number;

  @IsOptional()
  @IsString()
  date?: string; // defaults to today

  @IsOptional()
  @IsString()
  reason?: string;
}

export class ApplyVendorCreditDto {
  @IsNumber()
  @Min(0.001)
  amount: number;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  purchaseOrderId?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class RefundVendorCreditDto {
  @IsNumber()
  @Min(0.001)
  amount: number;

  @IsOptional()
  @IsString()
  date?: string;

  @IsString()
  bankAccountId: string;
}
