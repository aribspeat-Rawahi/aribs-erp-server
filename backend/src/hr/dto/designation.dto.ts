import { IsBoolean, IsOptional, IsString, Matches, MinLength } from 'class-validator';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export class CreateDesignationDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR, { message: 'color must be a hex value like #4f46e5' })
  color?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateDesignationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR, { message: 'color must be a hex value like #4f46e5' })
  color?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
