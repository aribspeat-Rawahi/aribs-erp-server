import { IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateDepartmentDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  otRatePerHour?: number;
}

export class UpdateDepartmentDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  otRatePerHour?: number;
}
