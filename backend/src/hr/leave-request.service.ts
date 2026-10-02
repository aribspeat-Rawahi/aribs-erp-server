import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LeaveRequest } from './leave-request.entity';
import { CreateLeaveRequestDto, UpdateLeaveRequestDto } from './dto/leave-request.dto';

@Injectable()
export class LeaveRequestService {
  constructor(
    @InjectRepository(LeaveRequest)
    private repo: Repository<LeaveRequest>,
  ) {}

  findAll() {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  create(dto: CreateLeaveRequestDto) {
    const item = this.repo.create({
      ...dto,
      date: dto.date || new Date().toISOString().slice(0, 10),
    });
    return this.repo.save(item);
  }

  async update(id: string, dto: UpdateLeaveRequestDto) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Leave request not found');
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  async remove(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Leave request not found');
    await this.repo.remove(item);
    return { success: true };
  }
}
