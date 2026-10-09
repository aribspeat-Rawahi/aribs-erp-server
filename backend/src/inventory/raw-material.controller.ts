import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { StockInRequestService } from './stock-in-request.service';
import { RawMaterialService } from './raw-material.service';
import { CreateRawMaterialDto, UpdateRawMaterialDto, AddStockDto } from './dto/raw-material.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId?: string; email?: string; role?: string };
}

@ModuleAccess('inventory')
@Controller('raw-materials')
export class RawMaterialController {
  constructor(
    private service: RawMaterialService,
    private stockIn: StockInRequestService,
  ) {}

  @ModuleAccess('inventory', { readAlso: ['suppliers', 'accounting'] })

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('low-stock')
  findLowStock() {
    return this.service.findLowStock();
  }

  // Inventory Reorder Automation — low-stock materials grouped by
  // supplier with a suggested reorder quantity each, for the Suppliers
  // page's "Reorder Suggestions" tab.
  @ModuleAccess('inventory', { readAlso: ['suppliers'] })
  @Get('reorder-suggestions')
  getReorderSuggestions() {
    return this.service.getReorderSuggestions();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateRawMaterialDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRawMaterialDto) {
    return this.service.update(id, dto);
  }

  // Note: RawMaterialService.adjustStock() (used internally by Purchase
  // Order receive) has no HTTP endpoint here on purpose — it skips batch
  // tracking, so an open, unrestricted PATCH for it would let anyone
  // silently move stock with no lot/audit trail. Use "Add stock" below
  // (or a Purchase Order) for anything reachable from the UI.

  // Inventory "Add stock" modal — direct, batch-tracked stock-in (opening
  // stock, stock-count correction, a sample delivery, etc.) with no
  // Purchase Order needed. Creates a traceable RawMaterialBatch.
  // Admin/CEO/MD/Accountant add directly; other roles send it for approval
  // (it posts to 5110 Inventory Adjustments, so it moves profit).
  @Post(':id/add-stock')
  addStock(@Param('id') id: string, @Body() dto: AddStockDto, @Req() req: AuthedRequest) {
    return this.stockIn.rawMaterialAddStock(id, dto, { userId: req.user?.userId, email: req.user?.email, role: req.user?.role });
  }

  // Admin only — see RawMaterialService.remove() for the safety guards.
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
