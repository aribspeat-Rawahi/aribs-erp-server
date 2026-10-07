import { MigrationInterface, QueryRunner } from "typeorm";

export class CostPrecision1791380525014 implements MigrationInterface {
    name = 'CostPrecision1791380525014'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`invoice_items\` CHANGE \`unitCost\` \`unitCost\` decimal(16,6) NULL`);
        await queryRunner.query(`ALTER TABLE \`raw_materials\` CHANGE \`costPerUnit\` \`costPerUnit\` decimal(16,6) NOT NULL DEFAULT '0.000000'`);
        await queryRunner.query(`ALTER TABLE \`finished_goods\` CHANGE \`costPerUnit\` \`costPerUnit\` decimal(16,6) NOT NULL DEFAULT '0.000000'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`finished_goods\` CHANGE \`costPerUnit\` \`costPerUnit\` decimal(12,3) NOT NULL DEFAULT 0.000`);
        await queryRunner.query(`ALTER TABLE \`raw_materials\` CHANGE \`costPerUnit\` \`costPerUnit\` decimal(12,3) NOT NULL DEFAULT 0.000`);
        await queryRunner.query(`ALTER TABLE \`invoice_items\` CHANGE \`unitCost\` \`unitCost\` decimal(12,3) NULL`);
    }

}
