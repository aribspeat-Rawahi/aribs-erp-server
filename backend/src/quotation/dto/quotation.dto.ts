import { IsString, IsNumber, IsOptional, IsArray, IsEnum, IsBoolean, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { DeliveryMethod } from '../../common/payment-type.enum';

export class QuotationItemDto {
  @IsOptional()
  @IsString()
  finishedGoodId?: string;

  @IsString()
  description: string;

  @IsNumber()
  @Min(0.001)
  quantity: number;

  // The proposed price — can be freely set/overridden, unlike a sales
  // order which usually pulls from the product's default price.
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  vatRate?: number;
}

export class CreateQuotationDto {
  @IsString()
  customerId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationItemDto)
  items: QuotationItemDto[];

  @IsOptional()
  @IsString()
  validUntil?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  // No paymentType here on purpose — payment terms aren't shown on
  // quotations, only on invoices and delivery notes.
  @IsOptional()
  @IsEnum(DeliveryMethod)
  deliveryMethod?: DeliveryMethod;

  // Set true after the frontend has shown the "discount exceeds the
  // approval threshold" warning and the user confirmed. Queues an
  // ApprovalRequest (CRM Step 7) instead of creating the quotation
  // immediately — separate from the existing different-day edit-request
  // flow, which only applies to editing an existing quotation.
  @IsOptional()
  @IsBoolean()
  requestApproval?: boolean;
}

export class UpdateQuotationDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationItemDto)
  items?: QuotationItemDto[];

  @IsOptional()
  @IsString()
  validUntil?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @IsOptional()
  @IsEnum(DeliveryMethod)
  deliveryMethod?: DeliveryMethod;
}
