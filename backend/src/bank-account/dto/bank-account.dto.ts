import { IsString, IsOptional, IsEnum, IsNumber, Min, IsArray } from 'class-validator';
import { BankAccountType } from '../bank-account.entity';
import { BankTransactionType } from '../bank-transaction.entity';
import { BankTransactionCategory } from '../bank-transaction-category.enum';

export class CreateBankAccountDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsEnum(BankAccountType)
  type?: BankAccountType;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  openingBalance?: number;
}

export class UpdateBankAccountDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(BankAccountType)
  type?: BankAccountType;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;
}

export class CreateBankTransactionDto {
  @IsEnum(BankTransactionType)
  type: BankTransactionType;

  @IsNumber()
  @Min(0.001)
  amount: number;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  note?: string;

  // Picking a category is what makes this transaction auto-post a
  // Journal Entry (Dr/Cr against the matching Chart-of-Accounts code —
  // see bank-transaction-category.enum.ts). Leaving it blank keeps the
  // old record-only behavior — used internally by other modules that
  // already post their own entry (Reimbursement/Payroll markPaid, etc.),
  // and available here too for a transaction that genuinely shouldn't
  // touch the books (rare — most should pick a category).
  @IsOptional()
  @IsEnum(BankTransactionCategory)
  category?: BankTransactionCategory;
}

export class CompleteReconciliationDto {
  @IsString()
  statementDate: string;

  @IsNumber()
  statementBalance: number;

  @IsArray()
  @IsString({ each: true })
  transactionIds: string[];
}
