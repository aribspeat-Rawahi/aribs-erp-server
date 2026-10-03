import { Controller, Get } from '@nestjs/common';
import { ApprovalService } from './approval.service';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

// Read-only — the actual approve/reject actions live on InvoiceController/
// QuotationController (they need those services to replay the stored
// payload), and for the pre-existing quotation price-edit flow, on
// QuotationController's existing edit-requests endpoints. This endpoint
// is just the combined dashboard list.
@ModuleAccess('approvals')
@Controller('approvals')
export class ApprovalController {
  constructor(private service: ApprovalService) {}

  @Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD, UserRole.ACCOUNTANT)
  @Get('pending')
  findPending() {
    return this.service.findPendingCombined();
  }
}
