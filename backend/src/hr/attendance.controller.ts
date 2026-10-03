import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { MarkAttendanceDto, DevicePunchDto } from './dto/hr.dto';
import { Public } from '../auth/public.decorator';
import { ModuleAccess } from '../auth/module-access.decorator';

@ModuleAccess('hr')
@Controller('attendance')
export class AttendanceController {
  constructor(private service: AttendanceService) {}

  // Marks (or updates) today's — or a given date's — attendance for an
  // employee. Safe to call multiple times in a day (e.g. check-in, then
  // check-out later) without creating duplicate rows.
  @Post()
  mark(@Body() dto: MarkAttendanceDto) {
    return this.service.mark(dto);
  }

  // Target for a fingerprint/biometric device (or a small bridge script
  // relaying its log) once hardware is connected — see hr.dto.ts for
  // the payload shape. Public because the device itself won't carry a
  // staff login JWT; it identifies the employee via biometricId instead.
  @Public()
  @Post('device-punch')
  punch(@Body() dto: DevicePunchDto) {
    return this.service.punch(dto);
  }

  @Get('employee/:employeeId')
  findByEmployee(@Param('employeeId') employeeId: string) {
    return this.service.findByEmployee(employeeId);
  }

  @Get('date/:date')
  findByDate(@Param('date') date: string) {
    return this.service.findByDate(date);
  }

  // Backs the Reports > Attendance Reports page.
  @Get('report')
  findReport(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('employeeId') employeeId?: string,
  ) {
    if (!from || !to) throw new BadRequestException('from and to date query params are required');
    return this.service.findReport(from, to, employeeId || undefined);
  }

  // Deletes a single attendance record — for removing a wrong/duplicate
  // manual entry. The frontend confirms with the user before calling this.
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
