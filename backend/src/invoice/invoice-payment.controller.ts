import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { InvoicePaymentService } from './invoice-payment.service';
import { CreateInvoicePaymentDto } from './dto/invoice.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

// Protected by the default JWT guard — recording/removing payments is
// an accounting action, not something to expose without login.
@Controller('invoices/:invoiceId/payments')
export class InvoicePaymentController {
  constructor(private service: InvoicePaymentService) {}

  @Get()
  findAll(@Param('invoiceId') invoiceId: string) {
    return this.service.findByInvoice(invoiceId);
  }

  @Post()
  create(@Param('invoiceId') invoiceId: string, @Body() dto: CreateInvoicePaymentDto, @Req() req: AuthedRequest) {
    return this.service.create(invoiceId, dto, { userId: req.user?.userId, email: req.user?.email });
  }

  // Admin and Accountant — removing a recorded payment is a financial
  // correction, not something to expose to every role.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Delete(':paymentId')
  remove(@Param('invoiceId') invoiceId: string, @Param('paymentId') paymentId: string) {
    return this.service.remove(invoiceId, paymentId);
  }
}
