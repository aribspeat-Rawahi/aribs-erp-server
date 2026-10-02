import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Designation } from './designation.entity';
import { CreateDesignationDto, UpdateDesignationDto } from './dto/designation.dto';

@Injectable()
export class DesignationService {
  constructor(
    @InjectRepository(Designation)
    private repo: Repository<Designation>,
  ) {}

  findAll() {
    return this.repo.find({ order: { createdAt: 'ASC' } });
  }

  create(dto: CreateDesignationDto) {
    const item = this.repo.create(dto);
    return this.repo.save(item);
  }

  async update(id: string, dto: UpdateDesignationDto) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Designation not found');
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  async remove(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Designation not found');
    await this.repo.remove(item);
    return { success: true };
  }
}
