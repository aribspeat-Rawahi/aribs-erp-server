import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { OpeningBalanceService } from './opening-balance.service';
import { SaveOpeningLineDto, SetOpeningDateDto } from './opening-balance.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

// Opening balances are the whole starting position of the books: only
// these roles, and strictRoles so an Accounting grant to another user
// doesn't unlock them.
const MANAGE_ROLES = [UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.CEO, UserRole.MD];

@ModuleAccess('accounting')
@Controller('opening-balances')
export class OpeningBalanceController {
  constructor(private service: OpeningBalanceService) {}

  @Get()
  overview() {
    return this.service.getOverview();
  }

  @Roles(...MANAGE_ROLES)
  @ModuleAccess('accounting', { strictRoles: true })
  @Put('date')
  setDate(@Body() dto: SetOpeningDateDto, @Req() req: AuthedRequest) {
    return this.service.setDate(dto.openingBalanceDate, { userId: req.user?.userId, email: req.user?.email });
  }

  @Roles(...MANAGE_ROLES)
  @ModuleAccess('accounting', { strictRoles: true })
  @Post('lines')
  addLine(@Body() dto: SaveOpeningLineDto, @Req() req: AuthedRequest) {
    return this.service.saveLine(dto, { userId: req.user?.userId, email: req.user?.email });
  }

  @Roles(...MANAGE_ROLES)
  @ModuleAccess('accounting', { strictRoles: true })
  @Patch('lines/:id')
  updateLine(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveOpeningLineDto, @Req() req: AuthedRequest) {
    return this.service.saveLine(dto, { userId: req.user?.userId, email: req.user?.email }, id);
  }

  @Roles(...MANAGE_ROLES)
  @ModuleAccess('accounting', { strictRoles: true })
  @Delete('lines/:id')
  removeLine(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.removeLine(id);
  }

  @Roles(...MANAGE_ROLES)
  @ModuleAccess('accounting', { strictRoles: true })
  @Post('finalize')
  finalize(@Req() req: AuthedRequest) {
    return this.service.finalize({ userId: req.user?.userId, email: req.user?.email });
  }
}
