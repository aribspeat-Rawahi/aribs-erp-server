import { IsString, IsNumber, IsOptional, Min, IsIn } from 'class-validator';
import { UNITS } from '../../units/units';

export class CreateRawMaterialDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  // One of pcs | bags | kg | litre | ton (units/units.ts).
  @IsIn(UNITS, { message: 'Unit must be one of: Pcs, Bags, Kgs, Litre, Tons.' })
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
  costPerUnit?: number;

  @IsOptional()
  @IsString()
  supplierId?: string;

  // Inventory Reorder Automation — see RawMaterial.reorderQuantity.
  @IsOptional()
  @IsNumber()
  @Min(0)
  reorderQuantity?: number;
}

export class AdjustStockDto {
  // Positive to add stock (e.g. purchase received),
  // negative to consume stock (e.g. production usage).
  @IsNumber()
  quantityChange: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

// Inventory "Add stock" modal — the direct, batch-tracked way to add raw
// material stock outside of a Purchase Order receive (opening stock,
// stock-count correction, a sample delivery, etc).
export class AddStockDto {
  @IsNumber()
  @Min(0.001)
  quantity: number;

  // This lot's cost — defaults to the material's current costPerUnit if
  // left blank. Feeds a weighted-average update of costPerUnit, same
  // pattern used for FinishedGood.costPerUnit on Production Order complete.
  @IsOptional()
  @IsNumber()
  @Min(0)
  costPerUnit?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
