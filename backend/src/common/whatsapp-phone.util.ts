// Converts a phone number as typed in the ERP into the international,
// digits-only format WhatsApp links require (e.g. "9552 2725" ->
// "96895522725").
//
// Rules:
//  "+968 9552 2725" / "00968 9552 2725" -> already international, keep
//  "9552 2725" (8 digits, Oman local)   -> add the default country code
//  "09552 2725" (local with leading 0)  -> drop the 0, add the country code
//  "0968 9552 2725"                     -> drop the 0, already has a code
//  anything longer                      -> assume it already has a code
//
// Default country code comes from DEFAULT_PHONE_COUNTRY_CODE (default 968).
export function toWhatsappPhone(raw: string, defaultCountryCode = process.env.DEFAULT_PHONE_COUNTRY_CODE || '968'): string {
  const trimmed = String(raw || '').trim();
  const countryCode = String(defaultCountryCode).replace(/\D/g, '') || '968';

  if (trimmed.startsWith('+')) return trimmed.replace(/\D/g, '');

  const digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('00')) return digits.slice(2);
  // A single leading 0 is a local trunk prefix - drop it, then decide.
  const local = digits.replace(/^0+/, '');
  if (local.length <= 8) return countryCode + local;
  return local;
}
