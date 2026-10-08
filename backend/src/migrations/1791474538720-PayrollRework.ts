import { MigrationInterface, QueryRunner } from "typeorm";

// Payroll by Oman rules: allowances, Social Protection Fund, joiners/
// leavers, advance recovery, draft -> approved -> paid, 3-decimal money,
// SPF payment bank category. Only adds columns/values and widens decimals -
// existing data is kept.

export class PayrollRework1791474538720 implements MigrationInterface {
    name = 'PayrollRework1791474538720'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`settings\` ADD \`spfEmployeeRatePercent\` decimal(5,2) NOT NULL DEFAULT '8.00'`);
        await queryRunner.query(`ALTER TABLE \`settings\` ADD \`spfEmployerRatePercent\` decimal(5,2) NOT NULL DEFAULT '13.50'`);
        await queryRunner.query(`ALTER TABLE \`settings\` ADD \`spfWageCeiling\` decimal(12,3) NOT NULL DEFAULT '3000.000'`);
        await queryRunner.query(`ALTER TABLE \`settings\` ADD \`expatSavingsSchemeStart\` date NULL DEFAULT '2027-07-19'`);
        await queryRunner.query(`ALTER TABLE \`salary_advance_requests\` ADD \`installmentAmount\` decimal(12,3) NULL`);
        await queryRunner.query(`ALTER TABLE \`salary_advance_requests\` ADD \`recoveredAmount\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` ADD \`allowances\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` ADD \`status\` varchar(20) NOT NULL DEFAULT 'draft'`);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` ADD \`periodDays\` int NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` ADD \`employedDays\` decimal(6,1) NOT NULL DEFAULT '0.0'`);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` ADD \`unpaidDays\` decimal(6,1) NOT NULL DEFAULT '0.0'`);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` ADD \`grossPay\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` ADD \`absenceDeduction\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` ADD \`socialProtectionCovered\` tinyint NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` ADD \`spfEmployee\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` ADD \`spfEmployer\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` ADD \`advanceRecovery\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` ADD \`advanceAllocations\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` ADD \`approvedAt\` datetime NULL`);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` ADD \`approvedByEmail\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`employees\` ADD \`housingAllowance\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
        await queryRunner.query(`ALTER TABLE \`employees\` ADD \`transportAllowance\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
        await queryRunner.query(`ALTER TABLE \`employees\` ADD \`otherAllowance\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
        await queryRunner.query(`ALTER TABLE \`employees\` ADD \`socialProtectionCovered\` tinyint NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE \`employees\` ADD \`leftDate\` date NULL`);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` CHANGE \`otRate\` \`otRate\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` CHANGE \`otPay\` \`otPay\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` CHANGE \`staffSalary\` \`staffSalary\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` CHANGE \`calculatedSalary\` \`calculatedSalary\` decimal(12,3) NOT NULL DEFAULT '0.000'`);
        await queryRunner.query(`ALTER TABLE \`employees\` CHANGE \`baseSalary\` \`baseSalary\` decimal(12,3) NULL`);
        await queryRunner.query(`ALTER TABLE \`bank_transactions\` CHANGE \`category\` \`category\` enum ('owners_contribution', 'other_income', 'opening_balance', 'owners_draw', 'bank_charges', 'other_expense', 'spf_payment') NULL`);
        // rows already paid stay paid (their old journal entry stays as it is)
        await queryRunner.query(`UPDATE \`hr_payroll\` SET \`status\` = 'paid' WHERE \`isPaid\` = 1`);
        // Omani staff are covered by the Social Protection Fund
        await queryRunner.query(`UPDATE \`employees\` SET \`socialProtectionCovered\` = 1 WHERE UPPER(\`nationality\`) = 'OM'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`UPDATE \`bank_transactions\` SET \`category\` = NULL WHERE \`category\` = 'spf_payment'`);
        await queryRunner.query(`ALTER TABLE \`bank_transactions\` CHANGE \`category\` \`category\` enum ('owners_contribution', 'other_income', 'opening_balance', 'owners_draw', 'bank_charges', 'other_expense') NULL`);
        await queryRunner.query(`ALTER TABLE \`employees\` CHANGE \`baseSalary\` \`baseSalary\` decimal(10,2) NULL`);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` CHANGE \`calculatedSalary\` \`calculatedSalary\` decimal(10,2) NOT NULL DEFAULT 0.00`);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` CHANGE \`staffSalary\` \`staffSalary\` decimal(10,2) NOT NULL DEFAULT 0.00`);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` CHANGE \`otPay\` \`otPay\` decimal(10,2) NOT NULL DEFAULT 0.00`);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` CHANGE \`otRate\` \`otRate\` decimal(10,2) NOT NULL DEFAULT 0.00`);
        await queryRunner.query(`ALTER TABLE \`employees\` DROP COLUMN \`leftDate\``);
        await queryRunner.query(`ALTER TABLE \`employees\` DROP COLUMN \`socialProtectionCovered\``);
        await queryRunner.query(`ALTER TABLE \`employees\` DROP COLUMN \`otherAllowance\``);
        await queryRunner.query(`ALTER TABLE \`employees\` DROP COLUMN \`transportAllowance\``);
        await queryRunner.query(`ALTER TABLE \`employees\` DROP COLUMN \`housingAllowance\``);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` DROP COLUMN \`approvedByEmail\``);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` DROP COLUMN \`approvedAt\``);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` DROP COLUMN \`advanceAllocations\``);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` DROP COLUMN \`advanceRecovery\``);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` DROP COLUMN \`spfEmployer\``);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` DROP COLUMN \`spfEmployee\``);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` DROP COLUMN \`socialProtectionCovered\``);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` DROP COLUMN \`absenceDeduction\``);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` DROP COLUMN \`grossPay\``);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` DROP COLUMN \`unpaidDays\``);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` DROP COLUMN \`employedDays\``);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` DROP COLUMN \`periodDays\``);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` DROP COLUMN \`status\``);
        await queryRunner.query(`ALTER TABLE \`hr_payroll\` DROP COLUMN \`allowances\``);
        await queryRunner.query(`ALTER TABLE \`salary_advance_requests\` DROP COLUMN \`recoveredAmount\``);
        await queryRunner.query(`ALTER TABLE \`salary_advance_requests\` DROP COLUMN \`installmentAmount\``);
        await queryRunner.query(`ALTER TABLE \`settings\` DROP COLUMN \`expatSavingsSchemeStart\``);
        await queryRunner.query(`ALTER TABLE \`settings\` DROP COLUMN \`spfWageCeiling\``);
        await queryRunner.query(`ALTER TABLE \`settings\` DROP COLUMN \`spfEmployerRatePercent\``);
        await queryRunner.query(`ALTER TABLE \`settings\` DROP COLUMN \`spfEmployeeRatePercent\``);
    }

}
