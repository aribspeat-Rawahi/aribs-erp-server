import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ShiftService } from './shift.service';
import { CreateShiftDto, UpdateShiftDto } from './dto/shift.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';

@Controller('shifts')
export class ShiftController {
  constructor(private service: ShiftService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Post()
  create(@Body() dto: CreateShiftDto) {
    return this.service.create(dto);
  }

  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateShiftDto) {
    return this.service.update(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
