import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { JournalImportService } from './journal-import.service';
import { UploadedSheet } from './import.service';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

const upload = FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

// Accounting > Journals > Import - same roles as manual journal entries.
@ModuleAccess('accounting')
@Controller('journal-imports')
@Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.CEO, UserRole.MD)
export class JournalImportController {
  constructor(private service: JournalImportService) {}

  @Get('template')
  async template(@Res() res: Response) {
    const buffer = await this.service.buildTemplate();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="aribs-journal-import-template.xlsx"',
    });
    res.send(buffer);
  }

  @Get()
  list() {
    return this.service.list();
  }

  @Post('preview')
  @UseInterceptors(upload)
  preview(@UploadedFile() file: UploadedSheet) {
    if (!file) throw new BadRequestException('Choose a file to upload.');
    return this.service.preview(file);
  }

  @Put('mappings')
  saveMappings(@Body('mappings') mappings: { name: string; accountId: string }[]) {
    return this.service.saveMappings(mappings);
  }

  @Post()
  @UseInterceptors(upload)
  commit(@UploadedFile() file: UploadedSheet, @Req() req: AuthedRequest) {
    if (!file) throw new BadRequestException('Choose a file to upload.');
    return this.service.commit(file, { userId: req.user?.userId, email: req.user?.email });
  }

  @Delete(':id')
  undo(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.undo(id, { userId: req.user?.userId, email: req.user?.email });
  }
}
