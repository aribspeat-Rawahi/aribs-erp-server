import { Injectable } from '@nestjs/common';
import { ExpenseService } from './expense.service';
import { InvoiceService } from '../invoice/invoice.service';
import { ReimbursementService } from '../reimbursement/reimbursement.service';
import { JournalEntryService } from '../journal/journal-entry.service';

@Injectable()
export class AccountingSummaryService {
  constructor(
    private expenseService: ExpenseService,
    private invoiceService: InvoiceService,
    // Read-only — a PAID reimbursement is real money out the door, same
    // as an Expense row, so it has to count against Net Profit too or
    // the dashboard silently understates how much was actually spent.
    // Kept as its own `reimbursements` field (not merged into `expenses`)
    // so Accounting.tsx's Expense category breakdown stays exactly what
    // Expense itself recorded.
    private reimbursementService: ReimbursementService,
    private journalEntryService: JournalEntryService,
  ) {}

  // Quick P&L for a date range.
  // Net Profit comes from the ledger (same as the Income Statement):
  // revenue net of VAT and discounts, minus EVERY expense account (cost of
  // goods sold, salaries, depreciation, accruals, expenses, reimbursements).
  // `ledger` carries those totals for the cards; `revenue`/`expenses`/
  // `reimbursements` stay as before (invoice count, the Expense records
  // themselves) for screens that list them.
  async getSummary(startDate: string, endDate: string) {
    const [revenue, expenses, reimbursements, income] = await Promise.all([
      this.invoiceService.getTotalsInRange(startDate, endDate),
      this.expenseService.getTotalInRange(startDate, endDate),
      this.reimbursementService.getPaidTotalInRange(startDate, endDate),
      this.journalEntryService.getIncomeStatement(startDate, endDate),
    ]);

    return {
      period: { startDate, endDate },
      revenue,
      expenses,
      reimbursements,
      ledger: {
        revenue: income.totalRevenue,
        expenses: income.totalExpense,
        netProfit: income.netProfit,
      },
      netProfit: income.netProfit,
    };
  }
}
