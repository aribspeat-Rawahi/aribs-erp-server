// The business runs on Oman time (Asia/Muscat, UTC+4, no daylight saving).
// Server clocks are UTC, so new Date().toISOString().slice(0, 10) is
// YESTERDAY between 00:00 and 03:59 in Oman - wrong document dates, wrong
// VAT quarter on the first night of a quarter, and false date-lock errors.
const OMAN = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat', year: 'numeric', month: '2-digit', day: '2-digit' });

// Calendar date (YYYY-MM-DD) in Oman of the given moment (default: now).
export function omanDate(at: Date | string | number = new Date()): string {
  return OMAN.format(at instanceof Date ? at : new Date(at));
}

// Today's date in Oman, YYYY-MM-DD.
export function omanToday(): string {
  return omanDate(new Date());
}
