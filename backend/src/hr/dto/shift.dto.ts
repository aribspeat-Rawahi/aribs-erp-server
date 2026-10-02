import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateShiftDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  startTime: string;

  @IsString()
  endTime: string;

  @IsOptional()
  @IsString()
  lateTime?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateShiftDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  @IsString()
  lateTime?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
