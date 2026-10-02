import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AccountService } from './account.service';
import { CreateAccountDto, UpdateAccountDto } from './dto/account.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';

const ACCOUNTING_ROLES = [UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.CEO, UserRole.MD];

// Chart of Accounts — any authenticated user can view it (needed to
// populate the New Journal Entry form's account dropdown), but only
// accounting-facing roles can add/edit/deactivate accounts.
@Controller('accounts')
export class AccountController {
  constructor(private service: AccountService) {}

  @Get()
  findAll(@Query('includeInactive') includeInactive?: string) {
    return this.service.findAll(includeInactive === 'true');
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Roles(...ACCOUNTING_ROLES)
  @Post()
  create(@Body() dto: CreateAccountDto) {
    return this.service.create(dto);
  }

  @Roles(...ACCOUNTING_ROLES)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAccountDto) {
    return this.service.update(id, dto);
  }

  @Roles(...ACCOUNTING_ROLES)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
