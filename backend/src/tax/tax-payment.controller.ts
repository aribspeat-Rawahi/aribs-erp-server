import { DocumentUpload } from '../common/upload';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { TaxPaymentService } from './tax-payment.service';
import { CreateTaxPaymentDto, UpdateTaxPaymentDto } from './dto/tax-payment.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

const ALLOWED_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const MANAGE_ROLES = [UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.CEO, UserRole.MD];

@ModuleAccess('accounting')
@Controller('tax-payments')
export class TaxPaymentController {
  constructor(private service: TaxPaymentService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Roles(...MANAGE_ROLES)
  @Post()
  create(@Body() dto: CreateTaxPaymentDto, @Req() req: AuthedRequest) {
    return this.service.create(dto, { userId: req.user?.userId, email: req.user?.email });
  }

  @Roles(...MANAGE_ROLES)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTaxPaymentDto, @Req() req: AuthedRequest) {
    return this.service.update(id, dto, { userId: req.user?.userId, email: req.user?.email });
  }

  @Roles(...MANAGE_ROLES)
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.remove(id, { userId: req.user?.userId, email: req.user?.email });
  }

  @Roles(...MANAGE_ROLES)
  @Post(':id/document')
  @UseInterceptors(DocumentUpload())
  uploadDocument(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Document must be a PDF, PNG, or JPG file');
    }
    return this.service.saveDocumentFile(id, file);
  }

  @Get(':id/document')
  async downloadDocument(@Param('id') id: string, @Res() res: Response) {
    const filePath = await this.service.getDocumentFilePath(id);
    res.sendFile(filePath);
  }
}
