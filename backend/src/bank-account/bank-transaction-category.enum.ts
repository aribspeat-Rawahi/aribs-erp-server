// Categories offered on the "Add Transaction" (Deposit/Withdrawal) modal
// — the one place money can move on a bank/cash account outside of
// Expense/Invoice/Reimbursement/FundTransfer/TaxPayment/SupplierPayment/
// Payroll, all of which already auto-post their own journal entries.
// Picking a category here is what makes this raw entry auto-post too
// (Dr/Cr against the matching Chart-of-Accounts code below); leaving it
// blank keeps the old record-only behavior (no journal entry) — kept for
// internal callers (e.g. Reimbursement/Payroll markPaid) that never pass
// a category, since they already post their own entry separately.
export enum BankTransactionCategory {
  OWNERS_CONTRIBUTION = 'owners_contribution', // Deposit — capital the owner put in
  OTHER_INCOME = 'other_income', // Deposit — interest, refund, misc income
  OPENING_BALANCE = 'opening_balance', // Deposit — starting balance when this account was first set up
  OWNERS_DRAW = 'owners_draw', // Withdrawal — owner taking money out
  BANK_CHARGES = 'bank_charges', // Withdrawal — bank fees/charges
  OTHER_EXPENSE = 'other_expense', // Withdrawal — anything else not worth its own Expense entry
  SPF_PAYMENT = 'spf_payment', // Withdrawal — paying the Social Protection Fund what payroll owes it
}

// code = Chart of Accounts code to Dr (withdrawal) or Cr (deposit)
// against the bank/cash account's own linked GL line.
export const BANK_TRANSACTION_CATEGORY_ACCOUNT_CODE: Record<BankTransactionCategory, string> = {
  [BankTransactionCategory.OWNERS_CONTRIBUTION]: '300', // Owner's Contribution (Equity)
  [BankTransactionCategory.OTHER_INCOME]: '470', // Other Revenue
  [BankTransactionCategory.OPENING_BALANCE]: '3900', // Opening Balance Equity - same account as Accounting > Opening Balances
  [BankTransactionCategory.OWNERS_DRAW]: '310', // Owner's Draw (Equity)
  [BankTransactionCategory.BANK_CHARGES]: '606', // Bank Transaction Charge (Expense)
  [BankTransactionCategory.OTHER_EXPENSE]: '628', // General Expenses
  [BankTransactionCategory.SPF_PAYMENT]: '2170', // Social Insurance (SPF) Payable - clears what payroll booked
};

export const BANK_TRANSACTION_CATEGORY_LABEL: Record<BankTransactionCategory, string> = {
  [BankTransactionCategory.OWNERS_CONTRIBUTION]: "Owner's Contribution",
  [BankTransactionCategory.OTHER_INCOME]: 'Other Income',
  [BankTransactionCategory.OPENING_BALANCE]: 'Opening Balance',
  [BankTransactionCategory.OWNERS_DRAW]: "Owner's Draw",
  [BankTransactionCategory.BANK_CHARGES]: 'Bank Charges',
  [BankTransactionCategory.OTHER_EXPENSE]: 'Other Expense',
  [BankTransactionCategory.SPF_PAYMENT]: 'Social Protection Fund payment',
};
