import { Controller, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { StockInRequestService } from './stock-in-request.service';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId?: string; email?: string; role?: string };
}

// Approve / reject a manual stock-in request from the Approvals page.
// strictRoles: a module grant must not open this to other roles.
@Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD, UserRole.ACCOUNTANT)
@ModuleAccess('approvals', { strictRoles: true })
@Controller('stock-in-requests')
export class StockInRequestController {
  constructor(private service: StockInRequestService) {}

  @Post(':id/approve')
  approve(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.approve(id, { userId: req.user?.userId, email: req.user?.email });
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.reject(id, { userId: req.user?.userId, email: req.user?.email });
  }
}
