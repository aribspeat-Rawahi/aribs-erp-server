// Converts a decimal OMR amount into the "Rial Omani ... Baisa Only" wording
// used on Oman invoices/quotations/delivery notes. 3 decimal places = Baisa.

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
];

function twoDigitsToWords(n: number): string {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return ones ? `${TENS[tens]}-${ONES[ones]}` : TENS[tens];
}

function threeDigitsToWords(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(twoDigitsToWords(rest));
  return parts.join(' ');
}

function integerToWords(n: number): string {
  if (n === 0) return 'Zero';
  const groups: [number, string][] = [
    [1_000_000_000, 'Billion'],
    [1_000_000, 'Million'],
    [1_000, 'Thousand'],
    [1, ''],
  ];
  let remaining = n;
  const parts: string[] = [];
  for (const [value, label] of groups) {
    const count = Math.floor(remaining / value);
    if (count > 0) {
      parts.push(label ? `${threeDigitsToWords(count)} ${label}` : threeDigitsToWords(count));
      remaining %= value;
    }
  }
  return parts.join(' ').trim();
}

export function amountToOmaniWords(amount: number): string {
  const rounded = Math.round((amount || 0) * 1000) / 1000;
  const rials = Math.floor(rounded);
  const baisa = Math.round((rounded - rials) * 1000);
  const rialWords = integerToWords(rials);
  const rialLabel = rials === 1 ? 'Rial' : 'Rials';
  if (baisa === 0) {
    return `Rial Omani ${rialWords} ${rialLabel} Only`;
  }
  return `Rial Omani ${rialWords} ${rialLabel} and ${String(baisa).padStart(3, '0')} Baisa Only`;
}
