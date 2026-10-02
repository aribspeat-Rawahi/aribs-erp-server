import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { PurchaseOrderService } from './purchase-order.service';
import { CreatePurchaseOrderDto } from './dto/supplier.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';

@Controller('purchase-orders')
export class PurchaseOrderController {
  constructor(private service: PurchaseOrderService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreatePurchaseOrderDto) {
    return this.service.create(dto);
  }

  // Only while status is still "ordered" — see PurchaseOrderService.update().
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreatePurchaseOrderDto>) {
    return this.service.update(id, dto);
  }

  // Only while status is still "ordered" — see PurchaseOrderService.remove().
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  // Marks goods as physically received — this is what increases raw
  // material stock. Admin and Accountant only — a stock-moving,
  // financially-relevant action.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Post(':id/receive')
  receive(@Param('id') id: string) {
    return this.service.receive(id);
  }

  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }
}
