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

  // required: applying is always against a bill (purchase order), so
  // that order's balance due goes down by the same amount
  @IsString()
  purchaseOrderId: string;

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
