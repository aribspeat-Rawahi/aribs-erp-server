import { IsString, IsNumber, IsOptional, IsEnum, Min } from 'class-validator';
import { ExpenseCategory } from '../expense.entity';

export class CreateExpenseDto {
  @IsEnum(ExpenseCategory)
  category: ExpenseCategory;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsString()
  date?: string; // defaults to today

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  vendorName?: string;

  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  // Which cash/bank account this expense was actually paid from. If
  // set, a real withdrawal is recorded on that account and a Journal
  // Entry is auto-posted. Leave blank for a record-only expense.
  @IsOptional()
  @IsString()
  bankAccountId?: string;
}

export class UpdateExpenseDto {
  @IsOptional()
  @IsEnum(ExpenseCategory)
  category?: ExpenseCategory;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  vendorName?: string;

  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  // Same as CreateExpenseDto.bankAccountId — pass '' to clear it back to
  // a record-only expense (reverses any existing withdrawal).
  @IsOptional()
  @IsString()
  bankAccountId?: string;
}
