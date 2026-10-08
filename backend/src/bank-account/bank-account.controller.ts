import { BankTransactionCategory, BANK_TRANSACTION_CATEGORY_LABEL } from './bank-transaction-category.enum';
import { BankTransactionType } from './bank-transaction.entity';
import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { BankAccountService } from './bank-account.service';
import { CreateBankAccountDto, CreateBankTransactionDto, UpdateBankAccountDto } from './dto/bank-account.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

const DEPOSIT_CATEGORIES: BankTransactionCategory[] = [
  BankTransactionCategory.OWNERS_CONTRIBUTION,
  BankTransactionCategory.OTHER_INCOME,
  BankTransactionCategory.OPENING_BALANCE,
];

@ModuleAccess('accounting')
@Controller('bank-accounts')
export class BankAccountController {
  constructor(private service: BankAccountService) {}

  @ModuleAccess('accounting', { readAlso: ['invoices', 'suppliers', 'hr'] })

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateBankAccountDto, @Req() req: AuthedRequest) {
    return this.service.create(dto, { userId: req.user?.userId, email: req.user?.email });
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

  // A deposit/withdrawal recorded by hand must say what it is: the category
  // decides the other side of its journal entry. Without one the bank
  // balance would move while the books stay unchanged. (Internal callers -
  // payroll, reimbursements, advances - post their own entries and call
  // the service directly.)
  @Post(':id/transactions')
  addTransaction(@Param('id') id: string, @Body() dto: CreateBankTransactionDto, @Req() req: AuthedRequest) {
    if (!dto.category) {
      throw new BadRequestException('Choose what this transaction is (category) - it decides how it is recorded in the books.');
    }
    const forDeposit = DEPOSIT_CATEGORIES.includes(dto.category);
    if ((dto.type === BankTransactionType.DEPOSIT) !== forDeposit) {
      throw new BadRequestException(`"${BANK_TRANSACTION_CATEGORY_LABEL[dto.category]}" can't be used for a ${dto.type}.`);
    }
    return this.service.addTransaction(id, dto, { userId: req.user?.userId, email: req.user?.email });
  }
}
