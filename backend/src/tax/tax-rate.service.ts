import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaxRate } from './tax-rate.entity';
import { CreateTaxRateDto, UpdateTaxRateDto } from './dto/tax-rate.dto';

@Injectable()
export class TaxRateService {
  constructor(
    @InjectRepository(TaxRate)
    private repo: Repository<TaxRate>,
  ) {}

  findAll(includeInactive = false) {
    return this.repo.find({
      where: includeInactive ? {} : { active: true },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Tax rate not found');
    return item;
  }

  create(dto: CreateTaxRateDto) {
    const item = this.repo.create({ ...dto, active: true });
    return this.repo.save(item);
  }

  async update(id: string, dto: UpdateTaxRateDto) {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  // Soft-delete only — a rate may already have been used on past records
  // once Invoice/Expense line items start referencing tax rates.
  async remove(id: string) {
    const item = await this.findOne(id);
    item.active = false;
    await this.repo.save(item);
    return { deactivated: true };
  }
}
