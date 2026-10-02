import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HrEvent } from './event.entity';
import { CreateEventDto, UpdateEventDto } from './dto/event.dto';

@Injectable()
export class EventService {
  constructor(
    @InjectRepository(HrEvent)
    private repo: Repository<HrEvent>,
  ) {}

  findAll() {
    return this.repo.find({ order: { date: 'ASC' } });
  }

  create(dto: CreateEventDto) {
    const item = this.repo.create(dto);
    return this.repo.save(item);
  }

  async update(id: string, dto: UpdateEventDto) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Event not found');
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  async remove(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Event not found');
    await this.repo.remove(item);
    return { success: true };
  }
}
