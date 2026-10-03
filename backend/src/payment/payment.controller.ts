import { Controller, Get } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

// Read-only combined view over every payment-like record already in the
// system (invoice payments, supplier payments, payroll payouts,
// reimbursement payouts, tax payments, fund transfers). Nothing here
// creates/edits/deletes anything — each source page keeps working exactly
// as before.
const VIEW_ROLES = [UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.CEO, UserRole.MD];

@ModuleAccess('payments')
@Controller('payments')
export class PaymentController {
  constructor(private paymentService: PaymentService) {}

  @Get()
  @Roles(...VIEW_ROLES)
  findAll() {
    return this.paymentService.findAll();
  }

  @ModuleAccess('pending')

  @Get('pending')
  @Roles(...VIEW_ROLES)
  findPending() {
    return this.paymentService.findPending();
  }
}
