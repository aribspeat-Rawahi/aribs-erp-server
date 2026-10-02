import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SupplierPaymentService } from './supplier-payment.service';
import { CreateSupplierPaymentDto } from './dto/supplier.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

// Protected by the default JWT guard — recording/removing payments is
// an accounting action, not something to expose without login.
@Controller('purchase-orders/:purchaseOrderId/payments')
export class SupplierPaymentController {
  constructor(private service: SupplierPaymentService) {}

  @Get()
  findAll(@Param('purchaseOrderId') purchaseOrderId: string) {
    return this.service.findByOrder(purchaseOrderId);
  }

  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Post()
  create(@Param('purchaseOrderId') purchaseOrderId: string, @Body() dto: CreateSupplierPaymentDto, @Req() req: AuthedRequest) {
    return this.service.create(purchaseOrderId, dto, { userId: req.user?.userId, email: req.user?.email });
  }

  // Admin and Accountant — removing a recorded payment is a financial
  // correction, not something to expose to every role.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Delete(':paymentId')
  remove(@Param('purchaseOrderId') purchaseOrderId: string, @Param('paymentId') paymentId: string) {
    return this.service.remove(purchaseOrderId, paymentId);
  }
}
