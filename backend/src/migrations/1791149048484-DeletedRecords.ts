import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeletedRecords1791149048484 implements MigrationInterface {
  name = 'DeletedRecords1791149048484';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`deleted_records\` (\`id\` varchar(36) NOT NULL, \`entityType\` varchar(60) NOT NULL, \`entityId\` varchar(64) NULL, \`label\` varchar(500) NOT NULL, \`route\` varchar(300) NOT NULL, \`snapshot\` longtext NOT NULL, \`deletedByUserId\` varchar(36) NULL, \`deletedByEmail\` varchar(255) NULL, \`deletedByName\` varchar(255) NULL, \`deletedByRole\` varchar(20) NULL, \`ipAddress\` varchar(64) NULL, \`deletedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`restorable\` tinyint NOT NULL DEFAULT 0, \`notRestorableReason\` varchar(300) NULL, \`restoreExpiresAt\` datetime NULL, \`restoredAt\` datetime NULL, \`restoredByEmail\` varchar(255) NULL, INDEX \`IDX_fcfb931a1ff059bc3b6a28acd0\` (\`entityType\`), INDEX \`IDX_6e8bdcdcb342f487bcc527791f\` (\`deletedAt\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX \`IDX_6e8bdcdcb342f487bcc527791f\` ON \`deleted_records\``);
    await queryRunner.query(`DROP INDEX \`IDX_fcfb931a1ff059bc3b6a28acd0\` ON \`deleted_records\``);
    await queryRunner.query(`DROP TABLE \`deleted_records\``);
  }
}
