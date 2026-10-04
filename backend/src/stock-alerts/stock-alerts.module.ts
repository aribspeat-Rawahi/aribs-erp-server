import { Global, Module } from '@nestjs/common';
import { BackorderService } from './backorder.service';
import { EmailService } from '../common/email.service';

// Global: invoices, stock-in, production and returns all report stock changes here.
@Global()
@Module({ providers: [BackorderService, EmailService], exports: [BackorderService] })
export class StockAlertsModule {}
