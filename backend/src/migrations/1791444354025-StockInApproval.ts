import { MigrationInterface, QueryRunner } from 'typeorm';

// Manual stock-in by users outside Admin/CEO/MD/Accountant goes through
// the Approvals page: adds 'stock_in' to approval_requests.type.
export class StockInApproval1791444354025 implements MigrationInterface {
  name = 'StockInApproval1791444354025';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `approval_requests` MODIFY `type` enum ('credit_limit_override', 'large_discount', 'vat_exclude', 'salary_advance', 'stock_in') NOT NULL",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM `approval_requests` WHERE `type` = 'stock_in'");
    await queryRunner.query(
      "ALTER TABLE `approval_requests` MODIFY `type` enum ('credit_limit_override', 'large_discount', 'vat_exclude', 'salary_advance') NOT NULL",
    );
  }
}
