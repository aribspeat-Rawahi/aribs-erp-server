import { IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateSalaryAdvanceDto {
  @IsString()
  @MinLength(1)
  employeeId: string;

  @IsNumber()
  @Min(0.001)
  amount: number;

  @IsString()
  @MinLength(1)
  reason: string;
}

// Bank account is optional — same convention as MarkPayrollPaidDto:
// leaving it blank keeps this a record-only disbursement (no bank
// movement, no auto-posted journal entry).
export class DisburseSalaryAdvanceDto {
  @IsOptional()
  @IsString()
  bankAccountId?: string;
}
