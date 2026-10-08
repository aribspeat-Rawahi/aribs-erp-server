import { IsNumber, IsOptional, IsString, Min, MinLength, IsNotEmpty } from 'class-validator';

export class GeneratePayrollDto {
  @IsString()
  @MinLength(1)
  from: string;

  @IsString()
  @MinLength(1)
  to: string;
}

// one calendar month: from = the 1st, to = its last day
export class ApprovePayrollDto {
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
  @IsNumber()
  @Min(0)
  allowances?: number;

  // unpaid absence days (corrections to what attendance gave)
  @IsOptional()
  @IsNumber()
  @Min(0)
  unpaidDays?: number;

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
  // Required: every payment moves money in or out of a bank/cash account,
  // and that movement must reach the books (Cash in Hand is an account too).
  @IsString()
  @IsNotEmpty({ message: 'Choose the bank or cash account.' })
  bankAccountId: string;
}

export class UploadPayrollDocumentDto {
  @IsString()
  label: string;
}

export class UpdatePayrollDocumentDto {
  @IsString()
  label: string;
}
