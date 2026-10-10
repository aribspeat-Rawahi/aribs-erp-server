import { PartialType } from '@nestjs/mapped-types';
import { IsString, IsNumber, IsOptional, IsArray, IsIn, IsEnum, ValidateNested, Min, Max, IsInt, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import { InteractionType } from '../../common/interaction-type.enum';
import { SupplierVatStatus } from '../supplier.entity';
import { PaymentType } from '../../common/payment-type.enum';

export class CreateSupplierDto {
  @IsString()
  name: string;

  // Oman VAT number of the supplier (needed to claim input VAT)
  @IsOptional()
  @IsString()
  vatin?: string;

  // registered | not_registered | foreign - sets the default VAT on its POs
  @IsOptional()
  @IsEnum(SupplierVatStatus)
  vatStatus?: SupplierVatStatus;

  @IsOptional()
  @IsString()
  contactPerson?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  // days after the supplier's invoice date; 0 = due at once; null clears it
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays?: number | null;
}

// "Bank Details" — a supplier can have more than one bank account, added
// via the "Add Another Account" button, so this is used for both create
// and update of a single row (all fields optional, filled in gradually).
export class UpsertSupplierBankAccountDto {
  @IsOptional()
  @IsString()
  accountName?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  branchName?: string;

  @IsOptional()
  @IsString()
  branchCode?: string;

  @IsOptional()
  @IsString()
  swiftCode?: string;

  @IsOptional()
  @IsString()
  iban?: string;
}

// Fixed dropdown for the "Documents" upload section — same set as the
// customer side (see PARTY_DOCUMENT_TYPES in customer/dto/customer.dto.ts).
export const SUPPLIER_DOCUMENT_TYPES = ['CR Paper', 'Vat Reg. Paper', 'Riyada', 'Others'] as const;

export class UploadSupplierDocumentDto {
  @IsString()
  @IsIn(SUPPLIER_DOCUMENT_TYPES as unknown as string[])
  docType: string;
}

// One entry in the supplier's Interaction Log (CRM Step 6).
export class CreateSupplierInteractionDto {
  @IsEnum(InteractionType)
  type: InteractionType;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  interactionDate?: string;
}

export class PurchaseOrderItemDto {
  @IsString()
  rawMaterialId: string;

  @IsNumber()
  @Min(0.001)
  quantity: number;

  @IsNumber()
  @Min(0)
  costPerUnit: number;

  // Defaults to 5 (Oman standard rate) in the service if left blank.
  @IsOptional()
  @IsNumber()
  @Min(0)
  vatRate?: number;

  // the purchase requisition line this orders
  @IsOptional()
  @IsString()
  requisitionItemId?: string;
}

export class CreatePurchaseOrderDto {
  @IsString()
  supplierId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items: PurchaseOrderItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;

  // when the goods are expected (YYYY-MM-DD)
  @IsOptional()
  @IsString()
  expectedDate?: string;

  // made from an approved purchase requisition
  @IsOptional()
  @IsString()
  requisitionId?: string;
}

// One line of a goods receipt: how much of a PO line arrived.
export class ReceiveLineDto {
  @IsString()
  purchaseOrderItemId: string;

  @IsNumber()
  @Min(0.001)
  quantity: number;
}

// Goods receipt (GRN) against a purchase order. No lines = everything
// still outstanding arrived.
export class ReceivePurchaseOrderDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  items?: ReceiveLineDto[];

  @IsOptional()
  @IsString()
  receivedDate?: string; // defaults to today

  // The supplier's tax invoice - required when the delivery carries VAT.
  @IsOptional()
  @IsString()
  supplierInvoiceNumber?: string;

  @IsOptional()
  @IsString()
  supplierInvoiceDate?: string;

  // total on the supplier's invoice (incl. VAT) - checked against the
  // delivery's value at PO prices (three-way match)
  @IsOptional()
  @IsNumber()
  @Min(0)
  supplierInvoiceTotal?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

// Supplier Payment (Pay Bills) — records paying a RECEIVED purchase
// order's Accounts Payable balance down, in one or more installments.
export class CreateSupplierPaymentDto {
  @IsNumber()
  @Min(0.001)
  amount: number;

  @IsOptional()
  @IsEnum(PaymentType)
  paymentType?: PaymentType;

  // Defaults to today (service-side) if left blank.
  @IsOptional()
  @IsString()
  paymentDate?: string;

  @IsOptional()
  @IsString()
  note?: string;

  // If set, also records an automatic withdrawal on this bank/cash
  // account and auto-posts Dr 2000 Accounts Payable / Cr {this account}.
  // Leaving it blank keeps this a record-only payment (no bank movement,
  // no auto-posted journal entry) — same optional-bank-sync convention
  // used by Expense/Reimbursement/InvoicePayment.
  // Required: every payment moves money in or out of a bank/cash account,
  // and that movement must reach the books (Cash in Hand is an account too).
  @IsString()
  @IsNotEmpty({ message: 'Choose the bank or cash account.' })
  bankAccountId: string;
}

// every field optional, but still validated (a plain Partial<> type is not)
export class UpdatePurchaseOrderDto extends PartialType(CreatePurchaseOrderDto) {}

// every field optional, but still validated (a plain Partial<> type is not)
export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {}
