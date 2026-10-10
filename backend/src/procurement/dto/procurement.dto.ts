import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class RequisitionItemDto {
  @IsString()
  rawMaterialId: string;

  @IsNumber()
  @Min(0.001)
  quantity: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedUnitCost?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}

export class CreateRequisitionDto {
  @IsString()
  @MinLength(3)
  purpose: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  department?: string;

  @IsOptional()
  @IsString()
  neededBy?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RequisitionItemDto)
  items: RequisitionItemDto[];
}

export class UpdateRequisitionDto extends PartialType(CreateRequisitionDto) {}

export class RfqItemDto {
  @IsString()
  rawMaterialId: string;

  @IsNumber()
  @Min(0.001)
  quantity: number;

  @IsOptional()
  @IsString()
  requisitionItemId?: string;
}

export class CreateRfqDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  // copy the lines still to be ordered from this approved requisition
  @IsOptional()
  @IsString()
  requisitionId?: string;

  @IsOptional()
  @IsString()
  quotesDueBy?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RfqItemDto)
  items?: RfqItemDto[];
}

export class QuoteLineDto {
  @IsString()
  rfqItemId: string;

  @IsNumber()
  @Min(0)
  unitPrice: number;
}

export class RfqQuoteDto {
  @IsString()
  supplierId: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  quoteReference?: string;

  @IsOptional()
  @IsString()
  quoteDate?: string;

  @IsOptional()
  @IsString()
  validUntil?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  deliveryDays?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineDto)
  lines: QuoteLineDto[];
}

export class AwardRfqDto {
  @IsString()
  quoteId: string;

  // required when the chosen quote is not the lowest complete one
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @IsOptional()
  @IsString()
  expectedDate?: string;
}
