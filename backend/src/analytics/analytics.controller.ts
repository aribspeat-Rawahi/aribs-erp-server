import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { ModuleAccess } from '../auth/module-access.decorator';

@ModuleAccess('accounting', { readAlso: ['dashboard'] })
@Controller('analytics')
export class AnalyticsController {
  constructor(private service: AnalyticsService) {}

  // e.g. GET /analytics/product-profitability?startDate=2026-09-01&endDate=2026-09-30
  @Get('product-profitability')
  getProductProfitability(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.service.getProductProfitability(startDate, endDate);
  }

  // e.g. GET /analytics/customer-analytics?startDate=2026-09-01&endDate=2026-09-30
  @Get('customer-analytics')
  getCustomerAnalytics(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.service.getCustomerAnalytics(startDate, endDate);
  }

  // e.g. GET /analytics/revenue-trend?months=12
  @Get('revenue-trend')
  getRevenueTrend(@Query('months') months?: string) {
    return this.service.getRevenueTrend(months ? Number(months) : 12);
  }

  // e.g. GET /analytics/inventory-turnover?days=90
  @Get('inventory-turnover')
  getInventoryTurnover(@Query('days') days?: string) {
    return this.service.getInventoryTurnover(days ? Number(days) : 90);
  }
}
