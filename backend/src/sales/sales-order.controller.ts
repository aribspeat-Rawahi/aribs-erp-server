import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SalesOrderService } from './sales-order.service';
import { CreateSalesOrderDto } from './dto/sales-order.dto';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

@Controller('sales-orders')
export class SalesOrderController {
  constructor(private service: SalesOrderService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateSalesOrderDto) {
    return this.service.create(dto);
  }

  // Deducts finished goods stock — the actual "sale" moment.
  @Post(':id/complete')
  complete(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.complete(id, { userId: req.user?.userId, email: req.user?.email });
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }
}
