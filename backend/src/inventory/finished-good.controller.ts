import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { FinishedGoodService } from './finished-good.service';
import { CreateFinishedGoodDto, ScanStockDto } from './dto/finished-good.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

@ModuleAccess('inventory')
@Controller('finished-goods')
export class FinishedGoodController {
  constructor(private service: FinishedGoodService) {}

  @ModuleAccess('inventory', { readAlso: ['sales_orders', 'quotations', 'delivery_notes', 'invoices', 'recurring_invoices', 'accounting'] })

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('low-stock')
  findLowStock() {
    return this.service.findLowStock();
  }

  @Get('barcode/:barcode')
  findByBarcode(@Param('barcode') barcode: string) {
    return this.service.findByBarcode(barcode);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // Creates the product AND returns a printable QR image for labeling.
  @Post()
  create(@Body() dto: CreateFinishedGoodDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateFinishedGoodDto>) {
    return this.service.update(id, dto);
  }

  // Called after a production run finishes. `barcode` can come from a
  // handheld scanner, a phone camera scan, or manual typing — same endpoint.
  @Post('stock-in')
  stockIn(@Body() dto: ScanStockDto) {
    return this.service.stockIn(dto);
  }

  // Called at point of sale, same scan-or-manual flexibility.
  @Post('stock-out')
  stockOut(@Body() dto: ScanStockDto) {
    return this.service.stockOut(dto);
  }

  // Admin only — see FinishedGoodService.remove() for the safety guards.
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
