import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

export class CreateFinishedGoodDto {
  @IsString()
  name: string;

  // The actual barcode value — an official GS1 code already printed on
  // the bag, or any code you assign manually. Required: we no longer
  // auto-generate this.
  @IsString()
  barcode: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsString()
  unit: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  quantityInStock?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  lowStockThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sellingPrice?: number;

  // Manual override/starting value — auto-updated by
  // ProductionOrderService.complete() afterwards (see the entity's doc
  // comment). Safe to leave unset (defaults to 0).
  @IsOptional()
  @IsNumber()
  @Min(0)
  costPerUnit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  vatRate?: number;
}

export class ScanStockDto {
  // The scanned (or manually entered) barcode value.
  @IsString()
  barcode: string;

  @IsNumber()
  @Min(0.001)
  quantity: number;
}
