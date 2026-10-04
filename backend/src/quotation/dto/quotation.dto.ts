import { IsString, IsNumber, IsOptional, IsArray, IsEnum, IsBoolean, ValidateNested, Min, IsIn } from 'class-validator';
import { UNITS } from '../../units/units';
import { Type } from 'class-transformer';
import { DeliveryMethod, PaymentType } from '../../common/payment-type.enum';
import { InvoiceTemplate } from '../../settings/settings.entity';

export class QuotationItemDto {
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

  @IsOptional()
  @IsEnum(DeliveryMethod)
  deliveryMethod?: DeliveryMethod;

  @IsOptional()
  @IsEnum(PaymentType)
  paymentType?: PaymentType;

  @IsOptional()
  @IsString()
  deliveryDate?: string;

  @IsOptional()
  @IsEnum(InvoiceTemplate)
  template?: InvoiceTemplate;

  // No VAT on this quotation - same approval rule as an invoice.
  @IsOptional()
  @IsBoolean()
  vatExcluded?: boolean;

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

  @IsOptional()
  @IsEnum(PaymentType)
  paymentType?: PaymentType;

  @IsOptional()
  @IsString()
  deliveryDate?: string;

  @IsOptional()
  @IsEnum(InvoiceTemplate)
  template?: InvoiceTemplate;

  // No VAT on this quotation - same approval rule as an invoice.
  @IsOptional()
  @IsBoolean()
  vatExcluded?: boolean;

  // Set after the user confirmed sending a VAT-exclude change for approval.
  @IsOptional()
  @IsBoolean()
  requestApproval?: boolean;
}
