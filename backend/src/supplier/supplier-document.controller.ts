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
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { SupplierDocumentService } from './supplier-document.service';
import { UploadSupplierDocumentDto } from './dto/supplier.dto';

const ALLOWED_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

@Controller('suppliers/:supplierId/documents')
export class SupplierDocumentController {
  constructor(private service: SupplierDocumentService) {}

  @Get()
  findAll(@Param('supplierId') supplierId: string) {
    return this.service.findBySupplier(supplierId);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Param('supplierId') supplierId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadSupplierDocumentDto,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Document must be a PDF, PNG, or JPG file');
    }
    return this.service.upload(supplierId, dto.docType, file);
  }

  @Get(':docId')
  async view(@Param('supplierId') supplierId: string, @Param('docId') docId: string, @Res() res: Response) {
    const { filePath } = await this.service.getFilePath(supplierId, docId);
    res.sendFile(filePath);
  }

  @Delete(':docId')
  remove(@Param('supplierId') supplierId: string, @Param('docId') docId: string) {
    return this.service.remove(supplierId, docId);
  }
}
