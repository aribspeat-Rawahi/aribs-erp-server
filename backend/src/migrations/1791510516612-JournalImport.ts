import { MigrationInterface, QueryRunner } from "typeorm";

export class JournalImport1791510516612 implements MigrationInterface {
    name = 'JournalImport1791510516612'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`journal_import_batches\` (\`id\` varchar(36) NOT NULL, \`fileName\` varchar(255) NOT NULL, \`entryCount\` int NOT NULL, \`lineCount\` int NOT NULL, \`totalDebit\` decimal(16,3) NOT NULL, \`firstDate\` date NOT NULL, \`lastDate\` date NOT NULL, \`bankTransactionIds\` longtext NOT NULL, \`createdByEmail\` varchar(255) NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`journal_import_mappings\` (\`id\` varchar(36) NOT NULL, \`sourceName\` varchar(200) NOT NULL, \`accountId\` varchar(36) NOT NULL, \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_d9ae7262c7b377cd0387bd84ec\` (\`sourceName\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`IDX_d9ae7262c7b377cd0387bd84ec\` ON \`journal_import_mappings\``);
        await queryRunner.query(`DROP TABLE \`journal_import_mappings\``);
        await queryRunner.query(`DROP TABLE \`journal_import_batches\``);
    }

}
