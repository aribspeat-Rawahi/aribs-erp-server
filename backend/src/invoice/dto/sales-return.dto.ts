import { IsString, IsNumber, IsOptional, IsArray, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SalesReturnItemDto {
  @IsString()
  finishedGoodId: string;

  @IsNumber()
  @Min(0.001)
  quantity: number;
}

export class CreateSalesReturnDto {
  @IsString()
  invoiceId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesReturnItemDto)
  items: SalesReturnItemDto[];

  @IsOptional()
  @IsString()
  date?: string; // defaults to today

  @IsOptional()
  @IsString()
  reason?: string;

  // Ignored since the credit-note/refund rework - the approver picks the
  // refund account at approval. Kept so older app versions don't fail
  // validation.
  @IsOptional()
  @IsString()
  bankAccountId?: string;
}

export class RejectSalesReturnDto {
  @IsString()
  reason: string;
}

export class ApproveSalesReturnDto {
  // Needed only when part of the return is refunded (the customer had
  // already paid more than what is still due on the invoice).
  @IsOptional()
  @IsString()
  bankAccountId?: string;
}
