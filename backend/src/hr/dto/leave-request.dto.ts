import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { LeaveStatus } from '../leave-request.entity';

export class CreateLeaveRequestDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsString()
  @MinLength(1)
  staffName: string;

  @IsOptional()
  @IsString()
  shortDescription?: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsString()
  requestFrom: string;

  @IsString()
  requestTo: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  leaves?: number;

  @IsOptional()
  @IsEnum(LeaveStatus)
  status?: LeaveStatus;

  @IsOptional()
  @IsString()
  manageBy?: string;
}

export class UpdateLeaveRequestDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  staffName?: string;

  @IsOptional()
  @IsString()
  shortDescription?: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  requestFrom?: string;

  @IsOptional()
  @IsString()
  requestTo?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  leaves?: number;

  @IsOptional()
  @IsEnum(LeaveStatus)
  status?: LeaveStatus;

  @IsOptional()
  @IsString()
  manageBy?: string;
}
