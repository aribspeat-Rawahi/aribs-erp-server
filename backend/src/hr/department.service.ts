import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Department } from './department.entity';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';

@Injectable()
export class DepartmentService {
  constructor(
    @InjectRepository(Department)
    private repo: Repository<Department>,
  ) {}

  findAll() {
    return this.repo.find({ order: { createdAt: 'ASC' } });
  }

  async create(dto: CreateDepartmentDto) {
    const existing = await this.repo.findOne({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A department with this name already exists');
    const item = this.repo.create(dto);
    return this.repo.save(item);
  }

  async update(id: string, dto: UpdateDepartmentDto) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Department not found');
    const existing = await this.repo.findOne({ where: { name: dto.name, id: Not(id) } });
    if (existing) throw new ConflictException('A department with this name already exists');
    item.name = dto.name;
    if (dto.otRatePerHour !== undefined) item.otRatePerHour = dto.otRatePerHour;
    return this.repo.save(item);
  }

  async remove(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Department not found');
    await this.repo.remove(item);
    return { success: true };
  }
}
