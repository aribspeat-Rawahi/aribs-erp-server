// Shared by RawMaterialBatch and FinishedGoodBatch (Batch/Lot Traceability).
// A given entity only ever uses the values that make sense for it:
// RawMaterialBatch -> PURCHASE_ORDER / MANUAL / OPENING_BALANCE
// FinishedGoodBatch -> PRODUCTION_ORDER / MANUAL / OPENING_BALANCE
export enum BatchSource {
  PURCHASE_ORDER = 'purchase_order',
  PRODUCTION_ORDER = 'production_order',
  // Created by a barcode/manual stock-in or stock-out that isn't tied to
  // a Purchase Order or Production Order (e.g. Inventory's "Scan stock").
  MANUAL = 'manual',
  // Auto-created the first time a material/product with pre-existing
  // stock (from before this feature existed) is consumed, so FIFO
  // tracking always has something to draw from. See
  // BatchTrackingService.ensure*OpeningBalance().
  OPENING_BALANCE = 'opening_balance',
}
