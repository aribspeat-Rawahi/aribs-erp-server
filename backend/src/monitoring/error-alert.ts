import * as nodemailer from 'nodemailer';

// Emails the team when something breaks in production, so problems are
// known before a user complains. Used by the exception filter (API 500s),
// the app logger (cron jobs / background errors), process-level crash
// handlers and the frontend crash reporter.
//
// Deliberately a plain module (no Nest DI): it must work during startup and
// from the logger, before/outside the dependency-injection container.
//
// Noise control:
// - the same error (same kind + message + first stack line) is emailed at
//   most once per hour, with a count of how often it happened meanwhile;
// - at most MAX_PER_DAY alert emails per day.
// Only message, stack and request method/path/user are sent - never request
// bodies, headers, tokens or passwords.
//
// Settings: ERROR_ALERT_EMAILS (comma-separated; falls back to
// OFFSITE_BACKUP_ALERT_EMAILS) and the usual SMTP_* settings.

const REPEAT_WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_DAY = 30;

export interface AlertContext {
  [key: string]: string | number | null | undefined;
}

const lastSent = new Map<string, { at: number; suppressed: number }>();
let dayKey = '';
let sentToday = 0;
let warnedNoSetup = false;
let transporter: nodemailer.Transporter | null | undefined;

function recipients(): string[] {
  return (process.env.ERROR_ALERT_EMAILS || process.env.OFFSITE_BACKUP_ALERT_EMAILS || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
}

function getTransporter(): nodemailer.Transporter | null {
  if (transporter !== undefined) return transporter;
  const host = process.env.SMTP_HOST;
  transporter = host
    ? nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT || 587),
        secure: Number(process.env.SMTP_PORT) === 465,
        ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } } : {}),
      })
    : null;
  return transporter;
}

function errorParts(error: unknown): { message: string; stack: string } {
  if (error instanceof Error) return { message: error.message || error.name, stack: error.stack || '' };
  if (typeof error === 'string') return { message: error, stack: '' };
  try {
    return { message: JSON.stringify(error), stack: '' };
  } catch {
    return { message: String(error), stack: '' };
  }
}

// For Settings > "Send test email": sends one email right now (no
// grouping/limits) and reports exactly what went wrong if it can't.
export async function sendTestAlert(requestedBy: string): Promise<{ sentTo: string[] }> {
  const to = recipients();
  if (!to.length) throw new Error('No recipient set: add ERROR_ALERT_EMAILS on the hosting panel.');
  if (!process.env.SMTP_HOST) throw new Error('Email sending is not set up: add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS on the hosting panel.');
  const mailer = getTransporter();
  if (!mailer) throw new Error('Email sending is not set up.');
  await mailer.sendMail({
    from: process.env.SMTP_FROM || 'erp@aribs.net',
    to: to.join(','),
    subject: 'ARIBS ERP: test alert',
    text: [
      `Site: ${process.env.PUBLIC_BASE_URL || 'ERP server'}`,
      `Time: ${new Date().toISOString()}`,
      `Requested by: ${requestedBy}`,
      '',
      'Error alerts are working. You will get an email like this when something breaks.',
    ].join('\n'),
  });
  return { sentTo: to };
}

// Fire-and-forget: never throws, never blocks the caller.
export function reportError(kind: string, error: unknown, context: AlertContext = {}): void {
  void send(kind, error, context).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[ErrorAlert] Could not send the alert email:', err?.message || err);
  });
}

async function send(kind: string, error: unknown, context: AlertContext): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  const to = recipients();
  const mailer = getTransporter();
  if (!to.length || !mailer) {
    if (!warnedNoSetup) {
      warnedNoSetup = true;
      // eslint-disable-next-line no-console
      console.warn('[ErrorAlert] Error alerts are off: set ERROR_ALERT_EMAILS and SMTP_* to receive them.');
    }
    return;
  }

  const { message, stack } = errorParts(error);
  const firstFrame = stack.split('\n').find((l) => l.trim().startsWith('at ')) || '';
  // IDs and numbers are ignored when grouping, so "Retrying (1)", "Retrying (2)"
  // or the same failure on different invoices count as one error.
  const normalized = message
    .slice(0, 200)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\d+/g, '#');
  const signature = `${kind}|${normalized}|${firstFrame.trim()}`;
  const now = Date.now();

  const previous = lastSent.get(signature);
  if (previous && now - previous.at < REPEAT_WINDOW_MS) {
    previous.suppressed += 1;
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) {
    dayKey = today;
    sentToday = 0;
  }
  if (sentToday >= MAX_PER_DAY) return;
  sentToday += 1;

  const repeats = previous?.suppressed || 0;
  lastSent.set(signature, { at: now, suppressed: 0 });
  if (lastSent.size > 500) lastSent.clear(); // keep memory bounded

  const site = process.env.PUBLIC_BASE_URL || 'ERP server';
  const contextLines = Object.entries(context)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${String(v).slice(0, 300)}`);
  const body = [
    `Site: ${site}`,
    `Time: ${new Date().toISOString()}`,
    `Type: ${kind}`,
    ...contextLines,
    repeats ? `(This error also happened ${repeats} more time(s) in the last hour.)` : '',
    '',
    `Error: ${message.slice(0, 1000)}`,
    '',
    stack ? stack.split('\n').slice(0, 15).join('\n') : '(no stack trace)',
    '',
    'You get at most one email per hour for the same error.',
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n');

  await mailer.sendMail({
    from: process.env.SMTP_FROM || 'erp@aribs.net',
    to: to.join(','),
    subject: `ARIBS ERP error: ${kind} - ${message.slice(0, 80)}`,
    text: body,
  });
}

// Many services log failed side-tasks with console.error, e.g.
// "Auto-posting failed for invoice ...", meaning a journal entry was not
// created. Forward those too, so the books never silently drift.
// (Nest's own logger writes to stdout/stderr directly, so nothing is
// reported twice.)
const SKIP_CONSOLE_PREFIXES = ['[OffsiteBackup]']; // already emails on its own

export function installConsoleErrorAlerts(): void {
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    original(...args);
    try {
      const first = typeof args[0] === 'string' ? args[0] : '';
      if (SKIP_CONSOLE_PREFIXES.some((p) => first.startsWith(p))) return;
      const err = args.find((a) => a instanceof Error) as Error | undefined;
      const text = args
        .filter((a) => !(a instanceof Error))
        .map((a) => (typeof a === 'string' ? a : String(a)))
        .join(' ')
        .trim();
      const message = [text, err?.message].filter(Boolean).join(' ');
      reportError('Logged error', Object.assign(new Error(message || 'Unknown error'), err?.stack ? { stack: err.stack } : {}));
    } catch {
      // never let alerting break logging
    }
  };
}

export function installProcessCrashAlerts(): void {
  process.on('unhandledRejection', (reason) => reportError('Unhandled promise rejection', reason));
  process.on('uncaughtException', (err) => {
    // eslint-disable-next-line no-console
    console.warn('[ErrorAlert] Uncaught exception - the app will restart:', err);
    reportError('Uncaught exception (app restarted)', err);
    // Same as Node's default: don't keep running in an unknown state. Give
    // the alert email a few seconds, then exit (the host restarts the app).
    setTimeout(() => process.exit(1), 4000).unref();
  });
}
