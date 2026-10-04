import { ConsoleLogger } from '@nestjs/common';
import { reportError } from './error-alert';

// Nest's normal console logger, plus: anything logged at "error" level
// (failed cron jobs, background tasks, startup problems) is emailed too.
// API request errors are reported by AllExceptionsFilter instead, so the
// "ExceptionsHandler" log line is skipped here to avoid double emails.
export class AlertingLogger extends ConsoleLogger {
  error(message: unknown, ...rest: unknown[]) {
    super.error(message, ...(rest as []));
    const context = typeof rest[rest.length - 1] === 'string' ? (rest[rest.length - 1] as string) : '';
    if (context === 'ExceptionsHandler') return;
    const stack = rest.find((r) => typeof r === 'string' && r.includes('\n    at ')) as string | undefined;
    const err = message instanceof Error ? message : Object.assign(new Error(String(message)), stack ? { stack } : {});
    reportError(context ? `Background error (${context})` : 'Background error', err);
  }
}
