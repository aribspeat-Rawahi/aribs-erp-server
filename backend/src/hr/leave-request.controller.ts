import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { LeaveRequestService } from './leave-request.service';
import { CreateLeaveRequestDto, UpdateLeaveRequestDto } from './dto/leave-request.dto';

@Controller('leave-requests')
export class LeaveRequestController {
  constructor(private service: LeaveRequestService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  create(@Body() dto: CreateLeaveRequestDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLeaveRequestDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
