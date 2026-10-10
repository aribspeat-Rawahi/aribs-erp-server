import { MigrationInterface, QueryRunner } from "typeorm";

export class CompanyAddressFields1791644676653 implements MigrationInterface {
    name = 'CompanyAddressFields1791644676653'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`settings\` ADD \`companyPoBox\` varchar(20) NULL`);
        await queryRunner.query(`ALTER TABLE \`settings\` ADD \`companyPostalCode\` varchar(10) NULL`);
        await queryRunner.query(`ALTER TABLE \`settings\` ADD \`companyCity\` varchar(80) NULL`);
        await queryRunner.query(`ALTER TABLE \`settings\` ADD \`companyCityArabic\` varchar(80) NULL`);
        await queryRunner.query(`ALTER TABLE \`settings\` ADD \`companyGsm\` varchar(30) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`settings\` DROP COLUMN \`companyGsm\``);
        await queryRunner.query(`ALTER TABLE \`settings\` DROP COLUMN \`companyCityArabic\``);
        await queryRunner.query(`ALTER TABLE \`settings\` DROP COLUMN \`companyCity\``);
        await queryRunner.query(`ALTER TABLE \`settings\` DROP COLUMN \`companyPostalCode\``);
        await queryRunner.query(`ALTER TABLE \`settings\` DROP COLUMN \`companyPoBox\``);
    }

}
