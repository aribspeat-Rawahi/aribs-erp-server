import { IsString, IsNumber, IsOptional, IsArray, IsEnum, ValidateNested, Min, IsIn } from 'class-validator';
import { UNITS } from '../../units/units';
import { Type } from 'class-transformer';
import { PaymentType, DeliveryMethod } from '../../common/payment-type.enum';

export class DeliveryNoteItemDto {
  @IsOptional()
  @IsString()
  finishedGoodId?: string;

  @IsString()
  description: string;

  @IsNumber()
  @Min(0.001)
  quantity: number;

  // Only used for a custom line (no product); a product line always
  // takes the product's unit. pcs | bags | kg | litre | ton
  @IsOptional()
  @IsIn(UNITS)
  unit?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  vatRate?: number;
}

export class CreateDeliveryNoteDto {
  @IsString()
  customerId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveryNoteItemDto)
  items: DeliveryNoteItemDto[];

  @IsOptional()
  @IsString()
  deliveryDate?: string;

  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @IsOptional()
  @IsString()
  quotationNumber?: string;

  @IsOptional()
  @IsEnum(PaymentType)
  paymentType?: PaymentType;

  @IsOptional()
  @IsEnum(DeliveryMethod)
  deliveryMethod?: DeliveryMethod;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;
}

export class UpdateDeliveryNoteDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveryNoteItemDto)
  items?: DeliveryNoteItemDto[];

  @IsOptional()
  @IsString()
  deliveryDate?: string;

  @IsOptional()
  @IsEnum(PaymentType)
  paymentType?: PaymentType;

  @IsOptional()
  @IsEnum(DeliveryMethod)
  deliveryMethod?: DeliveryMethod;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;
}
