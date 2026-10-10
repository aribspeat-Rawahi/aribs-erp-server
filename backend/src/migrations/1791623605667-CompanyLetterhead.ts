import { MigrationInterface, QueryRunner } from "typeorm";

export class CompanyLetterhead1791623605667 implements MigrationInterface {
    name = 'CompanyLetterhead1791623605667'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`settings\` ADD \`companyNameArabic\` varchar(200) NULL`);
        await queryRunner.query(`ALTER TABLE \`settings\` ADD \`companyCrNumber\` varchar(40) NULL`);
        await queryRunner.query(`ALTER TABLE \`settings\` ADD \`companyEmail\` varchar(120) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`settings\` DROP COLUMN \`companyEmail\``);
        await queryRunner.query(`ALTER TABLE \`settings\` DROP COLUMN \`companyCrNumber\``);
        await queryRunner.query(`ALTER TABLE \`settings\` DROP COLUMN \`companyNameArabic\``);
    }

}
