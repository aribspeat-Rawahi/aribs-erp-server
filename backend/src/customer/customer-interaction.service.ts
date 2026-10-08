import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerInteraction } from './customer-interaction.entity';
import { CustomerService } from './customer.service';
import { CreateCustomerInteractionDto } from './dto/customer.dto';
import { omanToday } from '../common/oman-date';

@Injectable()
export class CustomerInteractionService {
  constructor(
    @InjectRepository(CustomerInteraction)
    private repo: Repository<CustomerInteraction>,
    private customerService: CustomerService,
  ) {}

  findByCustomer(customerId: string) {
    // Most recent first — a log is read newest-on-top.
    return this.repo.find({ where: { customerId }, order: { interactionDate: 'DESC', createdAt: 'DESC' } });
  }

  async create(customerId: string, dto: CreateCustomerInteractionDto, createdByEmail?: string) {
    await this.customerService.findOne(customerId); // 404s if the customer doesn't exist
    const item = this.repo.create({
      customerId,
      type: dto.type,
      subject: dto.subject,
      notes: dto.notes,
      interactionDate: dto.interactionDate || omanToday(),
      createdByEmail,
    });
    return this.repo.save(item);
  }

  async remove(customerId: string, id: string) {
    const item = await this.repo.findOne({ where: { id, customerId } });
    if (!item) throw new NotFoundException('Interaction not found');
    await this.repo.remove(item);
    return { ok: true };
  }
}
