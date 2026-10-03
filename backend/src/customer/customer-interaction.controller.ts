import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CustomerInteractionService } from './customer-interaction.service';
import { CreateCustomerInteractionDto } from './dto/customer.dto';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

@ModuleAccess('customers')
@Controller('customers/:customerId/interactions')
export class CustomerInteractionController {
  constructor(private service: CustomerInteractionService) {}

  @Get()
  findAll(@Param('customerId') customerId: string) {
    return this.service.findByCustomer(customerId);
  }

  @Post()
  create(
    @Param('customerId') customerId: string,
    @Body() dto: CreateCustomerInteractionDto,
    @Req() req: AuthedRequest,
  ) {
    return this.service.create(customerId, dto, req.user?.email);
  }

  @Delete(':id')
  remove(@Param('customerId') customerId: string, @Param('id') id: string) {
    return this.service.remove(customerId, id);
  }
}
