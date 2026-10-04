import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { pipeline } from 'stream/promises';
import * as tar from 'tar';
import { EmailService } from '../common/email.service';
import type { DatabaseDump } from './backup.service';

// Off-site copy of the nightly backup (Cloudflare R2 or any S3-compatible
// storage), so a problem with the hosting account can't take the data AND
// its backups at the same time.
//
// What gets uploaded, once a night (and from Settings > "Back up now"):
//   one file  <prefix>/aribs-erp-<timestamp>.tar.gz.enc  containing
//     database/<dump>.sql   - the full database dump
//     uploads/...           - every uploaded file (PDFs, employee documents,
//                             photos, logos...), minus the local backup folders
//
// The archive is encrypted HERE, before it leaves the server (AES-256-GCM,
// key derived from OFFSITE_BACKUP_PASSPHRASE with scrypt), so the storage
// provider only ever holds unreadable data. File layout:
//   "ARIBSBK1" (8 bytes) | salt (16) | iv (12) | ciphertext | auth tag (16)
// scripts/decrypt-offsite-backup.js turns it back into a .tar.gz.
//
// This service never deletes anything from the bucket: old copies are
// removed by the bucket's own lifecycle rule, and a bucket lock rule stops
// anyone holding the server's key from deleting recent backups.

export const OFFSITE_MAGIC = Buffer.from('ARIBSBK1', 'ascii');
const MIN_PASSPHRASE_LENGTH = 16;
const UPLOADS_DIR = 'uploads';
// Local backup folders are not part of the off-site archive (they're older
// copies of the same database).
const EXCLUDED_UPLOAD_FOLDERS = ['backup-auto', 'backup-safety'];
const WORK_DIR = '.offsite-backup-work';
const STATUS_FILE = path.join(UPLOADS_DIR, 'backup-auto', 'offsite-status.json');

export interface OffsiteBackupStatus {
  configured: boolean;
  missingSettings: string[];
  running: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFile: string | null;
  lastSizeBytes: number | null;
  lastError: string | null;
}

interface StoredStatus {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFile: string | null;
  lastSizeBytes: number | null;
  lastError: string | null;
}

interface OffsiteSettings {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  passphrase: string;
  prefix: string;
  region: string;
}

@Injectable()
export class OffsiteBackupService {
  private readonly logger = new Logger(OffsiteBackupService.name);
  private running = false;

  constructor(
    private config: ConfigService,
    private email: EmailService,
  ) {}

  private read(name: string): string {
    return (this.config.get<string>(name) || '').trim();
  }

  private settings(): { settings: OffsiteSettings | null; missing: string[] } {
    const values = {
      OFFSITE_BACKUP_ENDPOINT: this.read('OFFSITE_BACKUP_ENDPOINT'),
      OFFSITE_BACKUP_BUCKET: this.read('OFFSITE_BACKUP_BUCKET'),
      OFFSITE_BACKUP_ACCESS_KEY_ID: this.read('OFFSITE_BACKUP_ACCESS_KEY_ID'),
      OFFSITE_BACKUP_SECRET_ACCESS_KEY: this.read('OFFSITE_BACKUP_SECRET_ACCESS_KEY'),
      OFFSITE_BACKUP_PASSPHRASE: this.read('OFFSITE_BACKUP_PASSPHRASE'),
    };
    const missing = Object.entries(values)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (values.OFFSITE_BACKUP_PASSPHRASE && values.OFFSITE_BACKUP_PASSPHRASE.length < MIN_PASSPHRASE_LENGTH) {
      missing.push(`OFFSITE_BACKUP_PASSPHRASE (must be at least ${MIN_PASSPHRASE_LENGTH} characters)`);
    }
    if (missing.length) return { settings: null, missing };
    return {
      missing,
      settings: {
        endpoint: values.OFFSITE_BACKUP_ENDPOINT,
        bucket: values.OFFSITE_BACKUP_BUCKET,
        accessKeyId: values.OFFSITE_BACKUP_ACCESS_KEY_ID,
        secretAccessKey: values.OFFSITE_BACKUP_SECRET_ACCESS_KEY,
        passphrase: values.OFFSITE_BACKUP_PASSPHRASE,
        prefix: (this.read('OFFSITE_BACKUP_PREFIX') || 'erp').replace(/^\/+|\/+$/g, ''),
        region: this.read('OFFSITE_BACKUP_REGION') || 'auto',
      },
    };
  }

  isConfigured(): boolean {
    return this.settings().settings !== null;
  }

  isRunning(): boolean {
    return this.running;
  }

  private readStatus(): StoredStatus {
    try {
      return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    } catch {
      return { lastAttemptAt: null, lastSuccessAt: null, lastFile: null, lastSizeBytes: null, lastError: null };
    }
  }

  private writeStatus(status: StoredStatus): void {
    fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
    fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
  }

  getStatus(): OffsiteBackupStatus {
    const { settings, missing } = this.settings();
    return { configured: settings !== null, missingSettings: missing, running: this.running, ...this.readStatus() };
  }

  // Builds, encrypts and uploads one off-site backup. Never throws: the
  // result is recorded in the status file, and a failure sends an alert
  // email (OFFSITE_BACKUP_ALERT_EMAILS) so a broken backup is noticed.
  async run(dump: DatabaseDump): Promise<OffsiteBackupStatus> {
    const { settings } = this.settings();
    if (!settings) return this.getStatus(); // not set up on this server - nothing to do
    if (this.running) return this.getStatus();

    this.running = true;
    const previous = this.readStatus();
    const attemptAt = new Date().toISOString();
    this.writeStatus({ ...previous, lastAttemptAt: attemptAt, lastError: null });

    const stamp = attemptAt.replace(/[:.]/g, '-');
    const workDir = path.join(WORK_DIR, stamp);
    try {
      const encryptedPath = await this.buildEncryptedArchive(dump, workDir);
      const sizeBytes = fs.statSync(encryptedPath).size;
      const key = `${settings.prefix}/aribs-erp-${stamp}.tar.gz.enc`;
      await this.upload(settings, key, encryptedPath, sizeBytes);

      this.writeStatus({ lastAttemptAt: attemptAt, lastSuccessAt: new Date().toISOString(), lastFile: key, lastSizeBytes: sizeBytes, lastError: null });
      console.log(`[OffsiteBackup] Uploaded ${key} (${sizeBytes} bytes).`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.writeStatus({ ...previous, lastAttemptAt: attemptAt, lastError: message });
      console.error('[OffsiteBackup] Off-site backup failed:', message);
      await this.email
        .sendOffsiteBackupFailed(message, previous.lastSuccessAt)
        .catch((mailErr) => this.logger.error(`Could not send the backup alert email: ${mailErr?.message || mailErr}`));
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
      try {
        fs.rmdirSync(WORK_DIR); // only succeeds when empty
      } catch {
        // still has another run's folder, or already gone
      }
      this.running = false;
    }
    return this.getStatus();
  }

  private async buildEncryptedArchive(dump: DatabaseDump, workDir: string): Promise<string> {
    const { settings } = this.settings();
    if (!settings) throw new Error('Off-site backup is not configured.');

    fs.mkdirSync(path.join(workDir, 'database'), { recursive: true });
    fs.writeFileSync(path.join(workDir, 'database', path.basename(dump.filename)), dump.sql, 'utf8');

    // 1) plain tar: database/<dump>.sql, then uploads/... appended
    const tarPath = path.join(workDir, 'archive.tar');
    await tar.create({ file: tarPath, cwd: workDir, portable: true }, ['database']);
    if (fs.existsSync(UPLOADS_DIR)) {
      const excluded = EXCLUDED_UPLOAD_FOLDERS.map((f) => path.join(UPLOADS_DIR, f));
      await tar.replace(
        {
          file: tarPath,
          cwd: '.',
          portable: true,
          filter: (p: string) => !excluded.some((ex) => p === ex || p.startsWith(ex + path.sep) || p.startsWith(ex + '/')),
        },
        [UPLOADS_DIR],
      );
    }

    // 2) gzip + encrypt in one streaming pass
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = await new Promise<Buffer>((resolve, reject) =>
      crypto.scrypt(settings.passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, k) =>
        err ? reject(err) : resolve(k),
      ),
    );
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encryptedPath = path.join(workDir, 'archive.tar.gz.enc');
    const out = fs.createWriteStream(encryptedPath);
    out.write(Buffer.concat([OFFSITE_MAGIC, salt, iv]));
    await pipeline(fs.createReadStream(tarPath), zlib.createGzip({ level: 6 }), cipher, out, { end: false });
    await new Promise<void>((resolve, reject) => out.end(cipher.getAuthTag(), (err?: Error | null) => (err ? reject(err) : resolve())));
    fs.rmSync(tarPath, { force: true });
    return encryptedPath;
  }

  private async upload(settings: OffsiteSettings, key: string, filePath: string, sizeBytes: number): Promise<void> {
    const client = new S3Client({
      region: settings.region,
      endpoint: settings.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
      // Cloudflare R2 compatibility: only send checksums when required.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    try {
      await new Upload({
        client,
        params: {
          Bucket: settings.bucket,
          Key: key,
          Body: fs.createReadStream(filePath),
          ContentType: 'application/octet-stream',
        },
        queueSize: 2,
        partSize: 8 * 1024 * 1024,
      }).done();

      // Confirm the object really arrived complete.
      const head = await client.send(new HeadObjectCommand({ Bucket: settings.bucket, Key: key }));
      if (Number(head.ContentLength) !== sizeBytes) {
        throw new Error(`Uploaded size ${head.ContentLength} does not match the local file (${sizeBytes} bytes).`);
      }
    } finally {
      client.destroy();
    }
  }
}
