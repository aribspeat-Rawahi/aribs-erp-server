import { MigrationInterface, QueryRunner } from "typeorm";

export class BankReconciliation1791507244374 implements MigrationInterface {
    name = 'BankReconciliation1791507244374'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`bank_reconciliations\` (\`id\` varchar(36) NOT NULL, \`bankAccountId\` varchar(36) NOT NULL, \`statementDate\` date NOT NULL, \`statementBalance\` decimal(14,3) NOT NULL, \`openingBalance\` decimal(14,3) NOT NULL, \`bookBalance\` decimal(14,3) NOT NULL, \`items\` longtext NOT NULL, \`createdByEmail\` varchar(255) NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`IDX_248003e6de89bccddc7805f6e4\` (\`bankAccountId\`, \`statementDate\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`bank_transactions\` ADD \`reconciliationId\` varchar(36) NULL`);
        await queryRunner.query(`CREATE INDEX \`IDX_e2e9136ac27e1a693f3d18fe76\` ON \`bank_transactions\` (\`reconciliationId\`)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`IDX_e2e9136ac27e1a693f3d18fe76\` ON \`bank_transactions\``);
        await queryRunner.query(`ALTER TABLE \`bank_transactions\` DROP COLUMN \`reconciliationId\``);
        await queryRunner.query(`DROP INDEX \`IDX_248003e6de89bccddc7805f6e4\` ON \`bank_reconciliations\``);
        await queryRunner.query(`DROP TABLE \`bank_reconciliations\``);
    }

}
