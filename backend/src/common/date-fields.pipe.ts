import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

// Every date the API accepts is stored and compared as text YYYY-MM-DD
// (the closed-books check compares "2026-06-15" <= "2026-09-30"). A date
// written another way, e.g. "2026/06/15" or "2026-6-15", would slip past
// that check while the database still stores it as 15 June. So any request
// field named "date" or "...Date" must be YYYY-MM-DD (optionally followed
// by a time, "2026-06-15T10:00") and a real calendar date.
const DATE_KEY = /(^date$|Date$)/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(T.*)?$/;

function validDate(v: string): boolean {
  const m = DATE_RE.exec(v);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

function check(value: unknown, depth: number) {
  if (depth > 5 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const v of value) check(v, depth + 1);
    return;
  }
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (DATE_KEY.test(key) && typeof v === 'string' && v.trim() !== '' && !validDate(v.trim())) {
      throw new BadRequestException(`${key} must be a date written as YYYY-MM-DD (for example 2026-10-20).`);
    }
    if (v && typeof v === 'object') check(v, depth + 1);
  }
}

@Injectable()
export class DateFieldsPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.type === 'body' || metadata.type === 'query') {
      // @Query('startDate') hands over just the string
      if (typeof value === 'string' && metadata.data && DATE_KEY.test(metadata.data) && value.trim() !== '' && !validDate(value.trim())) {
        throw new BadRequestException(`${metadata.data} must be a date written as YYYY-MM-DD (for example 2026-10-20).`);
      }
      check(value, 0);
    }
    return value;
  }
}
