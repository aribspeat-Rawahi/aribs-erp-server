import { Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { DeletedRecordsService } from './deleted-records.service';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

// Activity Log > Deleted. Only Admin, CEO, MD and Accountant - strictRoles:
// an Activity Log grant to another user does not unlock it, so a forwarded
// undo link is useless to anyone else.
@Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD, UserRole.ACCOUNTANT)
@ModuleAccess('activity_log', { strictRoles: true })
@Controller('deleted-records')
export class DeletedRecordsController {
  constructor(private service: DeletedRecordsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.restore(id, { userId: req.user?.userId, email: req.user?.email, role: req.user?.role });
  }
}
