import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SalaryAdvanceService } from './salary-advance.service';
import { CreateSalaryAdvanceDto, DisburseSalaryAdvanceDto } from './dto/salary-advance.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

// Same role set as Reimbursement's APPROVAL_ROLES — the people trusted
// to approve/reject and to actually disburse money.
const APPROVAL_ROLES = [UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.CEO, UserRole.MD];

@Controller('salary-advances')
export class SalaryAdvanceController {
  constructor(private service: SalaryAdvanceService) {}

  // List/create are open to any logged-in user (no @Roles) — same as
  // Reimbursement's list/create, since anyone should be able to submit
  // a request or see the record-keeping list.
  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  create(@Body() dto: CreateSalaryAdvanceDto, @Req() req: AuthedRequest) {
    return this.service.create(dto, { userId: req.user?.userId, email: req.user?.email });
  }

  // Called from the Approvals dashboard — mirrors Invoice/Quotation's
  // own approval-requests/:id/approve|reject pattern exactly.
  @Roles(...APPROVAL_ROLES)
  @Post('approval-requests/:id/approve')
  approveRequest(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.applyApprovedRequest(id, { userId: req.user?.userId, email: req.user?.email });
  }

  @Roles(...APPROVAL_ROLES)
  @Post('approval-requests/:id/reject')
  rejectRequest(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.rejectRequest(id, { userId: req.user?.userId, email: req.user?.email });
  }

  // The actual payout, once approved.
  @Roles(...APPROVAL_ROLES)
  @Post(':id/disburse')
  disburse(@Param('id') id: string, @Body() dto: DisburseSalaryAdvanceDto, @Req() req: AuthedRequest) {
    return this.service.disburse(id, dto, { userId: req.user?.userId, email: req.user?.email });
  }
}
