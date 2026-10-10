import { MigrationInterface, QueryRunner } from "typeorm";

export class AssetSaleVendorCreditVat1791615888404 implements MigrationInterface {
    name = 'AssetSaleVendorCreditVat1791615888404'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`vendor_credits\` ADD \`vatAmount\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
        await queryRunner.query(`ALTER TABLE \`vendor_credits\` ADD \`supplierCreditNoteNumber\` varchar(100) NULL`);
        await queryRunner.query(`ALTER TABLE \`fixed_assets\` ADD \`disposalVat\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
        await queryRunner.query(`ALTER TABLE \`fixed_assets\` ADD \`disposalBuyer\` varchar(200) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`fixed_assets\` DROP COLUMN \`disposalBuyer\``);
        await queryRunner.query(`ALTER TABLE \`fixed_assets\` DROP COLUMN \`disposalVat\``);
        await queryRunner.query(`ALTER TABLE \`vendor_credits\` DROP COLUMN \`supplierCreditNoteNumber\``);
        await queryRunner.query(`ALTER TABLE \`vendor_credits\` DROP COLUMN \`vatAmount\``);
    }

}
