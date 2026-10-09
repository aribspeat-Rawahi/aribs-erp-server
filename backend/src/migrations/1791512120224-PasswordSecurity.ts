import { MigrationInterface, QueryRunner } from "typeorm";

export class PasswordSecurity1791512120224 implements MigrationInterface {
    name = 'PasswordSecurity1791512120224'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`users\` ADD \`passwordChangedAt\` datetime NULL`);
        await queryRunner.query(`ALTER TABLE \`users\` ADD \`resetTokenHash\` varchar(64) NULL`);
        await queryRunner.query(`ALTER TABLE \`users\` ADD \`resetTokenExpiresAt\` datetime NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`resetTokenExpiresAt\``);
        await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`resetTokenHash\``);
        await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`passwordChangedAt\``);
    }

}
