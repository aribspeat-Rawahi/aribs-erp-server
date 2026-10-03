import * as path from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';

// Single source of truth for database settings, used by:
//  - the app (app.module.ts spreads these options), and
//  - the TypeORM CLI (npm run migration:generate / migration:run / ...).
//
// Schema changes are NEVER applied automatically from entities
// (synchronize is permanently off). Every change is a reviewed migration
// file in src/migrations, which the app runs on startup.
// MariaDB and MySQL report column metadata slightly differently (e.g.
// MariaDB returns DEFAULT 'NULL' for nullable columns). Using the wrong
// TypeORM driver makes it think hundreds of columns differ. The app detects
// the real server at startup (detectDatabaseType); the CLI uses DB_TYPE
// (default mariadb - what Hostinger and local dev run).
export type DatabaseType = 'mariadb' | 'mysql';

export function databaseOptions(
  env: NodeJS.ProcessEnv = process.env,
  type: DatabaseType = env.DB_TYPE === 'mysql' ? 'mysql' : 'mariadb',
): DataSourceOptions {
  return {
    type,
    host: env.DB_HOST,
    port: parseInt(env.DB_PORT || '3306', 10),
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_DATABASE,
    synchronize: false,
    // Compiled files in dist/ (this file lives at dist/data-source.js).
    entities: [path.join(__dirname, '**', '*.entity.js')],
    migrations: [path.join(__dirname, 'migrations', '*.js')],
    migrationsTableName: 'typeorm_migrations',
    // Each migration runs in its own transaction: if one fails, only that
    // one is rolled back and the app refuses to start (nothing half-done).
    migrationsTransactionMode: 'each',
  };
}

// Used only by the TypeORM CLI. Reads backend/.env when present (local
// development); on the server the values come from real environment
// variables.
function loadDotEnv() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    const file = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* .env is optional */
  }
}

// Asks the server which database it is ("10.11.14-MariaDB" / "8.0.36").
export async function detectDatabaseType(env: NodeJS.ProcessEnv = process.env): Promise<DatabaseType> {
  if (env.DB_TYPE === 'mysql' || env.DB_TYPE === 'mariadb') return env.DB_TYPE;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mysql = require('mysql2/promise');
  let conn: any;
  try {
    conn = await mysql.createConnection({
      host: env.DB_HOST,
      port: parseInt(env.DB_PORT || '3306', 10),
      user: env.DB_USERNAME,
      password: env.DB_PASSWORD,
      database: env.DB_DATABASE,
      connectTimeout: 10000,
    });
    const [rows] = await conn.query('SELECT VERSION() AS v');
    const version = String(rows?.[0]?.v || '');
    const type: DatabaseType = /mariadb/i.test(version) ? 'mariadb' : 'mysql';
    console.log(`[Database] Server version ${version} -> using TypeORM "${type}" driver`);
    return type;
  } catch (err) {
    // Connection problems are reported properly by TypeORM itself next.
    console.warn(`[Database] Could not detect server type (${(err as Error).message}); assuming mariadb`);
    return 'mariadb';
  } finally {
    if (conn) await conn.end().catch(() => undefined);
  }
}

// Our tables store UUID primary keys as varchar(36) (created that way on
// staging/production). On MariaDB >= 10.7 TypeORM would otherwise switch
// to the native "uuid" column type and try to rebuild every id column.
// Call this on every DataSource before initialize().
export function keepUuidAsVarchar(dataSource: DataSource): DataSource {
  Object.defineProperty(dataSource.driver, 'uuidColumnTypeSuported', {
    get: () => false,
    set: () => undefined,
    configurable: true,
  });
  return dataSource;
}

loadDotEnv();

export default keepUuidAsVarchar(new DataSource(databaseOptions()));
