import { IsString, IsOptional, IsEnum, IsInt, IsNumber, Min, Max, MaxLength } from 'class-validator';
import { InvoiceTemplate } from '../settings.entity';

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  companyVatin?: string;

  @IsOptional()
  @IsString()
  companyAddress?: string;

  @IsOptional()
  @IsString()
  companyPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyNameArabic?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  companyCrNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  companyEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  companyPoBox?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  companyPostalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  companyCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  companyCityArabic?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  companyGsm?: string;

  @IsOptional()
  @IsEnum(InvoiceTemplate)
  defaultInvoiceTemplate?: InvoiceTemplate;

  // Comma-separated day-of-week numbers, e.g. "5,6" for Friday/Saturday.
  @IsOptional()
  @IsString()
  weeklyOffDays?: string;

  @IsOptional()
  @IsString()
  shiftStartTime?: string;

  @IsOptional()
  @IsString()
  shiftEndTime?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  attendanceGraceMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  incomeTaxRatePercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  spfEmployeeRatePercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  spfEmployerRatePercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  spfWageCeiling?: number;

  @IsOptional()
  @IsString()
  expatSavingsSchemeStart?: string;
}

export class UploadCompanyDocumentDto {
  @IsString()
  title: string;
}

export class UpdateCompanyDocumentDto {
  @IsString()
  title: string;
}
