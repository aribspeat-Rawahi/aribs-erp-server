import { Logger } from '@nestjs/common';
import { reportError } from '../monitoring/error-alert';

const logger = new Logger('Background');

// Runs a side task (e.g. a notification email) AFTER the current request
// has done its real work, without making the user wait for it and without
// letting its failure turn a saved record into an error response.
// Failures are logged and sent as an error alert instead.
export function runInBackground(label: string, task: () => Promise<unknown>): void {
  setImmediate(() => {
    Promise.resolve()
      .then(task)
      .catch((err) => {
        logger.warn(`${label} failed: ${err?.message || err}`);
        reportError(`Background task failed: ${label}`, err);
      });
  });
}
