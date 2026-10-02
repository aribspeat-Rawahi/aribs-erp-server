import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { BomService } from './bom.service';
import { AddBomLineDto } from './dto/manufacturing.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';

@Controller('bom')
export class BomController {
  constructor(private service: BomService) {}

  @Get('finished-good/:finishedGoodId')
  findByFinishedGood(@Param('finishedGoodId') finishedGoodId: string) {
    return this.service.findByFinishedGood(finishedGoodId);
  }

  @Post()
  addLine(@Body() dto: AddBomLineDto) {
    return this.service.addLine(dto);
  }

  // Admin and Production — editing a BOM (recipe) changes what a
  // production run consumes, not something to expose to every role.
  @Roles(UserRole.ADMIN, UserRole.PRODUCTION)
  @Patch(':id')
  updateLine(@Param('id') id: string, @Body() dto: Partial<AddBomLineDto>) {
    return this.service.updateLine(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.PRODUCTION)
  @Delete(':id')
  removeLine(@Param('id') id: string) {
    return this.service.removeLine(id);
  }
}
