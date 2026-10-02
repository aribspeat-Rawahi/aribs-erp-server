import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BillOfMaterial } from './bom.entity';
import { AddBomLineDto } from './dto/manufacturing.dto';

@Injectable()
export class BomService {
  constructor(
    @InjectRepository(BillOfMaterial)
    private repo: Repository<BillOfMaterial>,
  ) {}

  // Full recipe for one finished good — all raw materials + quantities needed.
  findByFinishedGood(finishedGoodId: string) {
    return this.repo.find({ where: { finishedGoodId } });
  }

  addLine(dto: AddBomLineDto) {
    const line = this.repo.create(dto);
    return this.repo.save(line);
  }

  async updateLine(id: string, dto: Partial<AddBomLineDto>) {
    const line = await this.repo.findOne({ where: { id } });
    if (!line) throw new NotFoundException('BOM line not found');
    Object.assign(line, dto);
    return this.repo.save(line);
  }

  async removeLine(id: string) {
    const line = await this.repo.findOne({ where: { id } });
    if (!line) throw new NotFoundException('BOM line not found');
    await this.repo.remove(line);
    return { removed: true };
  }
}
