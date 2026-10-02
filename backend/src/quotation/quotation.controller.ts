import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { QuotationService } from './quotation.service';
import { CreateQuotationDto, UpdateQuotationDto } from './dto/quotation.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

@Controller('quotations')
export class QuotationController {
  constructor(private service: QuotationService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  // Approvers (CEO/MD/Accountant/Admin) check this list to see what's
  // waiting on them. Placed before ':id' so it doesn't get swallowed by
  // that route.
  @Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD, UserRole.ACCOUNTANT)
  @Get('edit-requests')
  listPendingEdits() {
    return this.service.listPendingEdits();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/pdf')
  async downloadPdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.service.generatePdfBuffer(id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="quotation-${id}.pdf"` });
    res.send(buffer);
  }

  @Get(':id/whatsapp-link')
  getWhatsappLink(@Param('id') id: string) {
    return this.service.getWhatsappLink(id);
  }

  @Post()
  create(@Body() dto: CreateQuotationDto, @Req() req: AuthedRequest) {
    return this.service.create(dto, { requestedBy: { userId: req.user?.userId, email: req.user?.email } });
  }

  // Admin/CEO/MD/Accountant — approves or rejects a pending large-
  // discount ApprovalRequest, replaying the exact payload originally
  // submitted. Separate from the edit-requests endpoints below, which
  // handle the pre-existing different-day price-edit flow.
  @Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD, UserRole.ACCOUNTANT)
  @Post('approval-requests/:id/approve')
  approveRequest(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.applyApprovedQuotationRequest(id, { userId: req.user?.userId, email: req.user?.email });
  }

  @Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD, UserRole.ACCOUNTANT)
  @Post('approval-requests/:id/reject')
  rejectRequest(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.rejectQuotationApprovalRequest(id, { userId: req.user?.userId, email: req.user?.email });
  }

  // Same-day edit applies immediately. A different-day edit is queued
  // and returned as a pending edit request instead — check the
  // `applied` flag in the response to tell which happened.
  @Patch(':id')
  requestEdit(@Param('id') id: string, @Body() dto: UpdateQuotationDto, @Req() req: AuthedRequest) {
    return this.service.requestEdit(id, dto, { userId: req.user?.userId, email: req.user?.email });
  }

  @Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD, UserRole.ACCOUNTANT)
  @Post('edit-requests/:id/approve')
  approveEdit(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.approveEdit(id, { userId: req.user?.userId, email: req.user?.email });
  }

  @Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD, UserRole.ACCOUNTANT)
  @Post('edit-requests/:id/reject')
  rejectEdit(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.rejectEdit(id, { userId: req.user?.userId, email: req.user?.email });
  }

  @Post(':id/approve')
  approve(@Param('id') id: string) {
    return this.service.approve(id);
  }

  // One-click: quotation -> invoice.
  @Post(':id/convert-to-invoice')
  convertToInvoice(@Param('id') id: string) {
    return this.service.convertToInvoice(id);
  }

  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.remove(id, { userId: req.user?.userId, email: req.user?.email });
  }
}
