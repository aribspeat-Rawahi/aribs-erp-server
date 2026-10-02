import { PaymentStatus } from '../common/payment-type.enum';

// Shared by InvoiceService (when an invoice's total changes on edit) and
// InvoicePaymentService (when a payment is added/removed) so the two
// never disagree on how paidAmount vs total maps to a status. The 0.001
// tolerance matches the 3-decimal OMR precision used everywhere else in
// the invoice module, so a payment that exactly settles the balance
// isn't left showing "partial" over a floating-point sliver.
export function computePaymentStatus(paidAmount: number, total: number): PaymentStatus {
  if (paidAmount <= 0) return PaymentStatus.DUE;
  if (paidAmount >= total - 0.001) return PaymentStatus.PAID;
  return PaymentStatus.PARTIAL;
}
