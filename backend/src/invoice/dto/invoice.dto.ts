import { IsString, IsNumber, IsOptional, IsArray, IsBoolean, IsEnum, ValidateNested, Min, IsIn, IsNotEmpty } from 'class-validator';
import { UNITS } from '../../units/units';
import { Type } from 'class-transformer';
import { PaymentType, DeliveryMethod } from '../../common/payment-type.enum';
import { InvoiceTemplate } from '../../settings/settings.entity';

export class InvoiceItemDto {
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

export class CreateInvoiceDto {
  @IsString()
  customerId: string;

  @IsOptional()
  @IsString()
  salesOrderId?: string;

  // Manually enter a quotation number if this invoice relates to one that
  // wasn't converted through the app — otherwise leave blank for a
  // direct invoice (converting a quotation fills this in automatically).
  @IsOptional()
  @IsString()
  quotationNumber?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items: InvoiceItemDto[];

  @IsOptional()
  @IsString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  deliveryDate?: string;

  @IsOptional()
  @IsBoolean()
  vatExcluded?: boolean;

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

  // Overrides Settings.defaultInvoiceTemplate for this one invoice.
  @IsOptional()
  @IsEnum(InvoiceTemplate)
  template?: InvoiceTemplate;

  // Set true after the frontend has shown the approval-required warning
  // (credit limit exceeded / large discount / VAT excluded) and the user
  // confirmed. This does NOT create the invoice immediately — it queues
  // an ApprovalRequest instead (CRM Step 7), applied once an Admin/CEO/
  // MD/Accountant approves it via the Approvals dashboard.
  @IsOptional()
  @IsBoolean()
  requestApproval?: boolean;
}

// Editing an existing invoice reuses the same item shape; the service
// decides whether this is a same-day overwrite or a new version.
export class UpdateInvoiceDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  quotationNumber?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items?: InvoiceItemDto[];

  @IsOptional()
  @IsString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  deliveryDate?: string;

  @IsOptional()
  @IsBoolean()
  vatExcluded?: boolean;

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

  @IsOptional()
  @IsEnum(InvoiceTemplate)
  template?: InvoiceTemplate;

  @IsOptional()
  @IsBoolean()
  requestApproval?: boolean;
}

// One row recorded in an invoice's Payment Ledger (an invoice can be
// settled in several installments — each call to POST
// /invoices/:id/payments adds one of these).
export class CreateInvoicePaymentDto {
  @IsNumber()
  @Min(0.001)
  amount: number;

  @IsOptional()
  @IsEnum(PaymentType)
  paymentType?: PaymentType;

  // Defaults to today (service-side) if left blank — lets a payment
  // received a few days ago be back-dated correctly.
  @IsOptional()
  @IsString()
  paymentDate?: string;

  @IsOptional()
  @IsString()
  note?: string;

  // If set, also records an automatic deposit on this bank/cash account
  // and auto-posts Dr {this account} / Cr 1100 Accounts Receivable.
  // Omit for a record-only payment (e.g. it was already recorded via a
  // Fund Transfer or elsewhere).
  // Required: every payment moves money in or out of a bank/cash account,
  // and that movement must reach the books (Cash in Hand is an account too).
  @IsString()
  @IsNotEmpty({ message: 'Choose the bank or cash account.' })
  bankAccountId: string;
}
