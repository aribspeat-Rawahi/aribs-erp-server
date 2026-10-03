import {
  Body,
  Controller,
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
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { ExpenseService } from './expense.service';
import { CreateExpenseDto, UpdateExpenseDto } from './dto/accounting.dto';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

const ALLOWED_INVOICE_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

@ModuleAccess('accounting')
@Controller('expenses')
export class ExpenseController {
  constructor(private service: ExpenseService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateExpenseDto, @Req() req: AuthedRequest) {
    return this.service.create(dto, { userId: req.user?.userId, email: req.user?.email });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateExpenseDto, @Req() req: AuthedRequest) {
    return this.service.update(id, dto, { userId: req.user?.userId, email: req.user?.email });
  }

  // Upload (or replace) the invoice scan/PDF for an already-saved expense.
  @Post(':id/invoice')
  @UseInterceptors(FileInterceptor('file'))
  uploadInvoice(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!ALLOWED_INVOICE_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Invoice must be a PDF, PNG, or JPG file');
    }
    return this.service.saveInvoiceFile(id, file);
  }

  // Protected route (default JWT guard applies, same as Invoice PDFs) —
  // frontend fetches this as a blob rather than a plain <a href>.
  @Get(':id/invoice')
  async downloadInvoice(@Param('id') id: string, @Res() res: Response) {
    const filePath = await this.service.getInvoiceFilePath(id);
    res.sendFile(filePath);
  }
}
