import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ProductionOrderService } from './production-order.service';
import { CreateProductionOrderDto } from './dto/manufacturing.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

@Controller('production-orders')
export class ProductionOrderController {
  constructor(private service: ProductionOrderService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateProductionOrderDto) {
    return this.service.create(dto);
  }

  // Consumes raw materials per BOM, adds finished goods stock.
  @Post(':id/complete')
  complete(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.complete(id, { userId: req.user?.userId, email: req.user?.email });
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }

  // Only while still 'planned' — see ProductionOrderService.update().
  @Roles(UserRole.ADMIN, UserRole.PRODUCTION)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateProductionOrderDto>) {
    return this.service.update(id, dto);
  }

  // Only while still 'planned' — see ProductionOrderService.remove().
  @Roles(UserRole.ADMIN, UserRole.PRODUCTION)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
