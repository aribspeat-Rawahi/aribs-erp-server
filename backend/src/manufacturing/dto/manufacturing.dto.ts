import { PartialType } from '@nestjs/mapped-types';
import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

export class AddBomLineDto {
  @IsString()
  finishedGoodId: string;

  @IsString()
  rawMaterialId: string;

  @IsNumber()
  @Min(0.0001)
  quantityPerUnit: number;
}

export class CreateProductionOrderDto {
  @IsString()
  finishedGoodId: string;

  @IsNumber()
  @Min(0.001)
  quantityToProduce: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

// every field optional, but still validated (a plain Partial<> type is not)
export class UpdateBomLineDto extends PartialType(AddBomLineDto) {}

// every field optional, but still validated (a plain Partial<> type is not)
export class UpdateProductionOrderDto extends PartialType(CreateProductionOrderDto) {}
