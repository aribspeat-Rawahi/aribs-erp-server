import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { InvoiceService } from './invoice.service';
import { PaymentReminderService } from './payment-reminder.service';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

@Controller('invoices')
export class InvoiceController {
  constructor(
    private service: InvoiceService,
    private reminderService: PaymentReminderService,
  ) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // Feeds the "Available Credit" line on the Customer detail screen —
  // separate from :id above since a customerId isn't an invoice id.
  @Get('customer/:customerId/outstanding-balance')
  async getOutstandingBalance(@Param('customerId') customerId: string) {
    return { outstanding: await this.service.getOutstandingBalance(customerId) };
  }

  // Streams a fresh "Statement of Account" PDF for the given date range —
  // not persisted to disk, since it's regenerated per request.
  @Get('customer/:customerId/statement')
  async getCustomerStatement(
    @Param('customerId') customerId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Res() res: Response,
  ) {
    const { buffer, customerName } = await this.service.generateCustomerStatement(customerId, startDate, endDate);
    const safeName = customerName.replace(/[^a-zA-Z0-9]+/g, '_');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Statement-${safeName}-${startDate}_to_${endDate}.pdf"`,
    });
    res.send(buffer);
  }

  @Post()
  create(@Body() dto: CreateInvoiceDto, @Req() req: AuthedRequest) {
    return this.service.create(dto, { requestedBy: { userId: req.user?.userId, email: req.user?.email } });
  }

  // Same-day edit -> overwrites PDF, keeps version.
  // Different-day edit -> new version, old PDF kept.
  // Either can instead come back as { pendingApproval: true } if it hits
  // a credit-limit/large-discount/VAT-exclude gate — see CRM Step 7.
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateInvoiceDto, @Req() req: AuthedRequest) {
    return this.service.update(id, dto, { requestedBy: { userId: req.user?.userId, email: req.user?.email } });
  }

  // Admin/CEO/MD/Accountant — approves or rejects a pending
  // ApprovalRequest (credit limit / large discount / VAT exclude),
  // replaying the exact payload that was originally submitted.
  @Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD, UserRole.ACCOUNTANT)
  @Post('approval-requests/:id/approve')
  approveRequest(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.applyApprovedInvoiceRequest(id, { userId: req.user?.userId, email: req.user?.email });
  }

  @Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD, UserRole.ACCOUNTANT)
  @Post('approval-requests/:id/reject')
  rejectRequest(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.rejectInvoiceApprovalRequest(id, { userId: req.user?.userId, email: req.user?.email });
  }

  @Get(':id/pdf')
  async downloadPdf(@Param('id') id: string, @Res() res: Response) {
    const filePath = await this.service.getPdfPath(id);
    res.download(filePath);
  }

  @Get(':id/whatsapp-link')
  getWhatsappLink(@Param('id') id: string) {
    return this.service.getWhatsappLink(id);
  }

  // Manual "Send Reminder Now" — bypasses the daily cron's once-per-
  // milestone dedupe so it can always be sent on demand.
  @Post(':id/send-reminder')
  sendReminder(@Param('id') id: string) {
    return this.reminderService.sendManualReminder(id);
  }

  // One-click: invoice -> delivery note.
  @Post(':id/convert-to-delivery-note')
  convertToDeliveryNote(@Param('id') id: string) {
    return this.service.convertToDeliveryNote(id);
  }

  // Admin and Accountant — deleting a real financial document isn't
  // something any role should be able to do casually.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.remove(id, { userId: req.user?.userId, email: req.user?.email });
  }
}
