import { IsString, IsNumber, IsOptional, IsArray, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class PurchaseReturnItemDto {
  @IsString()
  rawMaterialId: string;

  @IsNumber()
  @Min(0.001)
  quantity: number;
}

export class CreatePurchaseReturnDto {
  @IsString()
  purchaseOrderId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseReturnItemDto)
  items: PurchaseReturnItemDto[];

  @IsOptional()
  @IsString()
  date?: string; // defaults to today

  @IsOptional()
  @IsString()
  reason?: string;

  // If set, the refund is recorded as a real deposit on this bank/cash
  // account once approved. Omit to just credit Accounts Payable.
  @IsOptional()
  @IsString()
  bankAccountId?: string;
}

export class RejectPurchaseReturnDto {
  @IsString()
  reason: string;
}

export class ApprovePurchaseReturnDto {
  // Needed only when part of the return is refunded (the order had already
  // been paid beyond what is still owed).
  @IsOptional()
  @IsString()
  bankAccountId?: string;
}
