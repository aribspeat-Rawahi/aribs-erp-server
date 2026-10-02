import { IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class GeneratePayrollDto {
  @IsString()
  @MinLength(1)
  from: string;

  @IsString()
  @MinLength(1)
  to: string;
}

export class UpdatePayrollDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  staffSalary?: number;

  @IsOptional()
  @IsString()
  salaryPaidBy?: string;
}

// Payroll "Mark Paid" — if bankAccountId is set, also records a real
// withdrawal on that account and auto-posts Dr 664 Wages & Salaries /
// Cr {account}. Leaving it blank keeps this a record-only payment (no
// bank movement, no auto-posted journal entry), same optional-bank-sync
// convention used by Expense/Reimbursement/InvoicePayment/SupplierPayment.
export class MarkPayrollPaidDto {
  @IsOptional()
  @IsString()
  bankAccountId?: string;
}

export class UploadPayrollDocumentDto {
  @IsString()
  label: string;
}

export class UpdatePayrollDocumentDto {
  @IsString()
  label: string;
}
