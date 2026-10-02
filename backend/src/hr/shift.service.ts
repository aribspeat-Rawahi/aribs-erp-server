import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shift } from './shift.entity';
import { CreateShiftDto, UpdateShiftDto } from './dto/shift.dto';
import { EmployeeService } from './employee.service';

@Injectable()
export class ShiftService {
  constructor(
    @InjectRepository(Shift)
    private repo: Repository<Shift>,
    private employeeService: EmployeeService,
  ) {}

  // Staffs column = real count of active employees assigned to this shift
  // (Employee.shift, set from the Employees tab) — was hardcoded to 0
  // before "connect all steps".
  async findAll() {
    const [shifts, employees] = await Promise.all([
      this.repo.find({ order: { createdAt: 'ASC' } }),
      this.employeeService.findAll(),
    ]);
    return shifts.map((s) => ({
      ...s,
      staffCount: employees.filter((e) => e.active && e.shift === s.name).length,
    }));
  }

  create(dto: CreateShiftDto) {
    const item = this.repo.create(dto);
    return this.repo.save(item);
  }

  async update(id: string, dto: UpdateShiftDto) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Shift not found');
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  async remove(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Shift not found');
    await this.repo.remove(item);
    return { success: true };
  }
}
