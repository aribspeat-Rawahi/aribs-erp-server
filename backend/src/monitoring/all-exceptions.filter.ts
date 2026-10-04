import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';
import { reportError } from './error-alert';

// Every API error still gets Nest's normal response; unexpected ones
// (server errors, not 4xx like "not found" or "no permission") are also
// emailed to the team with the request method/path and the user.
@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500 && host.getType() === 'http') {
      const req = host.switchToHttp().getRequest<Request & { user?: { email?: string; role?: string } }>();
      reportError('API error', exception, {
        Request: `${req.method} ${req.originalUrl?.split('?')[0]}`,
        Status: status,
        User: req.user?.email ? `${req.user.email} (${req.user.role})` : 'not signed in',
      });
    }
    super.catch(exception, host);
  }
}
