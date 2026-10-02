import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SupplierService } from './supplier.service';
import { CreateSupplierDto } from './dto/supplier.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

@Controller('suppliers')
export class SupplierController {
  constructor(private service: SupplierService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // Every purchase order placed with this supplier — the "view all data"
  // history shown on the supplier detail screen (mirrors customers).
  @Get(':id/history')
  history(@Param('id') id: string) {
    return this.service.history(id);
  }

  @Post()
  create(@Body() dto: CreateSupplierDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateSupplierDto>) {
    return this.service.update(id, dto);
  }

  // Admin only — deleting a supplier record isn't something any role
  // should be able to do casually. MD/CEO/GM get an email notice.
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.remove(id, { userId: req.user?.userId, email: req.user?.email });
  }
}
