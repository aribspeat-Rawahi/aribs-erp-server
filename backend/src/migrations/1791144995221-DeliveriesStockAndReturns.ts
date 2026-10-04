import { MigrationInterface, QueryRunner } from "typeorm";

export class DeliveriesStockAndReturns1791144995221 implements MigrationInterface {
    name = 'DeliveriesStockAndReturns1791144995221'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`sales_batch_consumptions\` ADD \`invoiceId\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`sales_returns\` ADD \`appliedToInvoice\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
        await queryRunner.query(`ALTER TABLE \`sales_returns\` ADD \`refundAmount\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
        await queryRunner.query(`ALTER TABLE \`invoices\` ADD \`deliveryStatus\` varchar(20) NOT NULL DEFAULT 'pending'`);
        await queryRunner.query(`ALTER TABLE \`invoices\` ADD \`deliveredAt\` datetime NULL`);
        await queryRunner.query(`ALTER TABLE \`invoices\` ADD \`deliveredVia\` varchar(20) NULL`);
        await queryRunner.query(`ALTER TABLE \`invoices\` ADD \`waitingForStock\` tinyint NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE \`invoices\` ADD \`stockReadyAt\` datetime NULL`);
        await queryRunner.query(`ALTER TABLE \`invoices\` ADD \`cogsAmount\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
        await queryRunner.query(`ALTER TABLE \`invoice_payments\` ADD \`salesReturnId\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`invoice_items\` ADD \`shortQuantity\` decimal(12,3) NOT NULL DEFAULT '0.000'`);

        // --- Data: delivery status of existing invoices ---------------------
        // "In Store" sales: the customer took the goods at the counter.
        await queryRunner.query(
            `UPDATE \`invoices\` SET \`deliveryStatus\` = 'delivered', \`deliveredVia\` = 'in_store', \`deliveredAt\` = \`createdAt\` WHERE \`deliveryMethod\` = 'in_store'`,
        );
        // Invoices whose delivery note was already delivered.
        await queryRunner.query(
            `UPDATE \`invoices\` i JOIN \`delivery_notes\` d ON d.\`invoiceNumber\` = i.\`invoiceNumber\` AND d.\`status\` = 'delivered'
             SET i.\`deliveryStatus\` = 'delivered', i.\`deliveredVia\` = 'delivery_note', i.\`deliveredAt\` = d.\`updatedAt\`
             WHERE i.\`deliveryStatus\` = 'pending'`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`invoice_items\` DROP COLUMN \`shortQuantity\``);
        await queryRunner.query(`ALTER TABLE \`invoice_payments\` DROP COLUMN \`salesReturnId\``);
        await queryRunner.query(`ALTER TABLE \`invoices\` DROP COLUMN \`cogsAmount\``);
        await queryRunner.query(`ALTER TABLE \`invoices\` DROP COLUMN \`stockReadyAt\``);
        await queryRunner.query(`ALTER TABLE \`invoices\` DROP COLUMN \`waitingForStock\``);
        await queryRunner.query(`ALTER TABLE \`invoices\` DROP COLUMN \`deliveredVia\``);
        await queryRunner.query(`ALTER TABLE \`invoices\` DROP COLUMN \`deliveredAt\``);
        await queryRunner.query(`ALTER TABLE \`invoices\` DROP COLUMN \`deliveryStatus\``);
        await queryRunner.query(`ALTER TABLE \`sales_returns\` DROP COLUMN \`refundAmount\``);
        await queryRunner.query(`ALTER TABLE \`sales_returns\` DROP COLUMN \`appliedToInvoice\``);
        await queryRunner.query(`ALTER TABLE \`sales_batch_consumptions\` DROP COLUMN \`invoiceId\``);
    }

}
