import { IsString, IsOptional, IsEnum, IsBoolean, IsNumber, Min } from 'class-validator';
import { AttendanceStatus } from '../attendance.entity';

export class CreateEmployeeDto {
  @IsString()
  name: string;

  @IsString()
  role: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  joinedDate?: string;

  @IsOptional()
  @IsString()
  staffId?: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsString()
  team?: string;

  @IsOptional()
  @IsString()
  shift?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  baseSalary?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  housingAllowance?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  transportAllowance?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  otherAllowance?: number;

  @IsOptional()
  @IsBoolean()
  socialProtectionCovered?: boolean;

  @IsOptional()
  @IsString()
  leftDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  otRatePerHour?: number;

  @IsOptional()
  @IsString()
  biometricId?: string;

  @IsOptional()
  @IsEnum(['temporary', 'permanent'])
  employmentType?: string;

  @IsOptional()
  @IsEnum(['working', 'terminated', 'others'])
  status?: string;

  // --- "Others Detail" section (all optional; see the shared comment
  // above UpdateEmployeeDto's copy of these fields) ---
  @IsOptional()
  @IsString()
  fatherName?: string;

  @IsOptional()
  @IsString()
  motherName?: string;

  @IsOptional()
  @IsString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  passportNumber?: string;

  // ISO 3166-1 alpha-2 country code (e.g. "BD"), chosen from a dropdown on
  // the frontend — used there to render the flag next to the employee's
  // name on the Dashboard and in Employee details.
  @IsOptional()
  @IsString()
  nationality?: string;

  @IsOptional()
  @IsString()
  originCountryIdNumber?: string;

  @IsOptional()
  @IsString()
  homeAddress?: string;

  @IsOptional()
  @IsString()
  educationalQualifications?: string;

  @IsOptional()
  @IsString()
  skills?: string;

  @IsOptional()
  @IsString()
  certifications?: string;

  @IsOptional()
  @IsString()
  guardianName?: string;

  @IsOptional()
  @IsString()
  guardianPhone?: string;

  @IsOptional()
  @IsString()
  guardianNationalId?: string;

  @IsOptional()
  @IsString()
  guardianRelationship?: string;

  @IsOptional()
  @IsString()
  guardianAddress?: string;

  @IsOptional()
  @IsString()
  emergencyPhone1?: string;

  @IsOptional()
  @IsString()
  emergencyPhone2?: string;

  @IsOptional()
  @IsString()
  nomineeName?: string;

  @IsOptional()
  @IsString()
  nomineeNationalId?: string;

  @IsOptional()
  @IsString()
  nomineePhone?: string;

  @IsOptional()
  @IsString()
  nomineeRelationship?: string;
}

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  joinedDate?: string;

  @IsOptional()
  @IsString()
  staffId?: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsString()
  team?: string;

  @IsOptional()
  @IsString()
  shift?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  baseSalary?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  housingAllowance?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  transportAllowance?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  otherAllowance?: number;

  @IsOptional()
  @IsBoolean()
  socialProtectionCovered?: boolean;

  @IsOptional()
  @IsString()
  leftDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  otRatePerHour?: number;

  @IsOptional()
  @IsString()
  biometricId?: string;

  @IsOptional()
  @IsEnum(['temporary', 'permanent'])
  employmentType?: string;

  @IsOptional()
  @IsEnum(['working', 'terminated', 'others'])
  status?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  // --- "Others Detail" section (all optional) ---
  @IsOptional()
  @IsString()
  fatherName?: string;

  @IsOptional()
  @IsString()
  motherName?: string;

  @IsOptional()
  @IsString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  passportNumber?: string;

  @IsOptional()
  @IsString()
  nationality?: string;

  @IsOptional()
  @IsString()
  originCountryIdNumber?: string;

  @IsOptional()
  @IsString()
  homeAddress?: string;

  @IsOptional()
  @IsString()
  educationalQualifications?: string;

  @IsOptional()
  @IsString()
  skills?: string;

  @IsOptional()
  @IsString()
  certifications?: string;

  @IsOptional()
  @IsString()
  guardianName?: string;

  @IsOptional()
  @IsString()
  guardianPhone?: string;

  @IsOptional()
  @IsString()
  guardianNationalId?: string;

  @IsOptional()
  @IsString()
  guardianRelationship?: string;

  @IsOptional()
  @IsString()
  guardianAddress?: string;

  @IsOptional()
  @IsString()
  emergencyPhone1?: string;

  @IsOptional()
  @IsString()
  emergencyPhone2?: string;

  @IsOptional()
  @IsString()
  nomineeName?: string;

  @IsOptional()
  @IsString()
  nomineeNationalId?: string;

  @IsOptional()
  @IsString()
  nomineePhone?: string;

  @IsOptional()
  @IsString()
  nomineeRelationship?: string;
}

// Sent when "Delete" archives an employee instead of hard-deleting them
// (see EmployeeService.archive()).
export class ArchiveEmployeeDto {
  @IsEnum(['old', 'temporary'])
  archiveType: 'old' | 'temporary';
}

export class MarkAttendanceDto {
  @IsString()
  employeeId: string;

  @IsOptional()
  @IsString()
  date?: string; // defaults to today if omitted

  @IsOptional()
  @IsString()
  checkIn?: string;

  @IsOptional()
  @IsString()
  checkOut?: string;

  @IsOptional()
  @IsString()
  lunchIn?: string;

  @IsOptional()
  @IsString()
  lunchOut?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  breakMinutes?: number;

  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  overtimeHours?: number;
}

// Payload a fingerprint/biometric device (or a small bridge script
// polling one) will POST to /attendance/device-punch once hardware is
// in place. First punch of the day for an employee = check-in, the
// next one = check-out (last-scan-wins, so a stray extra tap just
// updates check-out again).
export class DevicePunchDto {
  @IsString()
  biometricId: string;

  // ISO datetime of the scan. Defaults to server "now" if omitted —
  // useful for a device with reliable clock sync; for one without,
  // send the device's own timestamp so attendance times stay accurate.
  @IsOptional()
  @IsString()
  timestamp?: string;
}

// Sent alongside the file in a multipart/form-data POST when uploading a
// document for an employee (Residence ID, Passport, Visa, ...). Free
// text, not a fixed enum, since the set of document types varies.
export class UploadEmployeeDocumentDto {
  @IsString()
  label: string;
}
