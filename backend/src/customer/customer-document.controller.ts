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
import { CustomerDocumentService } from './customer-document.service';
import { UploadCustomerDocumentDto } from './dto/customer.dto';
import { ModuleAccess } from '../auth/module-access.decorator';

const ALLOWED_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

// All routes here are protected by the default JWT guard — these are
// sensitive registration documents, not something to expose without login.
@ModuleAccess('customers')
@Controller('customers/:customerId/documents')
export class CustomerDocumentController {
  constructor(private service: CustomerDocumentService) {}

  @Get()
  findAll(@Param('customerId') customerId: string) {
    return this.service.findByCustomer(customerId);
  }

  @Post()
  @UseInterceptors(DocumentUpload())
  async upload(
    @Param('customerId') customerId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadCustomerDocumentDto,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Document must be a PDF, PNG, or JPG file');
    }
    return this.service.upload(customerId, dto.docType, file);
  }

  // Frontend fetches this as a blob (protected route).
  @Get(':docId')
  async view(@Param('customerId') customerId: string, @Param('docId') docId: string, @Res() res: Response) {
    const { filePath } = await this.service.getFilePath(customerId, docId);
    res.sendFile(filePath);
  }

  @Delete(':docId')
  remove(@Param('customerId') customerId: string, @Param('docId') docId: string) {
    return this.service.remove(customerId, docId);
  }
}
