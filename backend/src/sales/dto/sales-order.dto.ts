import { IsString, IsNumber, IsOptional, IsArray, IsEnum, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentType } from '../../common/payment-type.enum';

export class SalesOrderItemDto {
  @IsString()
  finishedGoodId: string;

  @IsNumber()
  @Min(0.001)
  quantity: number;

  // Selling price for this order — defaults to the product's set price
  // on the frontend, but can be overridden per order (e.g. bulk deal).
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  vatRate?: number;
}

export class CreateSalesOrderDto {
  @IsString()
  customerId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesOrderItemDto)
  items: SalesOrderItemDto[];

  @IsOptional()
  @IsEnum(PaymentType)
  paymentType?: PaymentType;

  @IsOptional()
  @IsString()
  notes?: string;
}
