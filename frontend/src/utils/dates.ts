// Calendar dates as YYYY-MM-DD in the user's LOCAL time zone (Oman, UTC+4).
// Never use date.toISOString().slice(0, 10) for this: it gives the UTC
// date, which is yesterday between 00:00 and 03:59 in Oman, and turns a
// local midnight (e.g. the 1st of the month) into the previous day.
export function localISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
