import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { DocumentApprovalService, RuleBandInput } from './document-approval.service';
import { ApprovalDocumentType } from './document-approval.entity';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}
const actorOf = (req: AuthedRequest) => ({ userId: req.user?.userId, email: req.user?.email, role: req.user?.role });

export class DecideApprovalDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class SetApprovalRulesDto {
  @IsArray()
  bands: RuleBandInput[];
}

// Approve / reject purchase orders and requisitions (Approvals page).
@ModuleAccess('approvals')
@Controller('document-approvals')
export class DocumentApprovalController {
  constructor(private service: DocumentApprovalService) {}

  // the step's roles are checked in the service (who may decide which step)
  @Get('pending')
  pending(@Req() req: AuthedRequest) {
    return this.service.pending(actorOf(req));
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Body() dto: DecideApprovalDto, @Req() req: AuthedRequest) {
    return this.service.decide(id, 'approve', actorOf(req), dto?.comment);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: DecideApprovalDto, @Req() req: AuthedRequest) {
    return this.service.decide(id, 'reject', actorOf(req), dto?.comment);
  }
}

// Settings > Approval rules. Anyone working with purchases may read them
// (to see who will approve); only Admin / CEO / MD change them.
@ModuleAccess('settings', { readAlso: ['suppliers', 'approvals'] })
@Controller('approval-rules')
export class ApprovalRuleController {
  constructor(private service: DocumentApprovalService) {}

  @Get()
  get() {
    return this.service.getRules();
  }

  @ModuleAccess('settings', { strictRoles: true })
  @Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD)
  @Put(':documentType')
  set(@Param('documentType') type: string, @Body() dto: SetApprovalRulesDto, @Req() req: AuthedRequest) {
    return this.service.setRules(type as ApprovalDocumentType, dto.bands, actorOf(req));
  }
}
