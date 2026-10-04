import { Body, Controller, Delete, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SalesReturnService } from './sales-return.service';
import { ApproveSalesReturnDto, CreateSalesReturnDto, RejectSalesReturnDto } from './dto/sales-return.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

// Approving a return moves stock and money (credit note / refund), so only
// these roles can approve or reject - strictRoles: an admin grant of the
// Approvals module to another user does NOT unlock it. Everyone else with
// Invoices access can only request a return.
const MANAGE_ROLES = [UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.CEO, UserRole.MD];

@ModuleAccess('invoices')
@Controller('sales-returns')
export class SalesReturnController {
  constructor(private service: SalesReturnService) {}

  @ModuleAccess('invoices', { readAlso: ['accounting'] })

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // How approving would split the amount (credit on the invoice / refund).
  @Get(':id/settlement')
  getSettlement(@Param('id') id: string) {
    return this.service.getSettlement(id);
  }

  @Get(':id/pdf')
  async downloadPdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.service.generateCreditNotePdf(id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="credit-note-${id}.pdf"` });
    res.send(buffer);
  }

  @Post()
  create(@Body() dto: CreateSalesReturnDto, @Req() req: AuthedRequest) {
    return this.service.create(dto, { userId: req.user?.userId, email: req.user?.email });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Roles(...MANAGE_ROLES)
  @ModuleAccess('approvals', { strictRoles: true })
  @Post(':id/approve')
  approve(@Param('id') id: string, @Body() dto: ApproveSalesReturnDto, @Req() req: AuthedRequest) {
    return this.service.approve(id, { userId: req.user?.userId, email: req.user?.email }, { bankAccountId: dto?.bankAccountId });
  }

  @Roles(...MANAGE_ROLES)
  @ModuleAccess('approvals', { strictRoles: true })
  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectSalesReturnDto, @Req() req: AuthedRequest) {
    return this.service.reject(id, dto.reason, { userId: req.user?.userId, email: req.user?.email });
  }
}
