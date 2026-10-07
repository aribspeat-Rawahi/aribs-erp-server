import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { VatPeriodService } from './vat-period.service';
import { FileVatPeriodDto, ReopenVatPeriodDto, VatPeriodSettingsDto } from './vat-period.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

const FILE_ROLES = [UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.CEO, UserRole.MD];
// reopening un-closes the books: management only
const REOPEN_ROLES = [UserRole.ADMIN, UserRole.CEO, UserRole.MD];

@ModuleAccess('accounting')
@Controller('vat-periods')
export class VatPeriodController {
  constructor(private service: VatPeriodService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Roles(...FILE_ROLES)
  @ModuleAccess('accounting', { strictRoles: true })
  @Put('settings')
  updateSettings(@Body() dto: VatPeriodSettingsDto, @Req() req: AuthedRequest) {
    return this.service.updateSettings(dto, { userId: req.user?.userId, email: req.user?.email });
  }

  @Roles(...FILE_ROLES)
  @ModuleAccess('accounting', { strictRoles: true })
  @Post('file')
  file(@Body() dto: FileVatPeriodDto, @Req() req: AuthedRequest) {
    return this.service.file(dto, { userId: req.user?.userId, email: req.user?.email });
  }

  @Roles(...REOPEN_ROLES)
  @ModuleAccess('accounting', { strictRoles: true })
  @Post(':id/reopen')
  reopen(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReopenVatPeriodDto, @Req() req: AuthedRequest) {
    return this.service.reopen(id, dto.reason, { userId: req.user?.userId, email: req.user?.email });
  }
}
