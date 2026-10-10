// issue date + the party's payment terms (days), or undefined without terms
export function dueFromTerms(fromDate: string, days: number | null | undefined): string | undefined {
  if (days === null || days === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) return undefined;
  const d = new Date(Date.UTC(+fromDate.slice(0, 4), +fromDate.slice(5, 7) - 1, +fromDate.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}
