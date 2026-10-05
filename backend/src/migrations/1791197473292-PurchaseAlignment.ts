import { MigrationInterface, QueryRunner } from 'typeorm';

export class PurchaseAlignment1791197473292 implements MigrationInterface {
  name = 'PurchaseAlignment1791197473292';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`goods_receipt_items\` (\`id\` varchar(36) NOT NULL, \`goodsReceiptId\` varchar(36) NOT NULL, \`purchaseOrderItemId\` varchar(36) NOT NULL, \`rawMaterialId\` varchar(36) NOT NULL, \`quantity\` decimal(12,3) NOT NULL, \`unit\` varchar(10) NOT NULL DEFAULT 'pcs', \`costPerUnit\` decimal(12,3) NOT NULL, \`vatRate\` decimal(6,3) NOT NULL DEFAULT '5.000', \`lineTotal\` decimal(12,3) NOT NULL DEFAULT '0.000', PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`goods_receipts\` (\`id\` varchar(36) NOT NULL, \`sequenceNumber\` int NOT NULL AUTO_INCREMENT, \`grnNumber\` varchar(30) NOT NULL, \`purchaseOrderId\` varchar(36) NOT NULL, \`supplierId\` varchar(36) NOT NULL, \`receivedDate\` date NOT NULL, \`supplierInvoiceNumber\` varchar(60) NULL, \`supplierInvoiceDate\` date NULL, \`subtotal\` decimal(12,3) NOT NULL DEFAULT '0.000', \`vatAmount\` decimal(12,3) NOT NULL DEFAULT '0.000', \`total\` decimal(12,3) NOT NULL DEFAULT '0.000', \`note\` text NULL, \`createdByUserId\` varchar(36) NULL, \`createdByEmail\` varchar(255) NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_4c652d80e81ec74c6d14c61a6e\` (\`sequenceNumber\`), UNIQUE INDEX \`IDX_a4bea96567327d364aadf77859\` (\`grnNumber\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(`ALTER TABLE \`suppliers\` ADD \`vatin\` varchar(30) NULL`);
    await queryRunner.query(`ALTER TABLE \`suppliers\` ADD \`vatStatus\` enum ('registered', 'not_registered', 'foreign') NOT NULL DEFAULT 'registered'`);
    await queryRunner.query(`ALTER TABLE \`supplier_payments\` ADD \`creditSource\` varchar(30) NULL`);
    await queryRunner.query(`ALTER TABLE \`supplier_payments\` ADD \`creditSourceId\` varchar(36) NULL`);
    await queryRunner.query(`ALTER TABLE \`purchase_returns\` ADD \`appliedToOrder\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
    await queryRunner.query(`ALTER TABLE \`purchase_returns\` ADD \`refundAmount\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
    // AUTO_INCREMENT must be a key in the same statement (MySQL/MariaDB)
    await queryRunner.query(
      `ALTER TABLE \`purchase_orders\` ADD \`sequenceNumber\` int NOT NULL AUTO_INCREMENT, ADD UNIQUE INDEX \`IDX_77a3db7c48bb2b180047de0548\` (\`sequenceNumber\`)`,
    );
    // existing orders get PO numbers in the order they were created, then
    // the column becomes required + unique
    await queryRunner.query(`ALTER TABLE \`purchase_orders\` ADD \`poNumber\` varchar(30) NULL`);
    await queryRunner.query(
      `UPDATE \`purchase_orders\` p JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY createdAt, id) AS rn FROM \`purchase_orders\`) r ON r.id = p.id
       SET p.poNumber = CONCAT('PO-', YEAR(p.createdAt), '-', LPAD(r.rn, 4, '0'))`,
    );
    // new orders continue after the highest number already used
    await queryRunner.query(
      `UPDATE \`purchase_orders\` p JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY createdAt, id) AS rn FROM \`purchase_orders\`) r ON r.id = p.id
       SET p.sequenceNumber = r.rn + 1000000`,
    );
    await queryRunner.query(
      `UPDATE \`purchase_orders\` p JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY createdAt, id) AS rn FROM \`purchase_orders\`) r ON r.id = p.id
       SET p.sequenceNumber = r.rn`,
    );
    // counter back to (highest number + 1) after the renumbering above
    await queryRunner.query(`ALTER TABLE \`purchase_orders\` AUTO_INCREMENT = 1`);
    await queryRunner.query(`ALTER TABLE \`purchase_orders\` MODIFY \`poNumber\` varchar(30) NOT NULL`);
    await queryRunner.query(`ALTER TABLE \`purchase_orders\` ADD UNIQUE INDEX \`IDX_2e0fc7a6605393a9bd691cdceb\` (\`poNumber\`)`);
    await queryRunner.query(`ALTER TABLE \`purchase_orders\` ADD \`expectedDate\` date NULL`);
    await queryRunner.query(`ALTER TABLE \`purchase_orders\` ADD \`receivedSubtotal\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
    await queryRunner.query(`ALTER TABLE \`purchase_orders\` ADD \`receivedVat\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
    await queryRunner.query(`ALTER TABLE \`purchase_orders\` ADD \`receivedTotal\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
    await queryRunner.query(`ALTER TABLE \`purchase_orders\` ADD \`closedShort\` tinyint NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE \`purchase_order_items\` ADD \`receivedQuantity\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
    await queryRunner.query(`ALTER TABLE \`raw_material_batches\` ADD \`goodsReceiptId\` varchar(36) NULL`);
    await queryRunner.query(
      `ALTER TABLE \`purchase_orders\` CHANGE \`status\` \`status\` enum ('ordered', 'partially_received', 'received', 'cancelled') NOT NULL DEFAULT 'ordered'`,
    );
    // ---- data backfill ----
    // Orders already received (all at once, the old way) become one goods
    // receipt each, so every received order looks the same. Their journal
    // entry stays the one posted at the time (source 'purchase_order').
    await queryRunner.query(
      `UPDATE \`purchase_orders\` SET receivedSubtotal = COALESCE(subtotal, 0), receivedVat = COALESCE(vatAmount, 0), receivedTotal = COALESCE(total, 0) WHERE status = 'received'`,
    );
    await queryRunner.query(
      `UPDATE \`purchase_order_items\` i JOIN \`purchase_orders\` p ON p.id = i.purchaseOrderId SET i.receivedQuantity = i.quantity WHERE p.status = 'received'`,
    );
    await queryRunner.query(
      `INSERT INTO \`goods_receipts\` (id, grnNumber, purchaseOrderId, supplierId, receivedDate, subtotal, vatAmount, total, note, createdAt)
       SELECT UUID(), CONCAT('GRN-', YEAR(COALESCE(p.receivedAt, p.updatedAt)), '-', LPAD(ROW_NUMBER() OVER (ORDER BY COALESCE(p.receivedAt, p.updatedAt), p.id), 4, '0')),
              p.id, p.supplierId, DATE(COALESCE(p.receivedAt, p.updatedAt)), COALESCE(p.subtotal, 0), COALESCE(p.vatAmount, 0), COALESCE(p.total, 0),
              'Received before goods receipts existed', COALESCE(p.receivedAt, p.updatedAt)
       FROM \`purchase_orders\` p WHERE p.status = 'received'`,
    );
    await queryRunner.query(
      `INSERT INTO \`goods_receipt_items\` (id, goodsReceiptId, purchaseOrderItemId, rawMaterialId, quantity, unit, costPerUnit, vatRate, lineTotal)
       SELECT UUID(), g.id, i.id, i.rawMaterialId, i.quantity, i.unit, i.costPerUnit, i.vatRate, ROUND(i.quantity * i.costPerUnit, 3)
       FROM \`purchase_order_items\` i JOIN \`goods_receipts\` g ON g.purchaseOrderId = i.purchaseOrderId`,
    );
    await queryRunner.query(
      `UPDATE \`raw_material_batches\` b JOIN \`goods_receipts\` g ON g.purchaseOrderId = b.purchaseOrderId SET b.goodsReceiptId = g.id WHERE b.purchaseOrderId IS NOT NULL`,
    );
    // Vendor credits / prepayments already applied to an order lowered the
    // payable in the journal but not the order's balance: record them on
    // the order (no money moves, no new journal entry).
    await queryRunner.query(
      `INSERT INTO \`supplier_payments\` (id, purchaseOrderId, supplierId, amount, paymentDate, note, creditSource, creditSourceId, createdAt)
       SELECT UUID(), a.purchaseOrderId, p.supplierId, a.amount, a.date, CONCAT('Vendor credit ', c.creditNumber, ' applied'), 'vendor_credit', a.id, a.createdAt
       FROM \`vendor_credit_applications\` a JOIN \`vendor_credits\` c ON c.id = a.vendorCreditId JOIN \`purchase_orders\` p ON p.id = a.purchaseOrderId`,
    );
    await queryRunner.query(
      `INSERT INTO \`supplier_payments\` (id, purchaseOrderId, supplierId, amount, paymentDate, note, creditSource, creditSourceId, createdAt)
       SELECT UUID(), a.purchaseOrderId, p.supplierId, a.amount, a.date, CONCAT('Vendor prepayment ', v.prepaymentNumber, ' applied'), 'vendor_prepayment', a.id, a.createdAt
       FROM \`vendor_prepayment_applications\` a JOIN \`vendor_prepayments\` v ON v.id = a.vendorPrepaymentId JOIN \`purchase_orders\` p ON p.id = a.purchaseOrderId`,
    );
    await queryRunner.query(
      `UPDATE \`purchase_orders\` p JOIN (SELECT purchaseOrderId, SUM(amount) AS paid FROM \`supplier_payments\` GROUP BY purchaseOrderId) s ON s.purchaseOrderId = p.id
       SET p.paidAmount = ROUND(s.paid, 3),
           p.paymentStatus = CASE WHEN s.paid <= 0 THEN 'due' WHEN s.paid >= COALESCE(p.receivedTotal, 0) - 0.001 THEN 'paid' ELSE 'partial' END`,
    );

    await queryRunner.query(
      `ALTER TABLE \`goods_receipt_items\` ADD CONSTRAINT \`FK_d1c1d80926f6e0eedd7b1473635\` FOREIGN KEY (\`goodsReceiptId\`) REFERENCES \`goods_receipts\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`goods_receipt_items\` DROP FOREIGN KEY \`FK_d1c1d80926f6e0eedd7b1473635\``);
    await queryRunner.query(
      `ALTER TABLE \`purchase_orders\` CHANGE \`status\` \`status\` enum ('ordered', 'received', 'cancelled') NOT NULL DEFAULT 'ordered'`,
    );
    await queryRunner.query(`ALTER TABLE \`raw_material_batches\` DROP COLUMN \`goodsReceiptId\``);
    await queryRunner.query(`ALTER TABLE \`purchase_order_items\` DROP COLUMN \`receivedQuantity\``);
    await queryRunner.query(`ALTER TABLE \`purchase_orders\` DROP COLUMN \`closedShort\``);
    await queryRunner.query(`ALTER TABLE \`purchase_orders\` DROP COLUMN \`receivedTotal\``);
    await queryRunner.query(`ALTER TABLE \`purchase_orders\` DROP COLUMN \`receivedVat\``);
    await queryRunner.query(`ALTER TABLE \`purchase_orders\` DROP COLUMN \`receivedSubtotal\``);
    await queryRunner.query(`ALTER TABLE \`purchase_orders\` DROP COLUMN \`expectedDate\``);
    await queryRunner.query(`ALTER TABLE \`purchase_orders\` DROP INDEX \`IDX_2e0fc7a6605393a9bd691cdceb\``);
    await queryRunner.query(`ALTER TABLE \`purchase_orders\` DROP COLUMN \`poNumber\``);
    await queryRunner.query(`ALTER TABLE \`purchase_orders\` DROP INDEX \`IDX_77a3db7c48bb2b180047de0548\``);
    await queryRunner.query(`ALTER TABLE \`purchase_orders\` DROP COLUMN \`sequenceNumber\``);
    await queryRunner.query(`ALTER TABLE \`purchase_returns\` DROP COLUMN \`refundAmount\``);
    await queryRunner.query(`ALTER TABLE \`purchase_returns\` DROP COLUMN \`appliedToOrder\``);
    await queryRunner.query(`DELETE FROM \`supplier_payments\` WHERE creditSource IS NOT NULL`);
    await queryRunner.query(`ALTER TABLE \`supplier_payments\` DROP COLUMN \`creditSourceId\``);
    await queryRunner.query(`ALTER TABLE \`supplier_payments\` DROP COLUMN \`creditSource\``);
    await queryRunner.query(`ALTER TABLE \`suppliers\` DROP COLUMN \`vatStatus\``);
    await queryRunner.query(`ALTER TABLE \`suppliers\` DROP COLUMN \`vatin\``);
    await queryRunner.query(`DROP INDEX \`IDX_a4bea96567327d364aadf77859\` ON \`goods_receipts\``);
    await queryRunner.query(`DROP INDEX \`IDX_4c652d80e81ec74c6d14c61a6e\` ON \`goods_receipts\``);
    await queryRunner.query(`DROP TABLE \`goods_receipts\``);
    await queryRunner.query(`DROP TABLE \`goods_receipt_items\``);
  }
}
