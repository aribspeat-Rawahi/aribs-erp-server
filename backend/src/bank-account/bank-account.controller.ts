import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { BankAccountService } from './bank-account.service';
import { CreateBankAccountDto, CreateBankTransactionDto, UpdateBankAccountDto } from './dto/bank-account.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

@Controller('bank-accounts')
export class BankAccountController {
  constructor(private service: BankAccountService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateBankAccountDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBankAccountDto) {
    return this.service.update(id, dto);
  }

  // Admin and Accountant — deleting a company bank account record isn't
  // something any role should be able to do casually.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Get(':id/transactions')
  listTransactions(@Param('id') id: string) {
    return this.service.listTransactions(id);
  }

  @Post(':id/transactions')
  addTransaction(@Param('id') id: string, @Body() dto: CreateBankTransactionDto, @Req() req: AuthedRequest) {
    return this.service.addTransaction(id, dto, { userId: req.user?.userId, email: req.user?.email });
  }
}
