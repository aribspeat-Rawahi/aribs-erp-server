import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CustomerService } from './customer.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

@ModuleAccess('customers')
@Controller('customers')
export class CustomerController {
  constructor(private service: CustomerService) {}

  @ModuleAccess('customers', { readAlso: ['sales_orders', 'quotations', 'delivery_notes', 'invoices', 'recurring_invoices', 'inventory', 'accounting', 'payments', 'pending'] })

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // All quotations/invoices/delivery notes for this customer — the
  // "view all data" history shown on the customer detail screen.
  @Get(':id/history')
  history(@Param('id') id: string) {
    return this.service.history(id);
  }

  @Post()
  create(@Body() dto: CreateCustomerDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.service.update(id, dto);
  }

  // Admin only — deleting a customer record isn't something any role
  // should be able to do casually. MD/CEO/GM get an email notice.
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.remove(id, { userId: req.user?.userId, email: req.user?.email });
  }
}
