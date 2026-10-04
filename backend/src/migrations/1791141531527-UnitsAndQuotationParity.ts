import { MigrationInterface, QueryRunner } from "typeorm";

export class UnitsAndQuotationParity1791141531527 implements MigrationInterface {
    name = 'UnitsAndQuotationParity1791141531527'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`purchase_return_items\` ADD \`unit\` varchar(10) NOT NULL DEFAULT 'pcs'`);
        await queryRunner.query(`ALTER TABLE \`purchase_order_items\` ADD \`unit\` varchar(10) NOT NULL DEFAULT 'pcs'`);
        await queryRunner.query(`ALTER TABLE \`sales_order_items\` ADD \`unit\` varchar(10) NOT NULL DEFAULT 'pcs'`);
        await queryRunner.query(`ALTER TABLE \`quotation_items\` ADD \`unit\` varchar(10) NOT NULL DEFAULT 'pcs'`);
        await queryRunner.query(`ALTER TABLE \`quotations\` ADD \`paymentType\` enum ('cash', 'bank_transfer', 'card_machine', 'cheque', 'conditional') NULL`);
        await queryRunner.query(`ALTER TABLE \`quotations\` ADD \`deliveryDate\` date NULL`);
        await queryRunner.query(`ALTER TABLE \`quotations\` ADD \`template\` enum ('classic', 'formal', 'po_style') NOT NULL DEFAULT 'classic'`);
        await queryRunner.query(`ALTER TABLE \`quotations\` ADD \`vatExcluded\` tinyint NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE \`sales_return_items\` ADD \`unit\` varchar(10) NOT NULL DEFAULT 'pcs'`);
        await queryRunner.query(`ALTER TABLE \`invoice_items\` ADD \`unit\` varchar(10) NOT NULL DEFAULT 'pcs'`);
        await queryRunner.query(`ALTER TABLE \`delivery_note_items\` ADD \`unit\` varchar(10) NOT NULL DEFAULT 'pcs'`);

        // --- Data: products move to the fixed unit list -------------------
        // (pcs | bags | kg | litre | ton; anything unrecognised becomes pcs)
        const unitCase = (col: string) => `CASE
            WHEN LOWER(TRIM(${col})) IN ('kg','kgs','kilo','kilos','kilogram','kilograms') THEN 'kg'
            WHEN LOWER(TRIM(${col})) IN ('l','lt','ltr','ltrs','litre','litres','liter','liters') THEN 'litre'
            WHEN LOWER(TRIM(${col})) IN ('ton','tons','tonne','tonnes','mt') THEN 'ton'
            WHEN LOWER(TRIM(${col})) IN ('bag','bags','sack','sacks') THEN 'bags'
            ELSE 'pcs' END`;
        await queryRunner.query(`UPDATE \`finished_goods\` SET \`unit\` = ${unitCase('`unit`')}`);
        await queryRunner.query(`UPDATE \`raw_materials\` SET \`unit\` = ${unitCase('`unit`')}`);

        // Existing document lines take their product's unit.
        for (const table of ['invoice_items', 'quotation_items', 'delivery_note_items', 'sales_order_items', 'sales_return_items']) {
            await queryRunner.query(
                `UPDATE \`${table}\` t JOIN \`finished_goods\` f ON f.\`id\` = t.\`finishedGoodId\` SET t.\`unit\` = f.\`unit\``,
            );
        }
        for (const table of ['purchase_order_items', 'purchase_return_items']) {
            await queryRunner.query(
                `UPDATE \`${table}\` t JOIN \`raw_materials\` m ON m.\`id\` = t.\`rawMaterialId\` SET t.\`unit\` = m.\`unit\``,
            );
        }

        // Existing quotations use the company's default PDF template.
        await queryRunner.query(
            `UPDATE \`quotations\` SET \`template\` = COALESCE((SELECT \`defaultInvoiceTemplate\` FROM \`settings\` LIMIT 1), 'classic')`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`delivery_note_items\` DROP COLUMN \`unit\``);
        await queryRunner.query(`ALTER TABLE \`invoice_items\` DROP COLUMN \`unit\``);
        await queryRunner.query(`ALTER TABLE \`sales_return_items\` DROP COLUMN \`unit\``);
        await queryRunner.query(`ALTER TABLE \`quotations\` DROP COLUMN \`vatExcluded\``);
        await queryRunner.query(`ALTER TABLE \`quotations\` DROP COLUMN \`template\``);
        await queryRunner.query(`ALTER TABLE \`quotations\` DROP COLUMN \`deliveryDate\``);
        await queryRunner.query(`ALTER TABLE \`quotations\` DROP COLUMN \`paymentType\``);
        await queryRunner.query(`ALTER TABLE \`quotation_items\` DROP COLUMN \`unit\``);
        await queryRunner.query(`ALTER TABLE \`sales_order_items\` DROP COLUMN \`unit\``);
        await queryRunner.query(`ALTER TABLE \`purchase_order_items\` DROP COLUMN \`unit\``);
        await queryRunner.query(`ALTER TABLE \`purchase_return_items\` DROP COLUMN \`unit\``);
    }

}
