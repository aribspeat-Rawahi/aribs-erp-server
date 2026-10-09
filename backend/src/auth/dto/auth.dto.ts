import { IsString, IsEmail, IsOptional, IsEnum, IsBoolean, IsObject, MinLength } from 'class-validator';
import { UserRole } from '../user.entity';
import { ModulePermissions } from '../module-permissions';

export class RegisterUserDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  // Per-module access overrides (see module-permissions.ts). Sanitized
  // against the known module-key/access-level lists in AuthService
  // before it's ever saved — this DTO-level check just rejects anything
  // that isn't a plain object outright.
  @IsOptional()
  @IsObject()
  modulePermissions?: ModulePermissions | null;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class SetPasswordDto {
  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(20)
  token: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}
