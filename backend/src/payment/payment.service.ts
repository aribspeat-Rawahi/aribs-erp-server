import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { InvoicePayment } from '../invoice/invoice-payment.entity';
import { Invoice } from '../invoice/invoice.entity';
import { SupplierPayment } from '../supplier/supplier-payment.entity';
import { PurchaseOrder } from '../supplier/purchase-order.entity';
import { PayrollRecord } from '../hr/payroll.entity';
import { Reimbursement, ReimbursementStatus } from '../reimbursement/reimbursement.entity';
import { TaxPayment } from '../tax/tax-payment.entity';
import { FundTransfer } from '../bank-account/fund-transfer.entity';
import { Customer } from '../customer/customer.entity';
import { Supplier } from '../supplier/supplier.entity';
import { Employee } from '../hr/employee.entity';
import { BankAccount } from '../bank-account/bank-account.entity';
import { PaymentStatus } from '../common/payment-type.enum';
import { SalaryAdvanceRequest, SalaryAdvanceStatus } from '../hr/salary-advance.entity';
import { omanDate } from '../common/oman-date';

export type PaymentRowType =
  | 'invoice_payment'
  | 'supplier_payment'
  | 'payroll'
  | 'reimbursement'
  | 'tax_payment'
  | 'fund_transfer';

export interface CombinedPaymentRow {
  id: string;
  type: PaymentRowType;
  direction: 'in' | 'out' | 'internal';
  date: string;
  partyName: string;
  reference?: string;
  amount: number;
  method: string;
  note?: string;
}

export type PendingRowType =
  | 'invoice_due'
  | 'supplier_bill_due'
  | 'payroll_unpaid'
  | 'reimbursement_pending'
  | 'salary_advance_pending';

export interface PendingPaymentRow {
  id: string;
  type: PendingRowType;
  direction: 'in' | 'out';
  // For a request still awaiting a decision (reimbursement claim not yet
  // approved/rejected, or a salary advance not yet approved), as opposed
  // to something already approved/due but just not paid out yet.
  awaitingApproval: boolean;
  date: string;
  partyName: string;
  reference?: string;
  amount: number;
  note?: string;
}

const TOLERANCE = 0.001;

// Read-only aggregation across every payment-like record already in the
// system, purely additive: this service never writes anywhere and every
// existing page/entity keeps behaving exactly as before. It only reads
// via plain repos (no other module's *Service* is injected), so there is
// no circular-dependency risk importing this module anywhere else.
@Injectable()
export class PaymentService {
  constructor(
    @InjectRepository(InvoicePayment) private invoicePaymentRepo: Repository<InvoicePayment>,
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
    @InjectRepository(SupplierPayment) private supplierPaymentRepo: Repository<SupplierPayment>,
    @InjectRepository(PurchaseOrder) private purchaseOrderRepo: Repository<PurchaseOrder>,
    @InjectRepository(PayrollRecord) private payrollRepo: Repository<PayrollRecord>,
    @InjectRepository(Reimbursement) private reimbursementRepo: Repository<Reimbursement>,
    @InjectRepository(TaxPayment) private taxPaymentRepo: Repository<TaxPayment>,
    @InjectRepository(FundTransfer) private fundTransferRepo: Repository<FundTransfer>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(Supplier) private supplierRepo: Repository<Supplier>,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
    @InjectRepository(BankAccount) private bankAccountRepo: Repository<BankAccount>,
    @InjectRepository(SalaryAdvanceRequest) private salaryAdvanceRepo: Repository<SalaryAdvanceRequest>,
  ) {}

  async findAll(): Promise<CombinedPaymentRow[]> {
    const [
      invoicePayments,
      supplierPayments,
      payrollPaid,
      reimbursementsPaid,
      taxPayments,
      fundTransfers,
      invoices,
      purchaseOrders,
      customers,
      suppliers,
      employees,
      bankAccounts,
    ] = await Promise.all([
      // credit notes from sales returns are not money received
      this.invoicePaymentRepo.find({ where: { salesReturnId: IsNull() }, order: { paymentDate: 'DESC' } }),
      // credits (debit notes, vendor credits/prepayments applied) are not money paid
      this.supplierPaymentRepo.find({ where: { creditSource: IsNull() }, order: { paymentDate: 'DESC' } }),
      this.payrollRepo.find({ where: { isPaid: true } }),
      this.reimbursementRepo.find({ where: { status: ReimbursementStatus.PAID } }),
      this.taxPaymentRepo.find({ order: { datePaid: 'DESC' } }),
      this.fundTransferRepo.find({ order: { date: 'DESC' } }),
      this.invoiceRepo.find(),
      this.purchaseOrderRepo.find(),
      this.customerRepo.find(),
      this.supplierRepo.find(),
      this.employeeRepo.find(),
      this.bankAccountRepo.find(),
    ]);

    const invoiceById = new Map(invoices.map((i) => [i.id, i]));
    const purchaseOrderById = new Map(purchaseOrders.map((o) => [o.id, o]));
    const customerNameById = new Map(customers.map((c) => [c.id, c.name]));
    const supplierNameById = new Map(suppliers.map((s) => [s.id, s.name]));
    const employeeNameById = new Map(employees.map((e) => [e.id, e.name]));
    const bankAccountNameById = new Map(bankAccounts.map((b) => [b.id, b.name]));

    const methodFor = (bankAccountId?: string) =>
      bankAccountId ? bankAccountNameById.get(bankAccountId) || 'Bank/Cash' : 'Record only';

    const rows: CombinedPaymentRow[] = [];

    for (const p of invoicePayments) {
      const invoice = invoiceById.get(p.invoiceId);
      rows.push({
        id: p.id,
        type: 'invoice_payment',
        direction: 'in',
        date: p.paymentDate,
        partyName: (invoice && customerNameById.get(invoice.customerId)) || 'Unknown customer',
        reference: invoice?.invoiceNumber,
        amount: Number(p.amount),
        method: methodFor(p.bankAccountId),
        note: p.note,
      });
    }

    for (const p of supplierPayments) {
      const order = purchaseOrderById.get(p.purchaseOrderId);
      rows.push({
        id: p.id,
        type: 'supplier_payment',
        direction: 'out',
        date: p.paymentDate,
        partyName: supplierNameById.get(p.supplierId) || 'Unknown supplier',
        reference: order?.poNumber,
        amount: Number(p.amount),
        method: methodFor(p.bankAccountId),
        note: p.note,
      });
    }

    for (const r of payrollPaid) {
      rows.push({
        id: r.id,
        type: 'payroll',
        direction: 'out',
        date: r.paidDate,
        partyName: r.staffName,
        reference: `${r.periodFrom} → ${r.periodTo}`,
        amount: Number(r.calculatedSalary),
        method: methodFor(r.bankAccountId),
      });
    }

    for (const r of reimbursementsPaid) {
      rows.push({
        id: r.id,
        type: 'reimbursement',
        direction: 'out',
        date: r.paidAt ? omanDate(r.paidAt) : '',
        partyName: employeeNameById.get(r.employeeId) || 'Unknown employee',
        reference: r.claimNumber,
        amount: Number(r.amount),
        method: r.bankAccountId ? methodFor(r.bankAccountId) : r.paymentMethod || 'Record only',
        note: r.paymentNote,
      });
    }

    for (const t of taxPayments) {
      rows.push({
        id: t.id,
        type: 'tax_payment',
        direction: 'out',
        date: t.datePaid,
        partyName: 'Tax Authority',
        reference: `${t.paymentNumber} · ${t.period}`,
        amount: Number(t.amount),
        method: methodFor(t.bankAccountId),
        note: t.note,
      });
    }

    for (const f of fundTransfers) {
      rows.push({
        id: f.id,
        type: 'fund_transfer',
        direction: 'internal',
        date: f.date,
        partyName: `${bankAccountNameById.get(f.fromAccountId) || 'Unknown'} → ${bankAccountNameById.get(f.toAccountId) || 'Unknown'}`,
        reference: f.transferNumber,
        amount: Number(f.amount),
        method: 'Internal transfer',
        note: f.note,
      });
    }

    rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return rows;
  }

  // Everything owed or waiting that hasn't actually moved yet — the
  // "opposite" list to findAll()'s already-recorded payments. Covers both
  // an outstanding due amount (invoice/supplier bill not fully paid,
  // payroll not yet marked paid) and a request still in the queue
  // (reimbursement claim or salary advance awaiting a decision/payout).
  async findPending(): Promise<PendingPaymentRow[]> {
    const [invoices, purchaseOrders, payrollUnpaid, reimbursementsOpen, salaryAdvancesOpen, customers, suppliers, employees] =
      await Promise.all([
        this.invoiceRepo.find({ where: [{ paymentStatus: PaymentStatus.DUE }, { paymentStatus: PaymentStatus.PARTIAL }] }),
        this.purchaseOrderRepo.find({
          where: [{ paymentStatus: PaymentStatus.DUE }, { paymentStatus: PaymentStatus.PARTIAL }],
        }),
        this.payrollRepo.find({ where: { isPaid: false } }),
        this.reimbursementRepo.find({
          where: [{ status: ReimbursementStatus.PENDING }, { status: ReimbursementStatus.APPROVED }],
        }),
        this.salaryAdvanceRepo.find(),
        this.customerRepo.find(),
        this.supplierRepo.find(),
        this.employeeRepo.find(),
      ]);

    const customerNameById = new Map(customers.map((c) => [c.id, c.name]));
    const supplierNameById = new Map(suppliers.map((s) => [s.id, s.name]));
    const employeeNameById = new Map(employees.map((e) => [e.id, e.name]));

    const rows: PendingPaymentRow[] = [];

    for (const inv of invoices) {
      const due = Number(inv.total) - Number(inv.paidAmount || 0);
      if (due <= TOLERANCE) continue;
      rows.push({
        id: inv.id,
        type: 'invoice_due',
        direction: 'in',
        awaitingApproval: false,
        date: inv.dueDate || inv.issueDate,
        partyName: customerNameById.get(inv.customerId) || 'Unknown customer',
        reference: inv.invoiceNumber,
        amount: due,
      });
    }

    for (const po of purchaseOrders) {
      // owed = value of the goods received so far
      const due = Number(po.receivedTotal || 0) - Number(po.paidAmount || 0);
      if (due <= TOLERANCE) continue;
      rows.push({
        id: po.id,
        type: 'supplier_bill_due',
        direction: 'out',
        awaitingApproval: false,
        date: (po.receivedAt ? omanDate(po.receivedAt) : '') || '',
        partyName: supplierNameById.get(po.supplierId) || 'Unknown supplier',
        reference: po.poNumber,
        amount: due,
      });
    }

    for (const r of payrollUnpaid) {
      rows.push({
        id: r.id,
        type: 'payroll_unpaid',
        direction: 'out',
        awaitingApproval: false,
        date: r.periodTo,
        partyName: r.staffName,
        reference: `${r.periodFrom} → ${r.periodTo}`,
        amount: Number(r.calculatedSalary),
      });
    }

    for (const r of reimbursementsOpen) {
      rows.push({
        id: r.id,
        type: 'reimbursement_pending',
        direction: 'out',
        awaitingApproval: r.status === ReimbursementStatus.PENDING,
        date: r.date,
        partyName: employeeNameById.get(r.employeeId) || 'Unknown employee',
        reference: r.claimNumber,
        amount: Number(r.amount),
        note: r.status === ReimbursementStatus.PENDING ? 'Awaiting approval' : 'Approved — awaiting payout',
      });
    }

    for (const a of salaryAdvancesOpen) {
      if (a.status === SalaryAdvanceStatus.REJECTED) continue;
      if (a.status === SalaryAdvanceStatus.APPROVED && a.disbursed) continue;
      rows.push({
        id: a.id,
        type: 'salary_advance_pending',
        direction: 'out',
        awaitingApproval: a.status === SalaryAdvanceStatus.PENDING,
        date: a.createdAt ? omanDate(a.createdAt) : '',
        partyName: a.employeeName,
        reference: a.reason,
        amount: Number(a.amount),
        note: a.status === SalaryAdvanceStatus.PENDING ? 'Awaiting approval' : 'Approved — awaiting disbursement',
      });
    }

    rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return rows;
  }
}
