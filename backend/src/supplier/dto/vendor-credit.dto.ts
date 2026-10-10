import { IsString, IsNumber, IsOptional, Min, MaxLength } from 'class-validator';

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

  // VAT included in amount (5/105 of it), from the supplier's tax credit note
  @IsOptional()
  @IsNumber()
  @Min(0)
  vatAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  supplierCreditNoteNumber?: string;
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
