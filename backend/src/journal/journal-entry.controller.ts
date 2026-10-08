import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { JournalEntryService } from './journal-entry.service';
import { CreateJournalEntryDto } from './dto/journal-entry.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';
import { omanToday } from '../common/oman-date';

const ACCOUNTING_ROLES = [UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.CEO, UserRole.MD];

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

// Manual double-entry bookkeeping — restricted to accounting-facing roles
// end-to-end (unlike Reimbursement/Expense, which any staff member can
// submit), since a Journal Entry directly adjusts the books.
@ModuleAccess('accounting')
@Controller('journal-entries')
@Roles(...ACCOUNTING_ROLES)
export class JournalEntryController {
  constructor(private service: JournalEntryService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('trial-balance')
  getTrialBalance() {
    return this.service.getTrialBalance();
  }

  // e.g. GET /journal-entries/income-statement?startDate=2026-09-01&endDate=2026-09-30
  @Get('income-statement')
  getIncomeStatement(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.service.getIncomeStatement(startDate, endDate);
  }

  // e.g. GET /journal-entries/balance-sheet?asOfDate=2026-09-30 (defaults to today)
  @Get('balance-sheet')
  getBalanceSheet(@Query('asOfDate') asOfDate?: string) {
    return this.service.getBalanceSheet(asOfDate || omanToday());
  }

  // Ledger Report — e.g. GET /journal-entries/ledger/<accountId>?startDate=...&endDate=...
  @Get('ledger/:accountId')
  getLedger(@Param('accountId') accountId: string, @Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.service.getLedgerForAccount(accountId, startDate, endDate);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateJournalEntryDto, @Req() req: AuthedRequest) {
    return this.service.create(dto, { userId: req.user?.userId, email: req.user?.email });
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.remove(id, { userId: req.user?.userId, email: req.user?.email });
  }
}
