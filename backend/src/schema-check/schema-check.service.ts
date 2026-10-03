import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';

// Safety net, read-only: compares the real database with the entity
// definitions WITHOUT changing anything. If they differ, a code change is
// missing its migration.
//
// - Runs in the background AFTER startup, so it never delays the app
//   (Hostinger expects the app to start listening within ~3 seconds).
// - Logs with console.* because Hostinger's Runtime logs only show plain
//   console output, not NestJS logger lines.
@Injectable()
export class SchemaCheckService implements OnApplicationBootstrap {
  constructor(private readonly dataSource: DataSource) {}

  onApplicationBootstrap() {
    if (process.env.DB_SYNCHRONIZE) {
      console.warn(
        '[SchemaCheck] DB_SYNCHRONIZE is set but ignored - schema changes only happen through migrations. You can delete this environment variable.',
      );
    }
    // Deliberately not awaited: let the app finish starting first.
    setTimeout(() => void this.check(), 5000);
  }

  private async check() {
    try {
      const sql = await this.dataSource.driver.createSchemaBuilder().log();
      if (sql.upQueries.length === 0) {
        console.log('[SchemaCheck] Database schema matches the code.');
        return;
      }
      console.warn(
        `[SchemaCheck] WARNING: database schema differs from the code (${sql.upQueries.length} change(s) not covered by a migration). ` +
          'Nothing was changed automatically. First differences:',
      );
      for (const q of sql.upQueries.slice(0, 5)) console.warn(`[SchemaCheck]   ${q.query}`);
    } catch (err) {
      console.warn(`[SchemaCheck] Skipped: ${(err as Error).message}`);
    }
  }
}
