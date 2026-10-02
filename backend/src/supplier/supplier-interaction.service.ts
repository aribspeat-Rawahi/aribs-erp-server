import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupplierInteraction } from './supplier-interaction.entity';
import { SupplierService } from './supplier.service';
import { CreateSupplierInteractionDto } from './dto/supplier.dto';

@Injectable()
export class SupplierInteractionService {
  constructor(
    @InjectRepository(SupplierInteraction)
    private repo: Repository<SupplierInteraction>,
    private supplierService: SupplierService,
  ) {}

  findBySupplier(supplierId: string) {
    return this.repo.find({ where: { supplierId }, order: { interactionDate: 'DESC', createdAt: 'DESC' } });
  }

  async create(supplierId: string, dto: CreateSupplierInteractionDto, createdByEmail?: string) {
    await this.supplierService.findOne(supplierId); // 404s if the supplier doesn't exist
    const item = this.repo.create({
      supplierId,
      type: dto.type,
      subject: dto.subject,
      notes: dto.notes,
      interactionDate: dto.interactionDate || new Date().toISOString().slice(0, 10),
      createdByEmail,
    });
    return this.repo.save(item);
  }

  async remove(supplierId: string, id: string) {
    const item = await this.repo.findOne({ where: { id, supplierId } });
    if (!item) throw new NotFoundException('Interaction not found');
    await this.repo.remove(item);
    return { ok: true };
  }
}
