// The ERP's fixed unit list - same as backend/src/units/units.ts.
// A product's unit is chosen once in the product form; every document line
// for that product (quotation, invoice, delivery note, sales order, ...)
// takes it automatically.
//   Pcs, Bags         -> whole numbers only ("10")
//   Kgs, Litre, Tons  -> up to 3 decimals ("10.500")
export const UNIT_OPTIONS = [
  { value: 'pcs', label: 'Pcs' },
  { value: 'bags', label: 'Bags' },
  { value: 'kg', label: 'Kgs' },
  { value: 'litre', label: 'Litre' },
  { value: 'ton', label: 'Tons' },
] as const;

export type UnitValue = (typeof UNIT_OPTIONS)[number]['value'];

// Old free-text values (from before the fixed list) map onto the list.
const SYNONYMS: Record<string, UnitValue> = {
  pc: 'pcs', pcs: 'pcs', piece: 'pcs', pieces: 'pcs', unit: 'pcs', units: 'pcs', nos: 'pcs', no: 'pcs', each: 'pcs',
  bag: 'bags', bags: 'bags', sack: 'bags', sacks: 'bags',
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  l: 'litre', lt: 'litre', ltr: 'litre', ltrs: 'litre', litre: 'litre', litres: 'litre', liter: 'litre', liters: 'litre',
  ton: 'ton', tons: 'ton', tonne: 'ton', tonnes: 'ton', mt: 'ton',
};

const DECIMAL_UNITS: UnitValue[] = ['kg', 'litre', 'ton'];

export function normalizeUnit(unit?: string | null): UnitValue {
  return SYNONYMS[String(unit || '').trim().toLowerCase()] || 'pcs';
}

export function isDecimalUnit(unit?: string | null): boolean {
  return DECIMAL_UNITS.includes(normalizeUnit(unit));
}

// "Pcs", "Bags", "Kgs", "Litre", "Tons"
export function unitLabel(unit?: string | null): string {
  const value = normalizeUnit(unit);
  return UNIT_OPTIONS.find((u) => u.value === value)?.label || 'Pcs';
}

// Display: "10" for Pcs/Bags, "10.500" for Kgs/Litre/Tons.
export function formatQuantity(qty: number | string | null | undefined, unit?: string | null): string {
  const n = Number(qty) || 0;
  return isDecimalUnit(unit) ? n.toFixed(3) : String(Math.round(n));
}

// Display with the unit: "10 Bags", "2.500 Tons".
export function formatQuantityWithUnit(qty: number | string | null | undefined, unit?: string | null): string {
  return `${formatQuantity(qty, unit)} ${unitLabel(unit)}`;
}

// Value to put in a quantity <input> when editing an existing line:
// "10" (not "10.000") for Pcs/Bags; "10.5" for Kgs/Litre/Tons.
export function quantityInputValue(qty: number | string | null | undefined, unit?: string | null): string {
  const n = Number(qty) || 0;
  return isDecimalUnit(unit) ? String(Math.round(n * 1000) / 1000) : String(Math.round(n));
}

// `step` / `min` for a quantity <input type="number">.
export function quantityInputStep(unit?: string | null): string {
  return isDecimalUnit(unit) ? '0.001' : '1';
}

export function quantityInputMin(unit?: string | null): string {
  return isDecimalUnit(unit) ? '0.001' : '1';
}

// Snaps a typed/pasted quantity to the unit (whole numbers for Pcs/Bags,
// max 3 decimals otherwise) - use in onBlur.
export function snapQuantityToUnit(qty: number, unit?: string | null): number {
  return isDecimalUnit(unit) ? Math.round(qty * 1000) / 1000 : Math.round(qty);
}
