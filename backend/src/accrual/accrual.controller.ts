import { Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AccrualPostingService } from './accrual-posting.service';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

// Manual "recompute now" triggers for the two statutory accruals — lets
// an Admin/Accountant refresh the numbers right after editing an
// employee's salary/join date or the income tax rate, without waiting
// for the 1st-of-month cron (same reasoning as
// FixedAssetController's per-asset "depreciate now" endpoint).
@Controller('accruals')
@Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
export class AccrualController {
  constructor(private service: AccrualPostingService) {}

  @Post('eosb/recompute')
  async recomputeEosb(@Req() req: AuthedRequest) {
    const actor = { userId: req.user?.userId, email: req.user?.email };
    await this.service.runMonthlyEosbAccrual(actor);
    return { recomputed: true };
  }

  @Post('income-tax/recompute')
  async recomputeIncomeTax(@Req() req: AuthedRequest) {
    const actor = { userId: req.user?.userId, email: req.user?.email };
    const provision = await this.service.postIncomeTaxProvision(actor);
    return { provision };
  }
}
