import { MigrationInterface, QueryRunner } from "typeorm";

export class FinanceTermsMatch1791614984996 implements MigrationInterface {
    name = 'FinanceTermsMatch1791614984996'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`suppliers\` ADD \`paymentTermsDays\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`goods_receipts\` ADD \`supplierInvoiceTotal\` decimal(12,3) NULL`);
        await queryRunner.query(`ALTER TABLE \`customers\` ADD \`paymentTermsDays\` int NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`customers\` DROP COLUMN \`paymentTermsDays\``);
        await queryRunner.query(`ALTER TABLE \`goods_receipts\` DROP COLUMN \`supplierInvoiceTotal\``);
        await queryRunner.query(`ALTER TABLE \`suppliers\` DROP COLUMN \`paymentTermsDays\``);
    }

}
