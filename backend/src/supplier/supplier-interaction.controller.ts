import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SupplierInteractionService } from './supplier-interaction.service';
import { CreateSupplierInteractionDto } from './dto/supplier.dto';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

@ModuleAccess('suppliers')
@Controller('suppliers/:supplierId/interactions')
export class SupplierInteractionController {
  constructor(private service: SupplierInteractionService) {}

  @Get()
  findAll(@Param('supplierId') supplierId: string) {
    return this.service.findBySupplier(supplierId);
  }

  @Post()
  create(
    @Param('supplierId') supplierId: string,
    @Body() dto: CreateSupplierInteractionDto,
    @Req() req: AuthedRequest,
  ) {
    return this.service.create(supplierId, dto, req.user?.email);
  }

  @Delete(':id')
  remove(@Param('supplierId') supplierId: string, @Param('id') id: string) {
    return this.service.remove(supplierId, id);
  }
}
