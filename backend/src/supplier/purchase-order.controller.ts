import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PurchaseOrderService } from './purchase-order.service';
import { CreatePurchaseOrderDto, UpdatePurchaseOrderDto, ReceivePurchaseOrderDto } from './dto/supplier.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

const actorOf = (req: AuthedRequest) => ({ userId: req.user?.userId, email: req.user?.email, role: req.user?.role });

@ModuleAccess('suppliers')
@Controller('purchase-orders')
export class PurchaseOrderController {
  constructor(private service: PurchaseOrderService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  // Suppliers > Not Received Yet
  @Get('pending-receipts')
  findPendingReceipts() {
    return this.service.findPendingReceipts();
  }

  @Get(':id/pdf')
  async downloadPdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.service.generatePdf(id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="purchase-order-${id}.pdf"` });
    res.send(buffer);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // Goes for approval when Settings > Approval rules say so.
  @Post()
  create(@Body() dto: CreatePurchaseOrderDto, @Req() req: AuthedRequest) {
    return this.service.create(dto, actorOf(req));
  }

  // a rejected order, sent for approval again unchanged
  @Post(':id/resubmit')
  resubmit(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.resubmit(id, actorOf(req));
  }

  // Only while status is still "ordered" — see PurchaseOrderService.update().
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePurchaseOrderDto, @Req() req: AuthedRequest) {
    return this.service.update(id, dto, actorOf(req));
  }

  // Only while status is still "ordered" — see PurchaseOrderService.remove().
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  // Goods receipt (GRN): records what arrived - all of it, or part of it
  // (several deliveries per order). This is what adds raw material stock,
  // the payable and the input VAT. Admin and Accountant only.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Post(':id/receive')
  receive(@Param('id') id: string, @Body() dto: ReceivePurchaseOrderDto, @Req() req: AuthedRequest) {
    return this.service.receive(id, dto || {}, { userId: req.user?.userId, email: req.user?.email });
  }

  // The rest of a partially received order will not come.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Post(':id/close')
  closeShort(@Param('id') id: string) {
    return this.service.closeShort(id);
  }

  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }
}
