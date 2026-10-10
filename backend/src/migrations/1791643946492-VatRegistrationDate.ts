import { MigrationInterface, QueryRunner } from "typeorm";

export class VatRegistrationDate1791643946492 implements MigrationInterface {
    name = 'VatRegistrationDate1791643946492'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`settings\` ADD \`vatRegisteredFrom\` date NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`settings\` DROP COLUMN \`vatRegisteredFrom\``);
    }

}
