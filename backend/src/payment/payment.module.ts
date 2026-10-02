import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { InvoicePayment } from '../invoice/invoice-payment.entity';
import { Invoice } from '../invoice/invoice.entity';
import { SupplierPayment } from '../supplier/supplier-payment.entity';
import { PurchaseOrder } from '../supplier/purchase-order.entity';
import { PayrollRecord } from '../hr/payroll.entity';
import { Reimbursement } from '../reimbursement/reimbursement.entity';
import { TaxPayment } from '../tax/tax-payment.entity';
import { FundTransfer } from '../bank-account/fund-transfer.entity';
import { Customer } from '../customer/customer.entity';
import { Supplier } from '../supplier/supplier.entity';
import { Employee } from '../hr/employee.entity';
import { BankAccount } from '../bank-account/bank-account.entity';
import { SalaryAdvanceRequest } from '../hr/salary-advance.entity';

// Read-only aggregation module — only TypeORM entities are imported here
// (no other module's *Module*/*Service*), same "depend only on entities"
// convention ApprovalModule uses, so this can be imported anywhere later
// without any circular-dependency risk.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      InvoicePayment,
      Invoice,
      SupplierPayment,
      PurchaseOrder,
      PayrollRecord,
      Reimbursement,
      TaxPayment,
      FundTransfer,
      Customer,
      Supplier,
      Employee,
      BankAccount,
      SalaryAdvanceRequest,
    ]),
  ],
  providers: [PaymentService],
  controllers: [PaymentController],
})
export class PaymentModule {}
