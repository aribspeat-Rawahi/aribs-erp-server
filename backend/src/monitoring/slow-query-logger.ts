import { Logger as NestLogger } from '@nestjs/common';
import type { Logger as TypeOrmLogger } from 'typeorm';
import { reportError } from './error-alert';
import { omanToday } from '../common/oman-date';

// Queries slower than this (ms) are logged and emailed as an error alert.
// Override with SLOW_QUERY_MS (e.g. 2000) if it gets noisy.
export function slowQueryThresholdMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = parseInt(env.SLOW_QUERY_MS || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 1000;
}

// Own daily cap, so a burst of slow queries can never use up the shared
// alert-email budget and hide real errors.
const MAX_SLOW_QUERY_EMAILS_PER_DAY = 5;

// TypeORM calls logQuerySlow() for every query over maxQueryExecutionTime.
// Everything else stays silent, exactly like before (logging was off).
// Query parameters are NEVER logged or emailed - they can hold customer
// data or password hashes. Only the SQL text with "?" placeholders.
export class SlowQueryLogger implements TypeOrmLogger {
  private readonly logger = new NestLogger('SlowQuery');
  private emailDay = '';
  private emailsToday = 0;

  logQuerySlow(time: number, query: string): void {
    const sql = query.replace(/\s+/g, ' ').trim().slice(0, 1500);
    this.logger.warn(`${time} ms: ${sql}`);
    // Schema changes during a deploy (migrations) are expected to be slow.
    if (/^(CREATE|ALTER|DROP)\b/i.test(sql)) return;
    const today = omanToday();
    if (today !== this.emailDay) {
      this.emailDay = today;
      this.emailsToday = 0;
    }
    if (this.emailsToday >= MAX_SLOW_QUERY_EMAILS_PER_DAY) return;
    this.emailsToday += 1;
    // reportError groups identical queries (one email per hour) and caps
    // the number of alert emails per day.
    reportError('Slow database query', new Error(`Query took ${time} ms (limit ${slowQueryThresholdMs()} ms): ${sql}`), {
      durationMs: time,
    });
  }

  logQuery(): void {}
  logQueryError(): void {}
  logSchemaBuild(): void {}
  logMigration(): void {}
  log(): void {}
}
