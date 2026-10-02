import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { FixedAssetService } from './fixed-asset.service';
import { CreateFixedAssetDto, UpdateFixedAssetDto, DisposeFixedAssetDto } from './dto/fixed-asset.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

const MANAGE_ROLES = [UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.CEO, UserRole.MD];

// Fixed Asset (PP&E) register — reads open to any authenticated user (same
// convention as FundTransferController), writes restricted to
// accounting-facing roles since this posts real Journal Entries and can
// move bank/cash balances.
@Controller('fixed-assets')
export class FixedAssetController {
  constructor(private service: FixedAssetService) {}

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
  create(@Body() dto: CreateFixedAssetDto, @Req() req: AuthedRequest) {
    return this.service.create(dto, { userId: req.user?.userId, email: req.user?.email });
  }

  @Roles(...MANAGE_ROLES)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFixedAssetDto) {
    return this.service.update(id, dto);
  }

  @Roles(...MANAGE_ROLES)
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.remove(id, { userId: req.user?.userId, email: req.user?.email });
  }

  // Manually posts this asset's current-month depreciation on demand
  // (e.g. right after registering it) instead of waiting for the 1st.
  @Roles(...MANAGE_ROLES)
  @Post(':id/depreciate')
  depreciateNow(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.depreciateNow(id, { userId: req.user?.userId, email: req.user?.email });
  }

  // Runs the full monthly depreciation job for every active asset right
  // now, instead of waiting for the scheduled 1st-of-month run.
  @Roles(...MANAGE_ROLES)
  @Post('run-depreciation')
  runDepreciationNow() {
    return this.service.runDepreciationNow();
  }

  @Roles(...MANAGE_ROLES)
  @Post(':id/dispose')
  dispose(@Param('id') id: string, @Body() dto: DisposeFixedAssetDto, @Req() req: AuthedRequest) {
    return this.service.dispose(id, dto, { userId: req.user?.userId, email: req.user?.email });
  }
}
