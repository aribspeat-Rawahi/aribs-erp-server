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
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { ReimbursementService } from './reimbursement.service';
import {
  CreateReimbursementDto,
  UpdateReimbursementDto,
  RejectReimbursementDto,
  MarkReimbursementPaidDto,
} from './dto/reimbursement.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

const ALLOWED_RECEIPT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const APPROVAL_ROLES = [UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.CEO, UserRole.MD];

@ModuleAccess('accounting')
@Controller('reimbursements')
export class ReimbursementController {
  constructor(private service: ReimbursementService) {}

  // Any authenticated staff member can view/submit claims on an
  // employee's behalf — approval/payout is what's gated below.
  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateReimbursementDto, @Req() req: AuthedRequest) {
    return this.service.create(dto, { userId: req.user?.userId, email: req.user?.email });
  }

  // Only while still pending — see ReimbursementService.update().
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateReimbursementDto) {
    return this.service.update(id, dto);
  }

  // Only while still pending — see ReimbursementService.remove().
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Roles(...APPROVAL_ROLES)
  @ModuleAccess('approvals')
  @Post(':id/approve')
  approve(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.approve(id, { userId: req.user?.userId, email: req.user?.email });
  }

  @Roles(...APPROVAL_ROLES)
  @ModuleAccess('approvals')
  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectReimbursementDto, @Req() req: AuthedRequest) {
    return this.service.reject(id, dto.reason, { userId: req.user?.userId, email: req.user?.email });
  }

  @Roles(...APPROVAL_ROLES)
  @ModuleAccess('approvals')
  @Post(':id/mark-paid')
  markPaid(@Param('id') id: string, @Body() dto: MarkReimbursementPaidDto, @Req() req: AuthedRequest) {
    return this.service.markPaid(id, dto, { userId: req.user?.userId, email: req.user?.email });
  }

  // Upload (or replace) the receipt scan for an already-saved claim.
  @Post(':id/receipt')
  @UseInterceptors(FileInterceptor('file'))
  uploadReceipt(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!ALLOWED_RECEIPT_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Receipt must be a PDF, PNG, or JPG file');
    }
    return this.service.saveReceiptFile(id, file);
  }

  // Protected route (default JWT guard applies, same as Invoice/Expense
  // files) — frontend fetches this as a blob rather than a plain <a href>.
  @Get(':id/receipt')
  async downloadReceipt(@Param('id') id: string, @Res() res: Response) {
    const filePath = await this.service.getReceiptFilePath(id);
    res.sendFile(filePath);
  }
}
