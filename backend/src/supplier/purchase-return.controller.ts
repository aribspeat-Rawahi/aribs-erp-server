import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PurchaseReturnService } from './purchase-return.service';
import { CreatePurchaseReturnDto, RejectPurchaseReturnDto } from './dto/purchase-return.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

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

  @Post()
  create(@Body() dto: CreatePurchaseReturnDto, @Req() req: AuthedRequest) {
    return this.service.create(dto, { userId: req.user?.userId, email: req.user?.email });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Roles(...MANAGE_ROLES)
  @ModuleAccess('approvals')
  @Post(':id/approve')
  approve(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.approve(id, { userId: req.user?.userId, email: req.user?.email });
  }

  @Roles(...MANAGE_ROLES)
  @ModuleAccess('approvals')
  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectPurchaseReturnDto, @Req() req: AuthedRequest) {
    return this.service.reject(id, dto.reason, { userId: req.user?.userId, email: req.user?.email });
  }
}
