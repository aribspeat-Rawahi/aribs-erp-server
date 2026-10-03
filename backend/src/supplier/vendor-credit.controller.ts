import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { VendorCreditService } from './vendor-credit.service';
import { CreateVendorCreditDto, ApplyVendorCreditDto, RefundVendorCreditDto } from './dto/vendor-credit.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

const MANAGE_ROLES = [UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.CEO, UserRole.MD];

@ModuleAccess('suppliers')
@Controller('vendor-credits')
export class VendorCreditController {
  constructor(private service: VendorCreditService) {}

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
  create(@Body() dto: CreateVendorCreditDto, @Req() req: AuthedRequest) {
    return this.service.create(dto, { userId: req.user?.userId, email: req.user?.email });
  }

  @Roles(...MANAGE_ROLES)
  @Post(':id/apply')
  apply(@Param('id') id: string, @Body() dto: ApplyVendorCreditDto, @Req() req: AuthedRequest) {
    return this.service.apply(id, dto, { userId: req.user?.userId, email: req.user?.email });
  }

  @Roles(...MANAGE_ROLES)
  @Post(':id/refund')
  refund(@Param('id') id: string, @Body() dto: RefundVendorCreditDto, @Req() req: AuthedRequest) {
    return this.service.refund(id, dto, { userId: req.user?.userId, email: req.user?.email });
  }

  @Roles(...MANAGE_ROLES)
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.remove(id, { userId: req.user?.userId, email: req.user?.email });
  }
}
