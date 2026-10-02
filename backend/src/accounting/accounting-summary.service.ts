import { Injectable } from '@nestjs/common';
import { ExpenseService } from './expense.service';
import { InvoiceService } from '../invoice/invoice.service';
import { ReimbursementService } from '../reimbursement/reimbursement.service';

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
  ) {}

  // A simple P&L view for a date range: revenue from issued invoices
  // minus recorded expenses minus paid reimbursements. Good enough for a
  // quick health check — a full accounting module (accounts payable/
  // receivable ledgers, balance sheet) can be layered on top of this
  // later if needed.
  async getSummary(startDate: string, endDate: string) {
    const revenue = await this.invoiceService.getTotalsInRange(startDate, endDate);
    const expenses = await this.expenseService.getTotalInRange(startDate, endDate);
    const reimbursements = await this.reimbursementService.getPaidTotalInRange(startDate, endDate);

    return {
      period: { startDate, endDate },
      revenue,
      expenses,
      reimbursements,
      netProfit: revenue.total - expenses.total - reimbursements.total,
    };
  }
}
