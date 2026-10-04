// Every DELETE route in the ERP, what it deletes and whether "Undo" can
// put it back.
//  - generic:    the deleted rows are inserted back exactly as they were.
//                Only for records whose delete has no stock/money/journal
//                side effects.
//  - invoice:    rows are put back and then stock, cost of goods sold,
//                the journal entry and payments are re-applied
//                (InvoiceService.restoreDeleted).
//  - reactivate: the delete was only a deactivation; undo re-activates.
//  - (none):     money moved (bank, payroll, journal, payments ...). The
//                delete is still logged and emailed, but has to be
//                re-entered by hand.
export type RestoreKind = 'generic' | 'invoice' | 'reactivate';

export interface DeleteRouteInfo {
  type: string;
  label: string;
  restore?: RestoreKind;
  // nested routes: the parent record must still exist to undo
  parent?: { param: string; table: string };
}

const customerChild = { param: 'customerId', table: 'customers' };
const supplierChild = { param: 'supplierId', table: 'suppliers' };

export const DELETE_ROUTES: Record<string, DeleteRouteInfo> = {
  'accounts/:id': { type: 'account', label: 'Chart of accounts entry' },
  'attendance/:id': { type: 'attendance', label: 'Attendance record', restore: 'generic' },
  'auth/users/:id': { type: 'user', label: 'User account' },
  'bank-accounts/:id': { type: 'bank_account', label: 'Bank/cash account' },
  'bom/:id': { type: 'bom_line', label: 'Recipe (BOM) line', restore: 'generic' },
  'customers/:customerId/bank-accounts/:id': { type: 'customer_bank_account', label: 'Customer bank account', restore: 'generic', parent: customerChild },
  'customers/:customerId/documents/:docId': { type: 'customer_document', label: 'Customer document', restore: 'generic', parent: customerChild },
  'customers/:customerId/interactions/:id': { type: 'customer_interaction', label: 'Customer interaction', restore: 'generic', parent: customerChild },
  'customers/:id': { type: 'customer', label: 'Customer', restore: 'generic' },
  'delivery-notes/:id': { type: 'delivery_note', label: 'Delivery note', restore: 'generic' },
  'departments/:id': { type: 'department', label: 'Department', restore: 'generic' },
  'designations/:id': { type: 'designation', label: 'Designation', restore: 'generic' },
  'employees/:employeeId/documents/:docId': { type: 'employee_document', label: 'Employee document', restore: 'generic', parent: { param: 'employeeId', table: 'employees' } },
  'employees/:id': { type: 'employee', label: 'Employee', restore: 'generic' },
  'events/:id': { type: 'event', label: 'Event', restore: 'generic' },
  'finished-good-batches/:id': { type: 'finished_good_batch', label: 'Finished good batch', restore: 'generic' },
  'finished-goods/:id': { type: 'finished_good', label: 'Product', restore: 'generic' },
  'fixed-assets/:id': { type: 'fixed_asset', label: 'Fixed asset' },
  'fund-transfers/:id': { type: 'fund_transfer', label: 'Fund transfer' },
  'holidays/:id': { type: 'holiday', label: 'Holiday', restore: 'generic' },
  'invoices/:id': { type: 'invoice', label: 'Invoice', restore: 'invoice' },
  'invoices/:invoiceId/payments/:paymentId': { type: 'invoice_payment', label: 'Invoice payment' },
  'journal-entries/:id': { type: 'journal_entry', label: 'Journal entry' },
  'leave-requests/:id': { type: 'leave_request', label: 'Leave request', restore: 'generic' },
  'notices/:id': { type: 'notice', label: 'Notice', restore: 'generic' },
  'payroll/:id': { type: 'payroll', label: 'Payroll record' },
  'payroll/:payrollId/documents/:docId': { type: 'payroll_document', label: 'Payroll document', restore: 'generic', parent: { param: 'payrollId', table: 'hr_payroll' } },
  'production-orders/:id': { type: 'production_order', label: 'Production order', restore: 'generic' },
  'projects/:id': { type: 'project', label: 'Project', restore: 'generic' },
  'purchase-orders/:id': { type: 'purchase_order', label: 'Purchase order' },
  'purchase-orders/:purchaseOrderId/payments/:paymentId': { type: 'supplier_payment', label: 'Supplier payment' },
  'purchase-returns/:id': { type: 'purchase_return', label: 'Purchase return', restore: 'generic' },
  'quotations/:id': { type: 'quotation', label: 'Quotation', restore: 'generic' },
  'raw-materials/:id': { type: 'raw_material', label: 'Raw material', restore: 'generic' },
  'recurring-invoices/:id': { type: 'recurring_invoice', label: 'Recurring invoice', restore: 'generic' },
  'reimbursements/:id': { type: 'reimbursement', label: 'Reimbursement' },
  'roles/:id': { type: 'role', label: 'HR role', restore: 'generic' },
  'sales-orders/:id': { type: 'sales_order', label: 'Sales order', restore: 'generic' },
  'sales-returns/:id': { type: 'sales_return', label: 'Sales return', restore: 'generic' },
  'settings/documents/:id': { type: 'company_document', label: 'Company document', restore: 'generic' },
  'shifts/:id': { type: 'shift', label: 'Shift', restore: 'generic' },
  'suppliers/:supplierId/bank-accounts/:id': { type: 'supplier_bank_account', label: 'Supplier bank account', restore: 'generic', parent: supplierChild },
  'suppliers/:supplierId/documents/:docId': { type: 'supplier_document', label: 'Supplier document', restore: 'generic', parent: supplierChild },
  'suppliers/:supplierId/interactions/:id': { type: 'supplier_interaction', label: 'Supplier interaction', restore: 'generic', parent: supplierChild },
  'suppliers/:id': { type: 'supplier', label: 'Supplier', restore: 'generic' },
  'tax-payments/:id': { type: 'tax_payment', label: 'Tax payment' },
  'tax-rates/:id': { type: 'tax_rate', label: 'Tax rate', restore: 'reactivate' },
  'teams/:id': { type: 'team', label: 'Team', restore: 'generic' },
  'vendor-credits/:id': { type: 'vendor_credit', label: 'Vendor credit' },
  'vendor-prepayments/:id': { type: 'vendor_prepayment', label: 'Vendor prepayment' },
};

// "/api/customers/:id" -> "customers/:id"
export function routeKey(path: string) {
  return path.replace(/^\/+/, '').replace(/^api\//, '');
}

export function routeInfo(key: string): DeleteRouteInfo {
  return DELETE_ROUTES[key] || { type: key.split('/')[0].replace(/-/g, '_'), label: key.split('/')[0].replace(/-/g, ' ') };
}
