import { AsyncLocalStorage } from 'async_hooks';

// One DELETE request in progress. DeletedRecordsInterceptor opens it;
// DeletionCaptureSubscriber adds every row TypeORM removes during the
// request; discardFile() parks deleted files so an undo can bring them
// back. Code outside a DELETE request (cron jobs, edits) has no context
// and behaves exactly as before.
export interface CapturedRow {
  entity: string; // entity class name (TypeORM metadata name)
  table: string;
  data: Record<string, unknown>;
}

export interface DeletionContext {
  rows: CapturedRow[];
  files: { from: string; to: string }[];
  // set by a service when the delete had side effects that a plain
  // restore could not put back (e.g. stock was returned)
  notRestorableReason?: string;
  startedAt: Date;
}

export const deletionContext = new AsyncLocalStorage<DeletionContext>();

export function markNotRestorable(reason: string) {
  const ctx = deletionContext.getStore();
  if (ctx) ctx.notRestorableReason = reason;
}
