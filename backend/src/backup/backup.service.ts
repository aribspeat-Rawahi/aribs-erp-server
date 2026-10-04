import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';
import mysqldump from 'mysqldump';
import mysql, { Connection } from 'mysql2/promise';
import { OffsiteBackupService } from './offsite-backup.service';

export interface ScheduledBackupInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

export interface DatabaseDump {
  filename: string;
  sql: string;
}

export interface RestoreResult {
  safetyBackupFilename: string;
}

interface DbConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

// How many daily auto-backups to keep on disk before the oldest is deleted.
// At one per day this is roughly two weeks of history — enough to recover
// from a bad change noticed a few days late, without the backup folder
// growing forever on shared hosting's limited disk quota.
const SCHEDULED_BACKUP_RETENTION_COUNT = 14;

@Injectable()
export class BackupService {
  private backupDir: string;
  private scheduledBackupDir: string;

  constructor(
    private config: ConfigService,
    private offsite: OffsiteBackupService,
  ) {
    // Safety backups taken automatically right before a restore live here
    // (never the download-only backups from createSqlDump(), which are
    // never written to disk) — same uploads-folder convention as every
    // other document store in this app.
    this.backupDir = this.config.get<string>('BACKUP_SAFETY_DIR') || './uploads/backup-safety';
    fs.mkdirSync(this.backupDir, { recursive: true });

    // Separate folder for the unattended daily backup (see runScheduledBackup
    // below) — kept apart from the pre-restore safety backups above so the
    // two purposes (routine daily snapshot vs. just-in-case-restore-fails)
    // never get mixed up when browsing the server's files.
    this.scheduledBackupDir = this.config.get<string>('BACKUP_SCHEDULED_DIR') || './uploads/backup-auto';
    fs.mkdirSync(this.scheduledBackupDir, { recursive: true });
  }

  // Runs unattended every night — no admin action needed. Takes a full
  // dump the same way the "Download Backup" button does and writes it to
  // disk, then deletes the oldest file(s) beyond the retention count so
  // this folder never grows without bound. Any failure here (e.g. DB
  // briefly unreachable during a restart) is logged and swallowed rather
  // than crashing the app — a missed nightly backup should never take the
  // whole ERP down.
  @Cron('0 3 * * *') // 03:00 server time, every day
  async runScheduledBackup(): Promise<void> {
    try {
      const dump = await this.createSqlDump();
      const filePath = path.join(this.scheduledBackupDir, dump.filename);
      fs.writeFileSync(filePath, dump.sql, 'utf8');
      this.pruneOldScheduledBackups();
      // Then the encrypted off-site copy (only if OFFSITE_BACKUP_* is set;
      // records its own result and emails on failure, never throws).
      await this.offsite.run(dump);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        '[BackupService] Scheduled nightly backup failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  private pruneOldScheduledBackups(): void {
    const files = fs
      .readdirSync(this.scheduledBackupDir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(this.scheduledBackupDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    for (const stale of files.slice(SCHEDULED_BACKUP_RETENTION_COUNT)) {
      fs.unlinkSync(path.join(this.scheduledBackupDir, stale.name));
    }
  }

  // Lists the nightly auto-backups currently on disk, newest first, for
  // the Settings page to show an admin what's available to download.
  listScheduledBackups(): ScheduledBackupInfo[] {
    return fs
      .readdirSync(this.scheduledBackupDir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => {
        const stat = fs.statSync(path.join(this.scheduledBackupDir, f));
        return { filename: f, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // Same path-traversal protection as getSafetyBackupPath() below —
  // filenames only ever come from listScheduledBackups()'s own output.
  getScheduledBackupPath(filename: string): string {
    const safeName = path.basename(filename);
    const fullPath = path.join(this.scheduledBackupDir, safeName);
    if (!fs.existsSync(fullPath)) {
      throw new BadRequestException('Scheduled backup file not found.');
    }
    return fullPath;
  }

  private getConnectionConfig(): DbConnectionConfig {
    const host = this.config.get<string>('DB_HOST');
    const port = parseInt(this.config.get<string>('DB_PORT') || '3306', 10);
    const user = this.config.get<string>('DB_USERNAME');
    const password = this.config.get<string>('DB_PASSWORD');
    const database = this.config.get<string>('DB_DATABASE');

    if (!host || !user || !database) {
      throw new InternalServerErrorException('Database connection settings are missing — cannot reach the database.');
    }
    return { host, port, user, password: password || '', database };
  }

  // Produces one plain-text .sql dump (schema + data, in that order) of
  // the whole application database, using the SAME connection details
  // TypeOrmModule.forRootAsync() reads in app.module.ts — no separate
  // config to keep in sync. Runs over the existing `mysql2` driver via
  // the `mysqldump` package (pure JS query-based dump, not the `mysqldump`
  // shell binary) so it works on shared hosting where a shell dump tool
  // may not be installed or reachable. The dump lives only in memory and
  // is streamed straight to the caller — nothing is written to disk here
  // (a restore's own safety backup is the one exception — see below).
  async createSqlDump(): Promise<DatabaseDump> {
    const conn = this.getConnectionConfig();
    try {
      const result = await mysqldump({
        connection: conn,
        dump: { schema: { table: { ifNotExist: true } } },
      });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const header = `-- ARIBS ERP database backup\n-- Database: ${conn.database}\n-- Generated: ${new Date().toISOString()}\n\n`;
      return {
        filename: `erp-backup-${timestamp}.sql`,
        sql: header + (result.dump.schema || '') + '\n\n' + (result.dump.data || ''),
      };
    } catch (err) {
      throw new InternalServerErrorException(
        `Failed to create database backup: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }

  // Wipes every existing row (TRUNCATE, not DROP — table definitions stay,
  // so a dump's `CREATE TABLE IF NOT EXISTS` schema section is a no-op on
  // tables that already exist) and re-populates from `sql` — a dump this
  // same service produced (schema + INSERT statements). Runs as one
  // multi-statement script on a dedicated connection (TypeORM's own pool
  // isn't opened with `multipleStatements`, so a separate short-lived
  // connection is used for this one operation only).
  private async applySqlDump(sql: string, conn: DbConnectionConfig): Promise<void> {
    const connection: Connection = await mysql.createConnection({
      host: conn.host,
      port: conn.port,
      user: conn.user,
      password: conn.password,
      database: conn.database,
      multipleStatements: true,
    });
    try {
      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      const [tables] = await connection.query<any[]>(
        'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ?',
        [conn.database],
      );
      for (const { name } of tables as { name: string }[]) {
        await connection.query(`TRUNCATE TABLE \`${name}\``);
      }
      if (sql.trim()) {
        await connection.query(sql);
      }
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    } finally {
      await connection.end();
    }
  }

  // Restores the database from an uploaded .sql dump. Safety net, in this
  // order:
  //   1. Take a fresh backup of the CURRENT data and save it to disk
  //      (not just return it) — so it survives even if this whole
  //      operation fails partway through.
  //   2. Apply the uploaded dump (truncate + re-populate).
  //   3. If step 2 throws for ANY reason, automatically re-apply the
  //      safety backup from step 1 to put the database back the way it
  //      was, then report the original error — the caller never keeps a
  //      half-restored database silently.
  async restoreFromSqlDump(sql: string): Promise<RestoreResult> {
    const trimmed = sql.trim();
    if (!trimmed) {
      throw new BadRequestException('The uploaded file is empty.');
    }
    if (!/^--\s*ARIBS ERP database backup/.test(trimmed) && !/CREATE TABLE/i.test(trimmed)) {
      throw new BadRequestException(
        'This does not look like a database backup file — expected a .sql dump produced by this app\'s "Download Backup" button.',
      );
    }

    const conn = this.getConnectionConfig();

    const safetyDump = await this.createSqlDump();
    const safetyFilename = `pre-restore-${safetyDump.filename.replace(/^erp-backup-/, '')}`;
    const safetyPath = path.join(this.backupDir, safetyFilename);
    fs.writeFileSync(safetyPath, safetyDump.sql, 'utf8');

    try {
      await this.applySqlDump(trimmed, conn);
    } catch (restoreErr) {
      try {
        await this.applySqlDump(safetyDump.sql, conn);
      } catch (rollbackErr) {
        throw new InternalServerErrorException(
          `Restore failed AND the automatic rollback also failed — the database may be in a partial state. ` +
            `A safety backup from just before this attempt is saved on the server at "${safetyPath}". ` +
            `Restore that file manually as soon as possible. ` +
            `Original error: ${restoreErr instanceof Error ? restoreErr.message : restoreErr}. ` +
            `Rollback error: ${rollbackErr instanceof Error ? rollbackErr.message : rollbackErr}`,
        );
      }
      throw new BadRequestException(
        `Restore failed and was automatically rolled back — your data is unchanged. ` +
          `Error: ${restoreErr instanceof Error ? restoreErr.message : 'unknown error'}`,
      );
    }

    return { safetyBackupFilename: safetyFilename };
  }

  // Lets an admin download the auto-safety-backup a past restore made,
  // in case they need to double-check or manually recover from it.
  getSafetyBackupPath(filename: string): string {
    // Reject any path-traversal attempt outright — filenames here are
    // always ones this service itself generated, never user input echoed
    // back without checking.
    const safeName = path.basename(filename);
    const fullPath = path.join(this.backupDir, safeName);
    if (!fs.existsSync(fullPath)) {
      throw new BadRequestException('Safety backup file not found.');
    }
    return fullPath;
  }
}
