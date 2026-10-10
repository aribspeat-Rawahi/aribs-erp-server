import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from './supplier.entity';
import { SupplierBankAccount } from './supplier-bank-account.entity';
import { SupplierDocument } from './supplier-document.entity';
import { SupplierInteraction } from './supplier-interaction.entity';
import { PurchaseOrder } from './purchase-order.entity';
import { PurchaseOrderItem } from './purchase-order-item.entity';
import { PurchaseReturn } from './purchase-return.entity';
import { PurchaseReturnItem } from './purchase-return-item.entity';
import { VendorPrepayment } from './vendor-prepayment.entity';
import { VendorPrepaymentApplication } from './vendor-prepayment-application.entity';
import { VendorCredit } from './vendor-credit.entity';
import { VendorCreditApplication } from './vendor-credit-application.entity';
import { VendorCreditRefund } from './vendor-credit-refund.entity';
import { SupplierPayment } from './supplier-payment.entity';
import { GoodsReceipt } from './goods-receipt.entity';
import { GoodsReceiptItem } from './goods-receipt-item.entity';
import { SupplierService } from './supplier.service';
import { SupplierBankAccountService } from './supplier-bank-account.service';
import { SupplierDocumentService } from './supplier-document.service';
import { SupplierInteractionService } from './supplier-interaction.service';
import { PurchaseOrderService } from './purchase-order.service';
import { PurchaseReturnService } from './purchase-return.service';
import { VendorPrepaymentService } from './vendor-prepayment.service';
import { VendorCreditService } from './vendor-credit.service';
import { SupplierPaymentService } from './supplier-payment.service';
import { PurchaseReturnController } from './purchase-return.controller';
import { VendorPrepaymentController } from './vendor-prepayment.controller';
import { VendorCreditController } from './vendor-credit.controller';
import { SupplierPaymentController } from './supplier-payment.controller';
import { SupplierController } from './supplier.controller';
import { SupplierBankAccountController } from './supplier-bank-account.controller';
import { SupplierDocumentController } from './supplier-document.controller';
import { SupplierInteractionController } from './supplier-interaction.controller';
import { PurchaseOrderController } from './purchase-order.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { EmailService } from '../common/email.service';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { JournalModule } from '../journal/journal.module';
import { BankAccountModule } from '../bank-account/bank-account.module';
import { SettingsModule } from '../settings/settings.module';
import { DocumentApprovalModule } from '../document-approval/document-approval.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Supplier,
      SupplierBankAccount,
      SupplierDocument,
      SupplierInteraction,
      PurchaseOrder,
      PurchaseOrderItem,
      PurchaseReturn,
      PurchaseReturnItem,
      VendorPrepayment,
      VendorPrepaymentApplication,
      VendorCredit,
      VendorCreditApplication,
      VendorCreditRefund,
      SupplierPayment,
      GoodsReceipt,
      GoodsReceiptItem,
    ]),
    InventoryModule, // gives us RawMaterialService
    ActivityLogModule,
    JournalModule,
    BankAccountModule,
    SettingsModule,
    DocumentApprovalModule,
  ],
  controllers: [
    SupplierController,
    SupplierBankAccountController,
    SupplierDocumentController,
    SupplierInteractionController,
    PurchaseOrderController,
    PurchaseReturnController,
    VendorPrepaymentController,
    VendorCreditController,
    SupplierPaymentController,
  ],
  providers: [
    SupplierService,
    SupplierBankAccountService,
    SupplierDocumentService,
    SupplierInteractionService,
    PurchaseOrderService,
    PurchaseReturnService,
    VendorPrepaymentService,
    VendorCreditService,
    SupplierPaymentService,
    EmailService,
  ],
  exports: [SupplierService, PurchaseOrderService, PurchaseReturnService, VendorPrepaymentService, VendorCreditService, SupplierPaymentService],
})
export class SupplierModule {}
