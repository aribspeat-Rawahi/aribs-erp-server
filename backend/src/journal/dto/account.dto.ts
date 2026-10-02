import { IsString, IsOptional, IsEnum, IsBoolean } from 'class-validator';
import { AccountType } from '../account.entity';

export class CreateAccountDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsEnum(AccountType)
  type: AccountType;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(AccountType)
  type?: AccountType;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
