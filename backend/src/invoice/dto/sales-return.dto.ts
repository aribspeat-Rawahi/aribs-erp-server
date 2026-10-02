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

  // If set, the refund is recorded as a real withdrawal on this bank/cash
  // account once approved. Omit to just credit Accounts Receivable.
  @IsOptional()
  @IsString()
  bankAccountId?: string;
}

export class RejectSalesReturnDto {
  @IsString()
  reason: string;
}
