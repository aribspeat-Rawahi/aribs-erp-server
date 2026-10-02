import { BadRequestException, Controller, Get, Param, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { BackupService } from './backup.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

const MAX_RESTORE_FILE_BYTES = 100 * 1024 * 1024; // 100 MB — generous for a .sql text dump

@Controller('backup')
export class BackupController {
  constructor(
    private backupService: BackupService,
    private activityLog: ActivityLogService,
  ) {}

  // Admin-only — a full database dump is the most sensitive export this
  // app can produce (every customer, invoice, user password hash, etc.),
  // so it gets the narrowest role of anywhere in the app.
  @Roles(UserRole.ADMIN)
  @Get('download')
  async download(@Req() req: AuthedRequest, @Res() res: Response) {
    const dump = await this.backupService.createSqlDump();

    await this.activityLog.log({
      action: 'backup.downloaded',
      entityType: 'backup',
      userId: req.user?.userId,
      userEmail: req.user?.email,
      details: { filename: dump.filename },
    });

    res.set({
      'Content-Type': 'application/sql; charset=utf-8',
      'Content-Disposition': `attachment; filename="${dump.filename}"`,
    });
    res.send(dump.sql);
  }

  // DESTRUCTIVE — wipes every row currently in the database and replaces
  // it with the uploaded .sql dump's contents. Admin-only. The frontend
  // requires typing "RESTORE" to confirm before this is ever called.
  // BackupService always takes its own fresh safety backup of the
  // CURRENT data before touching anything, and auto-rolls back to it if
  // the restore itself fails — see backup.service.ts for the full flow.
  @Roles(UserRole.ADMIN)
  @Post('restore')
  @UseInterceptors(FileInterceptor('file'))
  async restore(@UploadedFile() file: Express.Multer.File, @Req() req: AuthedRequest) {
    if (!file) throw new BadRequestException('No backup file uploaded.');
    if (file.size > MAX_RESTORE_FILE_BYTES) {
      throw new BadRequestException('That file is larger than 100 MB — too large to be a normal backup for this app.');
    }
    if (!file.originalname.toLowerCase().endsWith('.sql')) {
      throw new BadRequestException('Please upload a .sql backup file (the same kind "Download Backup" produces).');
    }

    const sql = file.buffer.toString('utf8');
    const result = await this.backupService.restoreFromSqlDump(sql);

    await this.activityLog.log({
      action: 'backup.restored',
      entityType: 'backup',
      userId: req.user?.userId,
      userEmail: req.user?.email,
      details: { uploadedFilename: file.originalname, safetyBackupFilename: result.safetyBackupFilename },
    });

    return { restored: true, safetyBackupFilename: result.safetyBackupFilename };
  }

  // Lets an admin pull down the auto-safety-backup a restore made, in
  // case something looked wrong afterward and they want to double-check
  // or hand it to someone for manual recovery.
  @Roles(UserRole.ADMIN)
  @Get('safety/:filename')
  downloadSafetyBackup(@Param('filename') filename: string, @Res() res: Response) {
    const filePath = this.backupService.getSafetyBackupPath(filename);
    res.set({ 'Content-Type': 'application/sql; charset=utf-8' });
    res.download(filePath);
  }

  // The unattended nightly backups (see BackupService.runScheduledBackup) —
  // an admin can see what's on disk and pull any of them down without
  // needing server/FTP access.
  @Roles(UserRole.ADMIN)
  @Get('scheduled')
  listScheduled() {
    return this.backupService.listScheduledBackups();
  }

  @Roles(UserRole.ADMIN)
  @Get('scheduled/:filename')
  downloadScheduled(@Param('filename') filename: string, @Res() res: Response) {
    const filePath = this.backupService.getScheduledBackupPath(filename);
    res.set({ 'Content-Type': 'application/sql; charset=utf-8' });
    res.download(filePath);
  }
}
