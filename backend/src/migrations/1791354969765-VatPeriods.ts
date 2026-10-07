import { MigrationInterface, QueryRunner } from "typeorm";

export class VatPeriods1791354969765 implements MigrationInterface {
    name = 'VatPeriods1791354969765'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`vat_periods\` (\`id\` varchar(36) NOT NULL, \`label\` varchar(40) NOT NULL, \`startDate\` date NOT NULL, \`endDate\` date NOT NULL, \`status\` varchar(20) NOT NULL DEFAULT 'filed', \`otaReference\` varchar(100) NULL, \`taxableSales\` decimal(14,3) NOT NULL DEFAULT '0.000', \`outputVat\` decimal(14,3) NOT NULL DEFAULT '0.000', \`taxablePurchases\` decimal(14,3) NOT NULL DEFAULT '0.000', \`inputVat\` decimal(14,3) NOT NULL DEFAULT '0.000', \`netVat\` decimal(14,3) NOT NULL DEFAULT '0.000', \`purchaseRowsMissingDocuments\` int NOT NULL DEFAULT '0', \`note\` text NULL, \`filedAt\` datetime NOT NULL, \`filedBy\` varchar(255) NULL, \`reopenedAt\` datetime NULL, \`reopenedBy\` varchar(255) NULL, \`reopenReason\` text NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`IDX_747082c38d9e0996f695f1b915\` (\`status\`, \`endDate\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`settings\` ADD \`vatPeriodMonths\` int NOT NULL DEFAULT '3'`);
        await queryRunner.query(`ALTER TABLE \`settings\` ADD \`vatPeriodStartMonth\` int NOT NULL DEFAULT '1'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`settings\` DROP COLUMN \`vatPeriodStartMonth\``);
        await queryRunner.query(`ALTER TABLE \`settings\` DROP COLUMN \`vatPeriodMonths\``);
        await queryRunner.query(`DROP INDEX \`IDX_747082c38d9e0996f695f1b915\` ON \`vat_periods\``);
        await queryRunner.query(`DROP TABLE \`vat_periods\``);
    }

}
