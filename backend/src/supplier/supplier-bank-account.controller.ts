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
import { SupplierBankAccountService } from './supplier-bank-account.service';
import { UpsertSupplierBankAccountDto } from './dto/supplier.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

const ALLOWED_STATEMENT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

@ModuleAccess('suppliers')
@Controller('suppliers/:supplierId/bank-accounts')
export class SupplierBankAccountController {
  constructor(private service: SupplierBankAccountService) {}

  @Get()
  findAll(@Param('supplierId') supplierId: string) {
    return this.service.findBySupplier(supplierId);
  }

  @Post()
  create(@Param('supplierId') supplierId: string, @Body() dto: UpsertSupplierBankAccountDto) {
    return this.service.create(supplierId, dto);
  }

  @Patch(':id')
  update(
    @Param('supplierId') supplierId: string,
    @Param('id') id: string,
    @Body() dto: UpsertSupplierBankAccountDto,
  ) {
    return this.service.update(supplierId, id, dto);
  }

  // Admin and Accountant — deleting a supplier's bank details isn't
  // something any role should be able to do casually.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Delete(':id')
  remove(@Param('supplierId') supplierId: string, @Param('id') id: string) {
    return this.service.remove(supplierId, id);
  }

  @Post(':id/statement')
  @UseInterceptors(DocumentUpload())
  async uploadStatement(
    @Param('supplierId') supplierId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!ALLOWED_STATEMENT_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Statement must be a PDF, PNG, or JPG file');
    }
    return this.service.uploadStatement(supplierId, id, file);
  }

  @Get(':id/statement')
  async viewStatement(@Param('supplierId') supplierId: string, @Param('id') id: string, @Res() res: Response) {
    const { filePath } = await this.service.getStatementFilePath(supplierId, id);
    res.sendFile(filePath);
  }
}
