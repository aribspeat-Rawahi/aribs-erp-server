import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RecurringInvoiceService } from './recurring-invoice.service';
import { CreateRecurringInvoiceDto, UpdateRecurringInvoiceDto } from './dto/recurring-invoice.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

// Sets up real recurring billing — restricted to Admin/Accountant for
// every mutating action, same bar as deleting an invoice.
@ModuleAccess('recurring_invoices')
@Controller('recurring-invoices')
export class RecurringInvoiceController {
  constructor(private service: RecurringInvoiceService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOneView(id);
  }

  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Post()
  create(@Body() dto: CreateRecurringInvoiceDto, @Req() req: AuthedRequest) {
    return this.service.create(dto, req.user?.email);
  }

  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRecurringInvoiceDto) {
    return this.service.update(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Post(':id/generate-now')
  generateNow(@Param('id') id: string) {
    return this.service.generateNow(id);
  }

  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
