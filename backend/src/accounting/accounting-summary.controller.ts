import { Controller, Get, Query } from '@nestjs/common';
import { AccountingSummaryService } from './accounting-summary.service';
import { ModuleAccess } from '../auth/module-access.decorator';

@ModuleAccess('accounting')
@Controller('accounting')
export class AccountingSummaryController {
  constructor(private service: AccountingSummaryService) {}

  // e.g. GET /accounting/summary?startDate=2026-09-01&endDate=2026-09-30
  @Get('summary')
  getSummary(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.service.getSummary(startDate, endDate);
  }
}
