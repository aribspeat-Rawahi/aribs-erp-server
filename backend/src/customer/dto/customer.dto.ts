import { PartialType } from '@nestjs/mapped-types';
import { IsString, IsOptional, IsBoolean, IsIn, IsNumber, Min, Max, IsInt, IsEnum } from 'class-validator';
import { InteractionType } from '../../common/interaction-type.enum';

export class CreateCustomerDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  crNumber?: string;

  @IsOptional()
  @IsString()
  vatin?: string;

  @IsOptional()
  @IsBoolean()
  vatApplicable?: boolean;

  // Leave blank for no credit limit (unlimited). See Customer.creditLimit.
  @IsOptional()
  @IsNumber()
  @Min(0)
  creditLimit?: number;

  // days after the invoice date; 0 = due at once; null clears it
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays?: number | null;
}

// "Bank Details" — a customer can have more than one bank account, added
// via the "Add Another Account" button, so this is used for both create
// and update of a single row (all fields optional, filled in gradually).
export class UpsertCustomerBankAccountDto {
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

// Fixed dropdown for the "Documents" upload section — kept as a plain
// string column (not a DB enum) so a new type can be added here later
// without a migration.
export const PARTY_DOCUMENT_TYPES = ['CR Paper', 'Vat Reg. Paper', 'Riyada', 'Others'] as const;

// Sent alongside the file in a multipart/form-data POST when uploading a
// document for a customer.
export class UploadCustomerDocumentDto {
  @IsString()
  @IsIn(PARTY_DOCUMENT_TYPES as unknown as string[])
  docType: string;
}

// One entry in the customer's Interaction Log (CRM Step 6).
export class CreateCustomerInteractionDto {
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

// every field optional, but still validated (a plain Partial<> type is not)
export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}
