import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PayrollService } from './payroll.service';
import { GeneratePayrollDto, UpdatePayrollDto, MarkPayrollPaidDto, ApprovePayrollDto } from './dto/payroll.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

@ModuleAccess('hr')
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

  // Approve every draft row of a month: books the salary cost (accrual).
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Post('approve')
  approveMonth(@Body() dto: ApprovePayrollDto, @Req() req: AuthedRequest) {
    return this.service.approveMonth(dto, { userId: req.user?.userId, email: req.user?.email });
  }

  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Post(':id/approve')
  approve(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.approve(id, { userId: req.user?.userId, email: req.user?.email });
  }

  // approved -> draft again (not once paid)
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Post(':id/unapprove')
  unapprove(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.unapprove(id, { userId: req.user?.userId, email: req.user?.email });
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
