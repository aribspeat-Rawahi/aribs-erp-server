import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CustomerBankAccountService } from './customer-bank-account.service';
import { UpsertCustomerBankAccountDto } from './dto/customer.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';

const ALLOWED_STATEMENT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

// All routes here are protected by the default JWT guard — bank details
// are sensitive, not something to expose without login.
@Controller('customers/:customerId/bank-accounts')
export class CustomerBankAccountController {
  constructor(private service: CustomerBankAccountService) {}

  @Get()
  findAll(@Param('customerId') customerId: string) {
    return this.service.findByCustomer(customerId);
  }

  @Post()
  create(@Param('customerId') customerId: string, @Body() dto: UpsertCustomerBankAccountDto) {
    return this.service.create(customerId, dto);
  }

  @Patch(':id')
  update(
    @Param('customerId') customerId: string,
    @Param('id') id: string,
    @Body() dto: UpsertCustomerBankAccountDto,
  ) {
    return this.service.update(customerId, id, dto);
  }

  // Admin and Accountant — deleting a customer's bank details isn't
  // something any role should be able to do casually.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Delete(':id')
  remove(@Param('customerId') customerId: string, @Param('id') id: string) {
    return this.service.remove(customerId, id);
  }

  @Post(':id/statement')
  @UseInterceptors(FileInterceptor('file'))
  async uploadStatement(
    @Param('customerId') customerId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!ALLOWED_STATEMENT_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Statement must be a PDF, PNG, or JPG file');
    }
    return this.service.uploadStatement(customerId, id, file);
  }

  // Frontend fetches this as a blob (same pattern as the employee photo
  // and expense invoice) since it's a protected route.
  @Get(':id/statement')
  async viewStatement(@Param('customerId') customerId: string, @Param('id') id: string, @Res() res: Response) {
    const { filePath } = await this.service.getStatementFilePath(customerId, id);
    res.sendFile(filePath);
  }
}
