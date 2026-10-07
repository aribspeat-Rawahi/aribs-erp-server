import { IsNumber, IsOptional, IsString, Min, MinLength, IsNotEmpty } from 'class-validator';

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
  // Required: every payment moves money in or out of a bank/cash account,
  // and that movement must reach the books (Cash in Hand is an account too).
  @IsString()
  @IsNotEmpty({ message: 'Choose the bank or cash account.' })
  bankAccountId: string;
}
