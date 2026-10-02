import { IsString, IsNumber, IsOptional, IsEnum, Min } from 'class-validator';
import { ReimbursementCategory } from '../reimbursement.entity';

export class CreateReimbursementDto {
  @IsString()
  employeeId: string;

  @IsEnum(ReimbursementCategory)
  category: ReimbursementCategory;

  @IsNumber()
  @Min(0.001)
  amount: number;

  @IsOptional()
  @IsString()
  date?: string; // defaults to today

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  invoiceNumber?: string;
}

// Editing is only allowed while still PENDING (see ReimbursementService.update()),
// so every field here is safe to change up until approval.
export class UpdateReimbursementDto {
  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsEnum(ReimbursementCategory)
  category?: ReimbursementCategory;

  @IsOptional()
  @IsNumber()
  @Min(0.001)
  amount?: number;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  invoiceNumber?: string;
}

export class RejectReimbursementDto {
  @IsString()
  reason: string;
}

export class MarkReimbursementPaidDto {
  @IsString()
  paymentMethod: string; // e.g. "Cash", "Bank Transfer", "Cheque"

  @IsOptional()
  @IsString()
  note?: string;

  // If set, also records an automatic withdrawal on this bank/cash
  // account (see ReimbursementService.markPaid()). Omit for a
  // record-only payment, matching how Expense never touches bank-account.
  @IsOptional()
  @IsString()
  bankAccountId?: string;
}
