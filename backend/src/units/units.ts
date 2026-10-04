import { BadRequestException } from '@nestjs/common';

// The only units used anywhere in the ERP (product setup, every document
// line, stock moves, PDFs). Must match frontend/src/utils/formatQuantity.ts.
//   pcs, bags        -> whole numbers only ("10")
//   kg, litre, ton   -> up to 3 decimals ("10.500")
export const UNITS = ['pcs', 'bags', 'kg', 'litre', 'ton'] as const;
export type Unit = (typeof UNITS)[number];

export const UNIT_LABELS: Record<Unit, string> = {
  pcs: 'Pcs',
  bags: 'Bags',
  kg: 'Kgs',
  litre: 'Litre',
  ton: 'Tons',
};

const DECIMAL_UNITS: Unit[] = ['kg', 'litre', 'ton'];

// Old free-text values (before the fixed list) -> the fixed list.
const SYNONYMS: Record<string, Unit> = {
  pc: 'pcs', pcs: 'pcs', piece: 'pcs', pieces: 'pcs', unit: 'pcs', units: 'pcs', nos: 'pcs', no: 'pcs', each: 'pcs',
  bag: 'bags', bags: 'bags', sack: 'bags', sacks: 'bags',
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  l: 'litre', lt: 'litre', ltr: 'litre', ltrs: 'litre', litre: 'litre', litres: 'litre', liter: 'litre', liters: 'litre',
  ton: 'ton', tons: 'ton', tonne: 'ton', tonnes: 'ton', mt: 'ton',
};

export function normalizeUnit(raw?: string | null): Unit {
  const key = String(raw || '').trim().toLowerCase();
  return SYNONYMS[key] || 'pcs';
}

export function isDecimalUnit(unit?: string | null): boolean {
  return DECIMAL_UNITS.includes(normalizeUnit(unit));
}

export function unitLabel(unit?: string | null): string {
  return UNIT_LABELS[normalizeUnit(unit)];
}

// "10" for pcs/bags, "10.500" for kg/litre/ton.
export function formatQty(quantity: number | string | null | undefined, unit?: string | null): string {
  const n = Number(quantity) || 0;
  return isDecimalUnit(unit) ? n.toFixed(3) : String(Math.round(n));
}

// "10 Bags", "2.500 Tons"
export function formatQtyWithUnit(quantity: number | string | null | undefined, unit?: string | null): string {
  return `${formatQty(quantity, unit)} ${unitLabel(unit)}`;
}

// null when fine, otherwise a user-facing reason.
export function quantityProblem(quantity: number, unit: string | null | undefined, what: string): string | null {
  const q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0) return `Quantity for ${what} must be more than 0.`;
  if (!isDecimalUnit(unit) && !Number.isInteger(q)) {
    return `Quantity for ${what} must be a whole number (${unitLabel(unit)} can't have decimals).`;
  }
  if (isDecimalUnit(unit) && Math.round(q * 1000) / 1000 !== q) {
    return `Quantity for ${what} can have at most 3 decimals.`;
  }
  return null;
}

// Throws a 400 with a clear message if the quantity doesn't fit the unit.
// allowZero: opening stock may be 0; allowNegative: stock corrections.
export function assertQuantityForUnit(
  quantity: number | string,
  unit: string | null | undefined,
  what: string,
  opts: { allowZero?: boolean; allowNegative?: boolean } = {},
): void {
  const q = Number(quantity);
  if (opts.allowNegative || (opts.allowZero && q === 0)) {
    const problem = quantityProblem(Math.abs(q) || 1, unit, what);
    if (problem && q !== 0) throw new BadRequestException(problem);
    return;
  }
  const problem = quantityProblem(q, unit, what);
  if (problem) throw new BadRequestException(problem);
}
