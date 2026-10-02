import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PayrollService } from './payroll.service';
import { GeneratePayrollDto, UpdatePayrollDto, MarkPayrollPaidDto } from './dto/payroll.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

@Controller('payroll')
export class PayrollController {
  constructor(private service: PayrollService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  // Computes/refreshes payroll rows for every active employee from real
  // Attendance data over [from, to]. Backs the "Select Starting Date /
  // Select End Date / Generate" row on the Payroll page.
  // Admin/Accountant only — this touches real payroll/financial data.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Post('generate')
  generate(@Body() dto: GeneratePayrollDto) {
    return this.service.generate(dto);
  }

  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePayrollDto) {
    return this.service.update(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  // Marks this payroll row's salary as actually paid out — the one
  // place salary leaves the business. Admin/Accountant only.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Post(':id/pay')
  markPaid(@Param('id') id: string, @Body() dto: MarkPayrollPaidDto, @Req() req: AuthedRequest) {
    return this.service.markPaid(id, dto, { userId: req.user?.userId, email: req.user?.email });
  }
}
