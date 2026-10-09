import { DocumentUpload } from '../common/upload';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { EmployeeDocumentService } from './employee-document.service';
import { UploadEmployeeDocumentDto } from './dto/hr.dto';
import { ModuleAccess } from '../auth/module-access.decorator';

const ALLOWED_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

// All routes here are protected by the default JWT guard (nothing is
// @Public()) — these are sensitive personal documents (Residence ID,
// Passport, Visa, ...), not something to expose without login.
@ModuleAccess('hr')
@Controller('employees/:employeeId/documents')
export class EmployeeDocumentController {
  constructor(private service: EmployeeDocumentService) {}

  @Get()
  findAll(@Param('employeeId') employeeId: string) {
    return this.service.findByEmployee(employeeId);
  }

  @Post()
  @UseInterceptors(DocumentUpload())
  async upload(
    @Param('employeeId') employeeId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadEmployeeDocumentDto,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Document must be a PDF, PNG, or JPG file');
    }
    return this.service.upload(employeeId, dto.label, file);
  }

  // Frontend fetches this as a blob (same pattern as the expense invoice
  // and employee photo) since it's a protected route.
  @Get(':docId')
  async view(@Param('employeeId') employeeId: string, @Param('docId') docId: string, @Res() res: Response) {
    const { filePath } = await this.service.getFilePath(employeeId, docId);
    res.sendFile(filePath);
  }

  @Delete(':docId')
  remove(@Param('employeeId') employeeId: string, @Param('docId') docId: string) {
    return this.service.remove(employeeId, docId);
  }
}
