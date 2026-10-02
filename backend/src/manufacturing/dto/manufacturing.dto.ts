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
