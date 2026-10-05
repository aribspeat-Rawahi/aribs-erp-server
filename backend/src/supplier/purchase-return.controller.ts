import { Body, Controller, Delete, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PurchaseReturnService } from './purchase-return.service';
import { ApprovePurchaseReturnDto, CreatePurchaseReturnDto, RejectPurchaseReturnDto } from './dto/purchase-return.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

// Approving moves stock and money (debit note / refund): only these roles,
// strictRoles - an Approvals grant to another user doesn't unlock it.
const MANAGE_ROLES = [UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.CEO, UserRole.MD];

@ModuleAccess('suppliers')
@Controller('purchase-returns')
export class PurchaseReturnController {
  constructor(private service: PurchaseReturnService) {}

  @ModuleAccess('suppliers', { readAlso: ['accounting'] })

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // How approving would split the amount (debit note on the order / refund).
  @Get(':id/settlement')
  getSettlement(@Param('id') id: string) {
    return this.service.getSettlement(id);
  }

  @Get(':id/pdf')
  async downloadPdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.service.generateDebitNotePdf(id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="debit-note-${id}.pdf"` });
    res.send(buffer);
  }

  @Post()
  create(@Body() dto: CreatePurchaseReturnDto, @Req() req: AuthedRequest) {
    return this.service.create(dto, { userId: req.user?.userId, email: req.user?.email });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Roles(...MANAGE_ROLES)
  @ModuleAccess('approvals', { strictRoles: true })
  @Post(':id/approve')
  approve(@Param('id') id: string, @Body() dto: ApprovePurchaseReturnDto, @Req() req: AuthedRequest) {
    return this.service.approve(id, { userId: req.user?.userId, email: req.user?.email }, { bankAccountId: dto?.bankAccountId });
  }

  @Roles(...MANAGE_ROLES)
  @ModuleAccess('approvals', { strictRoles: true })
  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectPurchaseReturnDto, @Req() req: AuthedRequest) {
    return this.service.reject(id, dto.reason, { userId: req.user?.userId, email: req.user?.email });
  }
}
