// Shared between Customer and Supplier interaction logs (CRM Step 6) —
// same set of categories either way, so kept in one place like
// PaymentType/DeliveryMethod rather than duplicated per module.
export enum InteractionType {
  CALL = 'call',
  MEETING = 'meeting',
  EMAIL = 'email',
  WHATSAPP = 'whatsapp',
  NOTE = 'note',
  OTHER = 'other',
}
