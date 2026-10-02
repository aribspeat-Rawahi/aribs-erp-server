import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Holiday } from './holiday.entity';
import { CreateHolidayDto, UpdateHolidayDto } from './dto/holiday.dto';

@Injectable()
export class HolidayService {
  constructor(
    @InjectRepository(Holiday)
    private repo: Repository<Holiday>,
  ) {}

  findAll() {
    return this.repo.find({ order: { dateFrom: 'ASC' } });
  }

  create(dto: CreateHolidayDto) {
    const item = this.repo.create({ ...dto, days: dto.days || 1 });
    return this.repo.save(item);
  }

  async update(id: string, dto: UpdateHolidayDto) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Holiday not found');
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  async remove(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Holiday not found');
    await this.repo.remove(item);
    return { success: true };
  }
}
