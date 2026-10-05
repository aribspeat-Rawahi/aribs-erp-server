import { BadRequestException, Body, Controller, Get, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { ImportService, UploadedSheet } from './import.service';
import { ImportType, MAX_IMPORT_BYTES } from './import-columns';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

const upload = FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } });

// Bulk Import (Excel/CSV). Each import is guarded by the module it writes
// to: the template needs view access, preview/import need edit access.
@Controller('import')
export class ImportController {
  constructor(private service: ImportService) {}

  private async sendTemplate(type: ImportType, res: Response) {
    const buffer = await this.service.buildTemplate(type);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="aribs-${type}-import-template.xlsx"`,
    });
    res.send(buffer);
  }

  private preview(type: ImportType, file?: UploadedSheet) {
    if (!file) throw new BadRequestException('Choose a file to upload.');
    return this.service.preview(type, file).then((p) => ({ ...p, rows: p.rows.map(({ values, ...r }) => r) }));
  }

  private commit(type: ImportType, file: UploadedSheet | undefined, skipErrors: unknown, req: AuthedRequest) {
    if (!file) throw new BadRequestException('Choose a file to upload.');
    return this.service.commit(type, file, skipErrors === true || skipErrors === 'true', { userId: req.user?.userId, email: req.user?.email });
  }

  @ModuleAccess('customers')
  @Get('customers/template')
  customersTemplate(@Res() res: Response) {
    return this.sendTemplate('customers', res);
  }
  @ModuleAccess('customers')
  @Post('customers/preview')
  @UseInterceptors(upload)
  customersPreview(@UploadedFile() file: UploadedSheet) {
    return this.preview('customers', file);
  }
  @ModuleAccess('customers')
  @Post('customers/commit')
  @UseInterceptors(upload)
  customersCommit(@UploadedFile() file: UploadedSheet, @Body('skipErrors') skipErrors: string, @Req() req: AuthedRequest) {
    return this.commit('customers', file, skipErrors, req);
  }

  @ModuleAccess('suppliers')
  @Get('suppliers/template')
  suppliersTemplate(@Res() res: Response) {
    return this.sendTemplate('suppliers', res);
  }
  @ModuleAccess('suppliers')
  @Post('suppliers/preview')
  @UseInterceptors(upload)
  suppliersPreview(@UploadedFile() file: UploadedSheet) {
    return this.preview('suppliers', file);
  }
  @ModuleAccess('suppliers')
  @Post('suppliers/commit')
  @UseInterceptors(upload)
  suppliersCommit(@UploadedFile() file: UploadedSheet, @Body('skipErrors') skipErrors: string, @Req() req: AuthedRequest) {
    return this.commit('suppliers', file, skipErrors, req);
  }

  @ModuleAccess('inventory')
  @Get('finished-goods/template')
  productsTemplate(@Res() res: Response) {
    return this.sendTemplate('finished-goods', res);
  }
  @ModuleAccess('inventory')
  @Post('finished-goods/preview')
  @UseInterceptors(upload)
  productsPreview(@UploadedFile() file: UploadedSheet) {
    return this.preview('finished-goods', file);
  }
  @ModuleAccess('inventory')
  @Post('finished-goods/commit')
  @UseInterceptors(upload)
  productsCommit(@UploadedFile() file: UploadedSheet, @Body('skipErrors') skipErrors: string, @Req() req: AuthedRequest) {
    return this.commit('finished-goods', file, skipErrors, req);
  }

  @ModuleAccess('inventory')
  @Get('raw-materials/template')
  materialsTemplate(@Res() res: Response) {
    return this.sendTemplate('raw-materials', res);
  }
  @ModuleAccess('inventory')
  @Post('raw-materials/preview')
  @UseInterceptors(upload)
  materialsPreview(@UploadedFile() file: UploadedSheet) {
    return this.preview('raw-materials', file);
  }
  @ModuleAccess('inventory')
  @Post('raw-materials/commit')
  @UseInterceptors(upload)
  materialsCommit(@UploadedFile() file: UploadedSheet, @Body('skipErrors') skipErrors: string, @Req() req: AuthedRequest) {
    return this.commit('raw-materials', file, skipErrors, req);
  }
}
