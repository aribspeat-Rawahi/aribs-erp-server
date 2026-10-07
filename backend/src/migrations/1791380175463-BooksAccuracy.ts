import { MigrationInterface, QueryRunner } from "typeorm";

export class BooksAccuracy1791380175463 implements MigrationInterface {
    name = 'BooksAccuracy1791380175463'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`purchase_orders\` ADD \`fixedAssetId\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`invoice_items\` ADD \`unitCost\` decimal(12,3) NULL`);
        await queryRunner.query(`ALTER TABLE \`fixed_assets\` ADD \`vatAmount\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
        await queryRunner.query(`ALTER TABLE \`fixed_assets\` ADD \`supplierId\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`fixed_assets\` ADD \`supplierInvoiceNumber\` varchar(100) NULL`);
        await queryRunner.query(`ALTER TABLE \`fixed_assets\` ADD \`purchaseOrderId\` varchar(36) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`fixed_assets\` DROP COLUMN \`purchaseOrderId\``);
        await queryRunner.query(`ALTER TABLE \`fixed_assets\` DROP COLUMN \`supplierInvoiceNumber\``);
        await queryRunner.query(`ALTER TABLE \`fixed_assets\` DROP COLUMN \`supplierId\``);
        await queryRunner.query(`ALTER TABLE \`fixed_assets\` DROP COLUMN \`vatAmount\``);
        await queryRunner.query(`ALTER TABLE \`invoice_items\` DROP COLUMN \`unitCost\``);
        await queryRunner.query(`ALTER TABLE \`purchase_orders\` DROP COLUMN \`fixedAssetId\``);
    }

}
