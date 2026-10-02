import { Controller, Get, Query } from '@nestjs/common';
import { ActivityLogService } from './activity-log.service';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';

@Controller('activity-logs')
export class ActivityLogController {
  constructor(private service: ActivityLogService) {}

  // Audit trail visibility: Admin/CEO/MD (existing), plus Accountant
  // now that Accountants can also delete invoices/quotations/delivery
  // notes and everyone in this group needs to see who deleted what.
  @Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD, UserRole.ACCOUNTANT)
  @Get()
  findAll(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('userId') userId?: string,
  ) {
    return this.service.findAll({ entityType, entityId, userId });
  }
}
