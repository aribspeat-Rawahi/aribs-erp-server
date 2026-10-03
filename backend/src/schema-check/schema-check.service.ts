import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';

// Safety net, read-only: after startup (and after migrations have run),
// compares the real database with the entity definitions WITHOUT changing
// anything. If they differ, a code change is missing its migration - the
// warning appears in Hostinger's Runtime logs so it's caught early.
@Injectable()
export class SchemaCheckService implements OnApplicationBootstrap {
  private readonly logger = new Logger('SchemaCheck');

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap() {
    if (process.env.DB_SYNCHRONIZE) {
      this.logger.warn(
        'DB_SYNCHRONIZE is set but is ignored now - schema changes only happen through migrations. You can delete this environment variable.',
      );
    }
    try {
      const sql = await this.dataSource.driver.createSchemaBuilder().log();
      if (sql.upQueries.length === 0) {
        this.logger.log('Database schema matches the code.');
        return;
      }
      this.logger.warn(
        `Database schema differs from the code (${sql.upQueries.length} change(s) not covered by a migration). ` +
          'A migration is missing - nothing was changed automatically. First differences:',
      );
      for (const q of sql.upQueries.slice(0, 5)) this.logger.warn(`  ${q.query}`);
    } catch (err) {
      this.logger.warn(`Schema check skipped: ${(err as Error).message}`);
    }
  }
}
