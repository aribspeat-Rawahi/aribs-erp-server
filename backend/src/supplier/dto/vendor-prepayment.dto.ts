import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

export class CreateVendorPrepaymentDto {
  @IsString()
  supplierId: string;

  @IsNumber()
  @Min(0.001)
  amount: number;

  @IsOptional()
  @IsString()
  date?: string; // defaults to today

  @IsString()
  bankAccountId: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class ApplyVendorPrepaymentDto {
  @IsNumber()
  @Min(0.001)
  amount: number;

  @IsOptional()
  @IsString()
  date?: string; // defaults to today

  // required: applying is always against a bill (purchase order), so
  // that order's balance due goes down by the same amount
  @IsString()
  purchaseOrderId: string;

  @IsOptional()
  @IsString()
  note?: string;
}
