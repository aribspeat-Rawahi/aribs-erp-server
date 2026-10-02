// Shared helper for displaying/typing a "quantity" (as opposed to money,
// which always stays 3-decimal OMR) against a RawMaterial/FinishedGood's
// free-text `unit` field (e.g. "kg", "pcs", "ltr", "meter" — there's no
// fixed enum, whatever the admin typed when creating the item).
//
// Weight/volume units are continuous measures — fractional amounts are
// normal ("1.500 kg") — so they keep 3-decimal display and free decimal
// entry. Everything else (pcs, box, roll, bag, unit, meter, ...) is
// treated as a count of solid pieces — shown as a whole number ("1", "2",
// "3") and, in an input, restricted to whole-number entry.
const DECIMAL_UNIT_TOKENS = new Set([
  'kg',
  'kgs',
  'kilogram',
  'kilograms',
  'kilo',
  'kilos',
  'g',
  'gm',
  'gms',
  'gram',
  'grams',
  'ton',
  'tons',
  'tonne',
  'tonnes',
  'l',
  'ltr',
  'ltrs',
  'litre',
  'litres',
  'liter',
  'liters',
  'ml',
  'mls',
]);

export function isDecimalUnit(unit?: string | null): boolean {
  if (!unit) return false;
  return DECIMAL_UNIT_TOKENS.has(unit.trim().toLowerCase());
}

// Display formatting: "1.500" for weight/volume units, "1" for piece units.
export function formatQuantity(qty: number | string | null | undefined, unit?: string | null): string {
  const n = Number(qty) || 0;
  return isDecimalUnit(unit) ? n.toFixed(3) : String(Math.round(n));
}

// `step`/`min` for a quantity <input type="number">: fractional entry for
// weight/volume units, whole numbers only for piece-based units.
export function quantityInputStep(unit?: string | null): string {
  return isDecimalUnit(unit) ? '0.001' : '1';
}

export function quantityInputMin(unit?: string | null): string {
  return isDecimalUnit(unit) ? '0.001' : '1';
}

// Snaps a typed/pasted quantity to its unit's granularity — call this in
// an onChange/onBlur handler so a piece-based item can't end up with a
// fractional quantity (e.g. someone pastes "2.5") while a weight/volume
// item is left untouched.
export function snapQuantityToUnit(qty: number, unit?: string | null): number {
  return isDecimalUnit(unit) ? qty : Math.round(qty);
}
