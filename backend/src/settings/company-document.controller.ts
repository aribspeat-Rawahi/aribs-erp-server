import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CompanyDocumentService } from './company-document.service';
import { UploadCompanyDocumentDto, UpdateCompanyDocumentDto } from './dto/settings.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

const ALLOWED_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

// Company-level document library (trade license, VAT certificate, etc.) —
// same restricted role set as SettingsController's update(), since these
// are official company papers, not something every user should manage.
@ModuleAccess('settings')
@Controller('settings/documents')
@Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD)
export class CompanyDocumentController {
  constructor(private service: CompanyDocumentService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: Express.Multer.File, @Body() dto: UploadCompanyDocumentDto) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Document must be a PDF, PNG, or JPG file');
    }
    return this.service.upload(dto.title, file);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCompanyDocumentDto) {
    return this.service.update(id, dto.title);
  }

  // Frontend fetches this as a blob (protected route) — see viewFile() in
  // the frontend's api/docActions.ts.
  @Get(':id')
  async view(@Param('id') id: string, @Res() res: Response) {
    const { filePath } = await this.service.getFilePath(id);
    res.sendFile(filePath);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
