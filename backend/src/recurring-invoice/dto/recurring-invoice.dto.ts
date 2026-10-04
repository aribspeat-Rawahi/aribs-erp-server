import { IsString, IsNumber, IsOptional, IsArray, IsBoolean, IsEnum, ValidateNested, Min, IsIn } from 'class-validator';
import { UNITS } from '../../units/units';
import { Type } from 'class-transformer';
import { PaymentType, DeliveryMethod } from '../../common/payment-type.enum';
import { InvoiceTemplate } from '../../settings/settings.entity';
import { RecurringFrequency } from '../recurring-invoice.entity';

export class RecurringInvoiceItemDto {
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

  @IsNumber()
  @Min(0)
  unitPrice: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  vatRate?: number;
}

export class CreateRecurringInvoiceDto {
  @IsString()
  customerId: string;

  @IsString()
  label: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecurringInvoiceItemDto)
  items: RecurringInvoiceItemDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @IsOptional()
  @IsEnum(PaymentType)
  paymentType?: PaymentType;

  @IsOptional()
  @IsEnum(DeliveryMethod)
  deliveryMethod?: DeliveryMethod;

  @IsOptional()
  @IsEnum(InvoiceTemplate)
  template?: InvoiceTemplate;

  @IsOptional()
  @IsBoolean()
  vatExcluded?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  dueDays?: number;

  @IsEnum(RecurringFrequency)
  frequency: RecurringFrequency;

  @IsString()
  startDate: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}

export class UpdateRecurringInvoiceDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecurringInvoiceItemDto)
  items?: RecurringInvoiceItemDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @IsOptional()
  @IsEnum(PaymentType)
  paymentType?: PaymentType;

  @IsOptional()
  @IsEnum(DeliveryMethod)
  deliveryMethod?: DeliveryMethod;

  @IsOptional()
  @IsEnum(InvoiceTemplate)
  template?: InvoiceTemplate;

  @IsOptional()
  @IsBoolean()
  vatExcluded?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  dueDays?: number;

  @IsOptional()
  @IsEnum(RecurringFrequency)
  frequency?: RecurringFrequency;

  @IsOptional()
  @IsString()
  nextRunDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
