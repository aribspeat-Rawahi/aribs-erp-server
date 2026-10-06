import { MigrationInterface, QueryRunner } from "typeorm";

export class OpeningBalances1791296898339 implements MigrationInterface {
    name = 'OpeningBalances1791296898339'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`opening_balance_lines\` (\`id\` varchar(36) NOT NULL, \`kind\` varchar(20) NOT NULL, \`refId\` varchar(36) NOT NULL, \`documentNumber\` varchar(100) NULL, \`documentDate\` date NULL, \`dueDate\` date NULL, \`quantity\` decimal(12,3) NULL, \`unitCost\` decimal(12,3) NULL, \`amount\` decimal(14,3) NOT NULL DEFAULT '0.000', \`debit\` decimal(14,3) NOT NULL DEFAULT '0.000', \`credit\` decimal(14,3) NOT NULL DEFAULT '0.000', \`note\` varchar(255) NULL, \`postedRefId\` varchar(36) NULL, \`createdByEmail\` varchar(255) NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`IDX_a8ee0deaed8eedc671282bf6de\` (\`kind\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`purchase_orders\` ADD \`isOpening\` tinyint NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE \`purchase_orders\` ADD \`openingReference\` varchar(100) NULL`);
        await queryRunner.query(`ALTER TABLE \`purchase_orders\` ADD \`dueDate\` date NULL`);
        await queryRunner.query(`ALTER TABLE \`settings\` ADD \`openingBalanceDate\` date NULL`);
        await queryRunner.query(`ALTER TABLE \`settings\` ADD \`openingBalanceFinalizedAt\` datetime NULL`);
        await queryRunner.query(`ALTER TABLE \`settings\` ADD \`openingBalanceFinalizedBy\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`invoices\` ADD \`isOpening\` tinyint NOT NULL DEFAULT 0`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`invoices\` DROP COLUMN \`isOpening\``);
        await queryRunner.query(`ALTER TABLE \`settings\` DROP COLUMN \`openingBalanceFinalizedBy\``);
        await queryRunner.query(`ALTER TABLE \`settings\` DROP COLUMN \`openingBalanceFinalizedAt\``);
        await queryRunner.query(`ALTER TABLE \`settings\` DROP COLUMN \`openingBalanceDate\``);
        await queryRunner.query(`ALTER TABLE \`purchase_orders\` DROP COLUMN \`dueDate\``);
        await queryRunner.query(`ALTER TABLE \`purchase_orders\` DROP COLUMN \`openingReference\``);
        await queryRunner.query(`ALTER TABLE \`purchase_orders\` DROP COLUMN \`isOpening\``);
        await queryRunner.query(`DROP INDEX \`IDX_a8ee0deaed8eedc671282bf6de\` ON \`opening_balance_lines\``);
        await queryRunner.query(`DROP TABLE \`opening_balance_lines\``);
    }

}
