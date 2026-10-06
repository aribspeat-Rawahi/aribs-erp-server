import { MigrationInterface, QueryRunner } from 'typeorm';

// Indexes on the columns lists and reports filter by (customer, supplier,
// bank account, parent document, dates). Each one is skipped if it already
// exists, so a half-finished run can simply run again (MariaDB/MySQL DDL is
// not transactional).
const INDEXES: [name: string, table: string, columns: string[]][] = [
  ['IDX_8eb87cc43938f52a7b8bd7260a', 'vendor_prepayment_applications', ['purchaseOrderId']],
  ['IDX_718db24cec00261620ba2952cb', 'vendor_prepayments', ['supplierId']],
  ['IDX_e90fe814e40eb93a976b367f18', 'vendor_credit_applications', ['purchaseOrderId']],
  ['IDX_f2258f7ba1b99677031047a6a1', 'vendor_credits', ['supplierId']],
  ['IDX_30ee2995b56afde0b4576c54d3', 'supplier_payments', ['paymentDate']],
  ['IDX_a9606c250851fd546b0669925a', 'supplier_payments', ['supplierId']],
  ['IDX_08b3c78015e85a681f901deb01', 'supplier_payments', ['purchaseOrderId']],
  ['IDX_a8aaa08b873d980608bcc5911b', 'supplier_interactions', ['supplierId']],
  ['IDX_3451fd3eee291a6a5b052e1647', 'supplier_documents', ['supplierId']],
  ['IDX_9c9bc8268b30691559bbd7af0a', 'supplier_bank_accounts', ['supplierId']],
  ['IDX_ee25c88f01ed0317939b126365', 'purchase_returns', ['date']],
  ['IDX_aa8b739c9ec5c7ad25d7e5c047', 'purchase_returns', ['supplierId']],
  ['IDX_0ff85a965f1f94f35f1596866f', 'purchase_returns', ['purchaseOrderId']],
  ['IDX_0c3ff892a9f2ed16f59d31ccca', 'purchase_orders', ['supplierId']],
  ['IDX_1de7eb246940b05765d2c99a7e', 'purchase_order_items', ['purchaseOrderId']],
  ['IDX_e4c642fab30eaed40927b575e4', 'goods_receipts', ['receivedDate']],
  ['IDX_2049f016486fe12ac0a3071db4', 'goods_receipts', ['supplierId']],
  ['IDX_edf0f2be9e5b2d67313461ac11', 'goods_receipts', ['purchaseOrderId']],
  ['IDX_9978ca165b4c0f27571f3d1d92', 'sales_orders', ['customerId']],
  ['IDX_6b67146a69ed5fe5fe7f3224d3', 'sales_order_items', ['salesOrderId']],
  ['IDX_454807194d03e25caa79589e3f', 'sales_batch_consumptions', ['finishedGoodBatchId']],
  ['IDX_829df34f11ecbee6da94fb4904', 'sales_batch_consumptions', ['salesOrderId']],
  ['IDX_dbcaa883c37cdf56fced9d2283', 'sales_batch_consumptions', ['invoiceId']],
  ['IDX_2217782139e014e19a766d9b63', 'recurring_invoices', ['customerId']],
  ['IDX_116e4084cf9a95beea7e502ac0', 'quotations', ['customerId']],
  ['IDX_daed37b90fdb61300eabb8e274', 'quotation_items', ['quotationId']],
  ['IDX_9dbdc7f3185c54c0c04276f97e', 'production_orders', ['finishedGoodId']],
  ['IDX_745c9e073d799352ec5896bea2', 'production_batch_consumptions', ['rawMaterialBatchId']],
  ['IDX_ea9a4288cfd2dfb40923271439', 'production_batch_consumptions', ['productionOrderId']],
  ['IDX_5eaaa6a4a2c11fdb4fb39150a7', 'bill_of_materials', ['finishedGoodId']],
  ['IDX_34d5d6a407b7724da2e2766b15', 'journal_entry_lines', ['accountId']],
  ['IDX_22d810838dbee7bb8f098b347c', 'journal_entries', ['sourceId']],
  ['IDX_a60ea60964189a5a56f07dc8dc', 'journal_entries', ['date']],
  ['IDX_7130332252c6d6702f41690044', 'sales_returns', ['date']],
  ['IDX_1b15b03e110e350b14c9a08659', 'sales_returns', ['invoiceId']],
  ['IDX_923abe9769efff15d475733bee', 'sales_returns', ['customerId']],
  ['IDX_8927499592cf39c177c4639976', 'invoices', ['salesOrderId']],
  ['IDX_1df049f8943c6be0c1115541ef', 'invoices', ['customerId']],
  ['IDX_2673fbd032fd36fefa99a7c7dd', 'invoice_payments', ['paymentDate']],
  ['IDX_3b2a25d4269ebe9d7ca0c1001d', 'invoice_payments', ['invoiceId']],
  ['IDX_7fb6895fc8fad9f5200e91abb5', 'invoice_items', ['invoiceId']],
  ['IDX_5971a8156d1319018bffaaeb84', 'raw_materials', ['supplierId']],
  ['IDX_747bbf7a2e7e5318ac66a6d88a', 'raw_material_batches', ['purchaseOrderId']],
  ['IDX_b125922b13950231e19466f726', 'raw_material_batches', ['rawMaterialId']],
  ['IDX_d246d607188f735d06b692517d', 'finished_good_batches', ['finishedGoodId']],
  ['IDX_0cc05d869b4ddd79c6996b35bd', 'hr_payroll', ['employeeId']],
  ['IDX_efea079f7b973d0bba97385bab', 'payroll_documents', ['payrollId']],
  ['IDX_1e0b96137e88ec3ab8f14709f7', 'employee_documents', ['employeeId']],
  ['IDX_22624a7cd14d0f97d0bff5fb7b', 'attendance_records', ['employeeId', 'date']],
  ['IDX_f5c9dbf55d00344cb4593071d2', 'delivery_notes', ['customerId']],
  ['IDX_35b0ed2c835914cd6d21cfcfc6', 'delivery_note_items', ['deliveryNoteId']],
  ['IDX_7e61ab581cc7e551da66202618', 'customer_interactions', ['customerId']],
  ['IDX_831b9575ae0e77515c9751feeb', 'customer_documents', ['customerId']],
  ['IDX_06b2c2eb1bf1b4efaf4d508ec7', 'customer_bank_accounts', ['customerId']],
  ['IDX_4a7a456c0c8e90072b3b61091e', 'bank_transactions', ['bankAccountId', 'date']],
  ['IDX_40474ff19c594757c811a1343c', 'approval_requests', ['status']],
  ['IDX_95355d75c728050aae956cf016', 'activity_logs', ['createdAt']],
  ['IDX_280137355ed0f561f9aee0ac2c', 'expenses', ['date']],
];

async function indexExists(q: QueryRunner, table: string, name: string): Promise<boolean> {
  const rows = await q.query(
    'SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1',
    [table, name],
  );
  return rows.length > 0;
}

export class PerformanceIndexes1791267439752 implements MigrationInterface {
  name = 'PerformanceIndexes1791267439752';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [name, table, columns] of INDEXES) {
      if (await indexExists(queryRunner, table, name)) continue;
      await queryRunner.query(`CREATE INDEX \`${name}\` ON \`${table}\` (${columns.map((c) => `\`${c}\``).join(', ')})`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [name, table] of [...INDEXES].reverse()) {
      if (!(await indexExists(queryRunner, table, name))) continue;
      await queryRunner.query(`DROP INDEX \`${name}\` ON \`${table}\``);
    }
  }
}
