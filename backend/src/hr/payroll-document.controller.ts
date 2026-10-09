import { DocumentUpload } from '../common/upload';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { PayrollDocumentService } from './payroll-document.service';
import { UploadPayrollDocumentDto, UpdatePayrollDocumentDto } from './dto/payroll.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

const ALLOWED_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

// Payment-proof documents for a payroll row (bank transfer receipt, cash
// voucher, ...) — same role set as Payroll's own generate/update/mark-paid.
@ModuleAccess('hr')
@Controller('payroll/:payrollId/documents')
@Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
export class PayrollDocumentController {
  constructor(private service: PayrollDocumentService) {}

  @Get()
  findAll(@Param('payrollId') payrollId: string) {
    return this.service.findByPayroll(payrollId);
  }

  @Post()
  @UseInterceptors(DocumentUpload())
  async upload(
    @Param('payrollId') payrollId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadPayrollDocumentDto,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Document must be a PDF, PNG, or JPG file');
    }
    return this.service.upload(payrollId, dto.label, file);
  }

  @Patch(':docId')
  update(@Param('payrollId') payrollId: string, @Param('docId') docId: string, @Body() dto: UpdatePayrollDocumentDto) {
    return this.service.update(payrollId, docId, dto.label);
  }

  // Frontend fetches this as a blob (protected route) — see viewFile()
  // in the frontend's api/docActions.ts.
  @Get(':docId')
  async view(@Param('payrollId') payrollId: string, @Param('docId') docId: string, @Res() res: Response) {
    const { filePath } = await this.service.getFilePath(payrollId, docId);
    res.sendFile(filePath);
  }

  @Delete(':docId')
  remove(@Param('payrollId') payrollId: string, @Param('docId') docId: string) {
    return this.service.remove(payrollId, docId);
  }
}
