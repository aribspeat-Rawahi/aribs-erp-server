import { MigrationInterface, QueryRunner } from "typeorm";

export class PurchasingApproval1791621288147 implements MigrationInterface {
    name = 'PurchasingApproval1791621288147'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`rfqs\` (\`id\` varchar(36) NOT NULL, \`sequenceNumber\` int NOT NULL AUTO_INCREMENT, \`rfqNumber\` varchar(30) NOT NULL, \`requisitionId\` varchar(36) NULL, \`title\` varchar(200) NOT NULL, \`quotesDueBy\` date NULL, \`notes\` text NULL, \`status\` varchar(20) NOT NULL DEFAULT 'open', \`awardedQuoteId\` varchar(36) NULL, \`awardReason\` text NULL, \`purchaseOrderId\` varchar(36) NULL, \`createdByUserId\` varchar(36) NULL, \`createdByEmail\` varchar(255) NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`IDX_8a5b46bdb20592381fff448c02\` (\`status\`), UNIQUE INDEX \`IDX_ca2a972dfb9f97e4a654b18204\` (\`sequenceNumber\`), UNIQUE INDEX \`IDX_1f87b36a05a4c5d113944e67a6\` (\`rfqNumber\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`rfq_items\` (\`id\` varchar(36) NOT NULL, \`rfqId\` varchar(36) NOT NULL, \`rawMaterialId\` varchar(36) NOT NULL, \`quantity\` decimal(12,3) NOT NULL, \`unit\` varchar(10) NOT NULL DEFAULT 'pcs', \`requisitionItemId\` varchar(36) NULL, INDEX \`IDX_be706469f1921b7489305adf35\` (\`rfqId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`rfq_quotes\` (\`id\` varchar(36) NOT NULL, \`rfqId\` varchar(36) NOT NULL, \`supplierId\` varchar(36) NOT NULL, \`quoteReference\` varchar(100) NULL, \`quoteDate\` date NULL, \`validUntil\` date NULL, \`deliveryDays\` int NULL, \`notes\` text NULL, \`lines\` text NOT NULL, \`subtotal\` decimal(14,3) NOT NULL DEFAULT '0.000', \`vatAmount\` decimal(14,3) NOT NULL DEFAULT '0.000', \`total\` decimal(14,3) NOT NULL DEFAULT '0.000', \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`IDX_e5790f0cd057a382514c9a7963\` (\`rfqId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`purchase_requisitions\` (\`id\` varchar(36) NOT NULL, \`sequenceNumber\` int NOT NULL AUTO_INCREMENT, \`prNumber\` varchar(30) NOT NULL, \`status\` varchar(20) NOT NULL DEFAULT 'pending_approval', \`neededBy\` date NULL, \`purpose\` text NOT NULL, \`department\` varchar(120) NULL, \`estimatedTotal\` decimal(14,3) NOT NULL DEFAULT '0.000', \`requestedByUserId\` varchar(36) NULL, \`requestedByEmail\` varchar(255) NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`IDX_cc645c3760155be81577623f6d\` (\`status\`), UNIQUE INDEX \`IDX_225c050a90834c8a20fbbae16f\` (\`sequenceNumber\`), UNIQUE INDEX \`IDX_0aa2dff0488999b1f08280b8ca\` (\`prNumber\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`purchase_requisition_items\` (\`id\` varchar(36) NOT NULL, \`requisitionId\` varchar(36) NOT NULL, \`rawMaterialId\` varchar(36) NOT NULL, \`quantity\` decimal(12,3) NOT NULL, \`unit\` varchar(10) NOT NULL DEFAULT 'pcs', \`estimatedUnitCost\` decimal(12,3) NOT NULL DEFAULT '0.000', \`note\` varchar(255) NULL, INDEX \`IDX_537b9b9d4f4e4d64b9c09e4c55\` (\`requisitionId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`approval_rules\` (\`id\` varchar(36) NOT NULL, \`documentType\` varchar(40) NOT NULL, \`upToAmount\` decimal(14,3) NULL, \`steps\` text NOT NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`IDX_ac99fccfa7c56d3b32949b3c05\` (\`documentType\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`document_approvals\` (\`id\` varchar(36) NOT NULL, \`documentType\` varchar(40) NOT NULL, \`documentId\` varchar(36) NOT NULL, \`documentNumber\` varchar(40) NOT NULL, \`amount\` decimal(14,3) NOT NULL DEFAULT '0.000', \`round\` int NOT NULL DEFAULT '1', \`step\` int NOT NULL, \`totalSteps\` int NOT NULL, \`roles\` text NOT NULL, \`plan\` text NOT NULL, \`status\` varchar(20) NOT NULL DEFAULT 'pending', \`summary\` varchar(255) NULL, \`requestedByUserId\` varchar(36) NULL, \`requestedByEmail\` varchar(255) NULL, \`decidedByUserId\` varchar(36) NULL, \`decidedByEmail\` varchar(255) NULL, \`decidedAt\` datetime NULL, \`comment\` text NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`IDX_cd0ecbdbdf762c2997a6eeb3ea\` (\`status\`), INDEX \`IDX_f59aea1417b67f71387fe68030\` (\`documentType\`, \`documentId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`purchase_orders\` ADD \`requisitionId\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`purchase_orders\` ADD \`rfqId\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`purchase_orders\` ADD \`approvedAmount\` decimal(12,3) NULL`);
        await queryRunner.query(`ALTER TABLE \`purchase_orders\` ADD \`approvedAt\` datetime NULL`);
        await queryRunner.query(`ALTER TABLE \`purchase_orders\` ADD \`createdByUserId\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`purchase_orders\` ADD \`createdByEmail\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`purchase_order_items\` ADD \`requisitionItemId\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`purchase_orders\` CHANGE \`status\` \`status\` enum ('pending_approval', 'rejected', 'ordered', 'partially_received', 'received', 'cancelled') NOT NULL DEFAULT 'ordered'`);
        // Default approval rules (changeable in Settings > Approval rules):
        // purchase orders up to 500 OMR - Accountant or MD; up to 5,000 -
        // MD; above - MD then CEO. Requisitions - Accountant, MD or CEO.
        const rule = (type: string, upTo: number | null, steps: string[][]) =>
            queryRunner.query('INSERT INTO `approval_rules` (`id`, `documentType`, `upToAmount`, `steps`) VALUES (UUID(), ?, ?, ?)', [type, upTo, JSON.stringify(steps)]);
        await rule('purchase_order', 500, [['accountant', 'md']]);
        await rule('purchase_order', 5000, [['md']]);
        await rule('purchase_order', null, [['md'], ['ceo']]);
        await rule('purchase_requisition', null, [['accountant', 'md', 'ceo']]);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // orders still waiting / rejected go back to "ordered" / "cancelled"
        await queryRunner.query("UPDATE `purchase_orders` SET `status` = 'ordered' WHERE `status` = 'pending_approval'");
        await queryRunner.query("UPDATE `purchase_orders` SET `status` = 'cancelled' WHERE `status` = 'rejected'");
        await queryRunner.query(`ALTER TABLE \`purchase_orders\` CHANGE \`status\` \`status\` enum ('ordered', 'partially_received', 'received', 'cancelled') NOT NULL DEFAULT 'ordered'`);
        await queryRunner.query(`ALTER TABLE \`purchase_order_items\` DROP COLUMN \`requisitionItemId\``);
        await queryRunner.query(`ALTER TABLE \`purchase_orders\` DROP COLUMN \`createdByEmail\``);
        await queryRunner.query(`ALTER TABLE \`purchase_orders\` DROP COLUMN \`createdByUserId\``);
        await queryRunner.query(`ALTER TABLE \`purchase_orders\` DROP COLUMN \`approvedAt\``);
        await queryRunner.query(`ALTER TABLE \`purchase_orders\` DROP COLUMN \`approvedAmount\``);
        await queryRunner.query(`ALTER TABLE \`purchase_orders\` DROP COLUMN \`rfqId\``);
        await queryRunner.query(`ALTER TABLE \`purchase_orders\` DROP COLUMN \`requisitionId\``);
        await queryRunner.query(`DROP INDEX \`IDX_f59aea1417b67f71387fe68030\` ON \`document_approvals\``);
        await queryRunner.query(`DROP INDEX \`IDX_cd0ecbdbdf762c2997a6eeb3ea\` ON \`document_approvals\``);
        await queryRunner.query(`DROP TABLE \`document_approvals\``);
        await queryRunner.query(`DROP INDEX \`IDX_ac99fccfa7c56d3b32949b3c05\` ON \`approval_rules\``);
        await queryRunner.query(`DROP TABLE \`approval_rules\``);
        await queryRunner.query(`DROP INDEX \`IDX_537b9b9d4f4e4d64b9c09e4c55\` ON \`purchase_requisition_items\``);
        await queryRunner.query(`DROP TABLE \`purchase_requisition_items\``);
        await queryRunner.query(`DROP INDEX \`IDX_0aa2dff0488999b1f08280b8ca\` ON \`purchase_requisitions\``);
        await queryRunner.query(`DROP INDEX \`IDX_225c050a90834c8a20fbbae16f\` ON \`purchase_requisitions\``);
        await queryRunner.query(`DROP INDEX \`IDX_cc645c3760155be81577623f6d\` ON \`purchase_requisitions\``);
        await queryRunner.query(`DROP TABLE \`purchase_requisitions\``);
        await queryRunner.query(`DROP INDEX \`IDX_e5790f0cd057a382514c9a7963\` ON \`rfq_quotes\``);
        await queryRunner.query(`DROP TABLE \`rfq_quotes\``);
        await queryRunner.query(`DROP INDEX \`IDX_be706469f1921b7489305adf35\` ON \`rfq_items\``);
        await queryRunner.query(`DROP TABLE \`rfq_items\``);
        await queryRunner.query(`DROP INDEX \`IDX_1f87b36a05a4c5d113944e67a6\` ON \`rfqs\``);
        await queryRunner.query(`DROP INDEX \`IDX_ca2a972dfb9f97e4a654b18204\` ON \`rfqs\``);
        await queryRunner.query(`DROP INDEX \`IDX_8a5b46bdb20592381fff448c02\` ON \`rfqs\``);
        await queryRunner.query(`DROP TABLE \`rfqs\``);
    }

}
