// Must stay the first import: switches the working directory to DATA_DIR
// (if set) before any module computes its upload/backup folder.
import './data-dir';
import * as fs from 'fs';
import * as path from 'path';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DateFieldsPipe } from './common/date-fields.pipe';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import compression from 'compression';
import { AppModule } from './app.module';
import { AlertingLogger } from './monitoring/alerting-logger';
import { AllExceptionsFilter } from './monitoring/all-exceptions.filter';
import { installConsoleErrorAlerts, installProcessCrashAlerts } from './monitoring/error-alert';

// Every backend route lives under /api, so it can never collide with a
// frontend page that has the same path (e.g. page /invoices vs API
// /api/invoices) when both are served from the same domain.
const API_PREFIX = 'api';

// The built frontend (frontend/dist) is served by this same Node app, so
// one Hostinger deploy updates both. Override with FRONTEND_DIST_DIR if
// the build lives somewhere else.
function resolveFrontendDir(): string | null {
  const candidates = [
    process.env.FRONTEND_DIST_DIR,
    // backend/dist/main.js -> ../../frontend/dist
    path.join(__dirname, '..', '..', 'frontend', 'dist'),
  ].filter((p): p is string => Boolean(p && p.trim()));

  for (const dir of candidates) {
    const resolved = path.resolve(dir);
    if (fs.existsSync(path.join(resolved, 'index.html'))) return resolved;
  }
  return null;
}

async function bootstrap() {
  // Production errors are emailed to ERROR_ALERT_EMAILS (see monitoring/).
  installProcessCrashAlerts();
  installConsoleErrorAlerts();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: new AlertingLogger() });
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost).httpAdapter));
  // gzip API responses and frontend files (JSON lists shrink ~80-90%).
  // Already-compressed types (PDF, xlsx, images) are skipped by the filter;
  // responses under 1 KB are not worth compressing.
  app.use(compression({ threshold: 1024 }));
  app.setGlobalPrefix(API_PREFIX);
  // Behind Hostinger's proxy every request would look like it came from the
  // proxy - the login rate limit would then be shared by the whole company.
  // Trust one proxy hop (TRUST_PROXY=false to turn off, or a number/list).
  const trust = process.env.TRUST_PROXY ?? '1';
  app.set('trust proxy', trust === 'false' ? false : /^\d+$/.test(trust) ? Number(trust) : trust);
  // DateFieldsPipe first: dates must be YYYY-MM-DD before anything compares them
  app.useGlobalPipes(new DateFieldsPipe(), new ValidationPipe({ whitelist: true, transform: true }));

  const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS;
  app.enableCors({
    origin: allowedOrigins ? allowedOrigins.split(',').map((o) => o.trim()) : '*',
  });

  const frontendDir = resolveFrontendDir();
  if (frontendDir) {
    // Hashed build files (assets/index-abc123.js) never change content, so
    // they can be cached for a long time. index.html must never be cached,
    // otherwise browsers/apps would keep loading an old version after a
    // deploy.
    app.useStaticAssets(frontendDir, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    });

    // SPA fallback: any non-API GET that isn't a real file returns
    // index.html, so refreshing /invoices or opening a deep link works.
    const indexHtml = path.join(frontendDir, 'index.html');
    app.use((req: Request, res: Response, next: NextFunction) => {
      const isApi = req.path === `/${API_PREFIX}` || req.path.startsWith(`/${API_PREFIX}/`);
      if ((req.method !== 'GET' && req.method !== 'HEAD') || isApi) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
    console.log(`Serving frontend from ${frontendDir}`);
  } else {
    console.warn('Frontend build not found - serving API only.');
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`ERP backend running on port ${port} (API under /${API_PREFIX})`);
}
bootstrap();
