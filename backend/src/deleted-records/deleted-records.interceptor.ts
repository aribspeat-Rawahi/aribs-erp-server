import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, catchError, from, mergeMap, throwError } from 'rxjs';
import { DeletionContext, deletionContext } from './deletion-context';
import { DeletedRecordsService } from './deleted-records.service';

// Wraps every DELETE request: rows removed and files discarded during the
// request are captured (deletion context), and when the delete succeeds
// it is recorded as proof, logged in the Activity Log and emailed - with
// an undo link where possible. A failed delete puts parked files back.
@Injectable()
export class DeletedRecordsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(DeletedRecordsInterceptor.name);

  constructor(private service: DeletedRecordsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    if (req.method !== 'DELETE') return next.handle();

    const ctx: DeletionContext = { rows: [], files: [], startedAt: new Date() };
    return new Observable((subscriber) => {
      deletionContext.run(ctx, () => {
        next
          .handle()
          .pipe(
            mergeMap((body) =>
              from(
                this.service
                  .record(req, ctx)
                  .catch((err) => this.logger.error(`Recording delete failed: ${err instanceof Error ? err.message : err}`))
                  .then(() => body),
              ),
            ),
            catchError((err) => {
              this.service.unparkFiles(ctx);
              return throwError(() => err);
            }),
          )
          .subscribe(subscriber);
      });
    });
  }
}
