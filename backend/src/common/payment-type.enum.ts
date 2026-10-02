// Shared across Sales Orders and Invoices. Stored as a plain string enum
// (not a fixed DB enum) so new payment types can be added later without
// a schema migration — the controller/DTO just needs the new value added
// to this list.
export enum PaymentType {
  CASH = 'cash',
  BANK_TRANSFER = 'bank_transfer',
  CARD_MACHINE = 'card_machine', // "machine payment via bank"
  CHEQUE = 'cheque',
  CONDITIONAL = 'conditional',
}

export enum PaymentStatus {
  PAID = 'paid',
  PARTIAL = 'partial',
  DUE = 'due',
}

// Shared across Invoices, Quotations, and Delivery Notes.
export enum DeliveryMethod {
  ON_SITE = 'on_site', // delivered to the customer's location
  IN_STORE = 'in_store', // customer collects from the store/warehouse
}
