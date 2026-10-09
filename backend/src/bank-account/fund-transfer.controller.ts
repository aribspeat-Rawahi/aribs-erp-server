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
import { FundTransferService } from './fund-transfer.service';
import { CreateFundTransferDto, UpdateFundTransferDto } from './dto/fund-transfer.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

const ALLOWED_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const MANAGE_ROLES = [UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.CEO, UserRole.MD];

// Cash/Bank fund transfers — reads open to any authenticated user (same
// convention as BankAccountController), writes restricted to
// accounting-facing roles since this moves real money between accounts.
@ModuleAccess('accounting')
@Controller('fund-transfers')
export class FundTransferController {
  constructor(private service: FundTransferService) {}

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
  create(@Body() dto: CreateFundTransferDto, @Req() req: AuthedRequest) {
    return this.service.create(dto, { userId: req.user?.userId, email: req.user?.email });
  }

  @Roles(...MANAGE_ROLES)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFundTransferDto, @Req() req: AuthedRequest) {
    return this.service.update(id, dto, { userId: req.user?.userId, email: req.user?.email });
  }

  // Confirms an "in transit" transfer has arrived — credits the
  // destination account, which create() deliberately left untouched.
  @Roles(...MANAGE_ROLES)
  @Patch(':id/clear')
  clear(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.clear(id, { userId: req.user?.userId, email: req.user?.email });
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

  // Protected route (default JWT guard applies) — frontend fetches this
  // as a blob rather than a plain <a href>, same as Expense/Reimbursement.
  @Get(':id/document')
  async downloadDocument(@Param('id') id: string, @Res() res: Response) {
    const filePath = await this.service.getDocumentFilePath(id);
    res.sendFile(filePath);
  }
}
