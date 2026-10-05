// Bulk Import (Excel/CSV): the columns each import accepts. The same list
// builds the downloadable template, its Help sheet and the validation.
export type ImportType = 'customers' | 'suppliers' | 'finished-goods' | 'raw-materials';
export type ColumnKind = 'text' | 'email' | 'number' | 'percent' | 'yesno' | 'unit' | 'code';

export interface ImportColumn {
  key: string; // entity / DTO property
  header: string; // header text in the template
  kind: ColumnKind;
  required?: boolean;
  example: string;
  help?: string;
  aliases?: string[]; // other header spellings that are accepted
  maxLength?: number;
  group?: 'bank'; // customer/supplier bank details -> separate table
}

export interface ImportDefinition {
  type: ImportType;
  module: string; // permission module
  label: string; // "Customers"
  columns: ImportColumn[];
}

const BANK_COLUMNS: ImportColumn[] = [
  { key: 'accountName', header: 'Bank Account Name', kind: 'text', example: 'Al Noor Trading LLC', group: 'bank' },
  { key: 'accountNumber', header: 'Bank Account Number', kind: 'code', example: '0301234567890012', group: 'bank', aliases: ['account number', 'account no'] },
  { key: 'bankName', header: 'Bank Name', kind: 'text', example: 'Bank Muscat', group: 'bank' },
  { key: 'branchName', header: 'Branch Name', kind: 'text', example: 'Al Khuwair', group: 'bank' },
  { key: 'branchCode', header: 'Branch Code', kind: 'code', example: '030', group: 'bank' },
  { key: 'swiftCode', header: 'SWIFT Code', kind: 'code', example: 'BMUSOMRX', group: 'bank', aliases: ['swift', 'bic'] },
  { key: 'iban', header: 'IBAN', kind: 'code', example: 'OM810180000001234567890', group: 'bank' },
];

export const IMPORT_DEFINITIONS: Record<ImportType, ImportDefinition> = {
  customers: {
    type: 'customers',
    module: 'customers',
    label: 'Customers',
    columns: [
      { key: 'name', header: 'Name', kind: 'text', required: true, example: 'Al Noor Trading LLC', aliases: ['customer name', 'customer'] },
      { key: 'phone', header: 'Phone', kind: 'code', example: '96891234567', help: 'With country code (968...) so WhatsApp works.', aliases: ['mobile', 'phone number'] },
      { key: 'email', header: 'Email', kind: 'email', example: 'accounts@alnoor.om' },
      { key: 'address', header: 'Address', kind: 'text', example: 'Way 1234, Al Khuwair, Muscat', maxLength: 255 },
      { key: 'crNumber', header: 'CR Number', kind: 'code', example: '1234567', aliases: ['cr', 'cr no'] },
      { key: 'vatin', header: 'VATIN', kind: 'code', example: 'OM1100012345', aliases: ['vat number', 'vat no', 'tax number'] },
      { key: 'vatApplicable', header: 'VAT Applicable', kind: 'yesno', example: 'Yes', help: 'Yes or No. Blank = Yes.' },
      { key: 'creditLimit', header: 'Credit Limit (OMR)', kind: 'number', example: '500', help: 'Blank = no limit.', aliases: ['credit limit'] },
      ...BANK_COLUMNS,
    ],
  },
  suppliers: {
    type: 'suppliers',
    module: 'suppliers',
    label: 'Suppliers',
    columns: [
      { key: 'name', header: 'Name', kind: 'text', required: true, example: 'Sri Lanka Coir Exporters Pvt Ltd', aliases: ['supplier name', 'supplier'] },
      { key: 'contactPerson', header: 'Contact Person', kind: 'text', example: 'Mr. Perera', aliases: ['contact'] },
      { key: 'phone', header: 'Phone', kind: 'code', example: '94771234567', aliases: ['mobile', 'phone number'] },
      { key: 'email', header: 'Email', kind: 'email', example: 'export@coir.lk' },
      { key: 'address', header: 'Address', kind: 'text', example: 'Colombo 03, Sri Lanka', maxLength: 255 },
      ...BANK_COLUMNS,
    ],
  },
  'finished-goods': {
    type: 'finished-goods',
    module: 'inventory',
    label: 'Products',
    columns: [
      { key: 'name', header: 'Name', kind: 'text', required: true, example: 'Coco Peat Block 5kg', aliases: ['product name', 'product'] },
      { key: 'barcode', header: 'Barcode', kind: 'code', required: true, example: '6291234567890', help: 'Must be unique. Keep the column as Text in Excel so leading zeros stay.' },
      { key: 'sku', header: 'SKU', kind: 'code', example: 'CP-5KG', help: 'Optional, must be unique.' },
      { key: 'unit', header: 'Unit', kind: 'unit', required: true, example: 'Bags', help: 'Pcs, Bags, Kgs, Litre or Tons.' },
      { key: 'sellingPrice', header: 'Selling Price (OMR)', kind: 'number', example: '2.500', aliases: ['selling price', 'price'] },
      { key: 'costPerUnit', header: 'Cost per Unit (OMR)', kind: 'number', example: '1.200', aliases: ['cost per unit', 'cost'] },
      { key: 'vatRate', header: 'VAT %', kind: 'percent', example: '5', help: 'Blank = 5.', aliases: ['vat', 'vat rate'] },
      { key: 'lowStockThreshold', header: 'Low Stock Alert', kind: 'number', example: '20', aliases: ['low stock', 'reorder level'] },
      { key: 'quantityInStock', header: 'Opening Stock', kind: 'number', example: '100', help: 'Pcs/Bags whole numbers, Kgs/Litre/Tons up to 3 decimals. Blank = 0.', aliases: ['stock', 'quantity', 'qty'] },
    ],
  },
  'raw-materials': {
    type: 'raw-materials',
    module: 'inventory',
    label: 'Raw materials',
    columns: [
      { key: 'name', header: 'Name', kind: 'text', required: true, example: 'Raw Coir Pith', aliases: ['material name', 'material'] },
      { key: 'unit', header: 'Unit', kind: 'unit', required: true, example: 'Kgs', help: 'Pcs, Bags, Kgs, Litre or Tons.' },
      { key: 'sku', header: 'SKU', kind: 'code', example: 'RM-PITH', help: 'Optional, must be unique.' },
      { key: 'barcode', header: 'Barcode', kind: 'code', example: '', help: 'Optional, must be unique.' },
      { key: 'costPerUnit', header: 'Cost per Unit (OMR)', kind: 'number', example: '0.050', aliases: ['cost per unit', 'cost'] },
      { key: 'lowStockThreshold', header: 'Low Stock Alert', kind: 'number', example: '500', aliases: ['low stock'] },
      { key: 'reorderQuantity', header: 'Reorder Quantity', kind: 'number', example: '1000', aliases: ['reorder qty'] },
      { key: 'quantityInStock', header: 'Opening Stock', kind: 'number', example: '2500', help: 'Pcs/Bags whole numbers, Kgs/Litre/Tons up to 3 decimals. Blank = 0.', aliases: ['stock', 'quantity', 'qty'] },
      { key: 'supplierName', header: 'Supplier Name', kind: 'text', example: 'Sri Lanka Coir Exporters Pvt Ltd', help: 'Must match an existing supplier (import suppliers first).', aliases: ['supplier'] },
    ],
  },
};

export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export function headerKey(h: string) {
  return String(h || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');
}
