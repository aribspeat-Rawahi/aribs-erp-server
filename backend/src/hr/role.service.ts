import { ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from './role.entity';
import { CreateRoleDto } from './dto/role-team.dto';

// The 6 roles that used to be the fixed EmployeeRole enum. Seeded on
// first boot so existing employees (whose `role` column already holds
// one of these exact string values) keep resolving to a real Role row.
const DEFAULT_ROLES = ['ceo', 'md', 'accountant', 'production_staff', 'sales_staff', 'admin'];

@Injectable()
export class RoleService implements OnModuleInit {
  constructor(
    @InjectRepository(Role)
    private repo: Repository<Role>,
  ) {}

  async onModuleInit() {
    const count = await this.repo.count();
    if (count > 0) return;
    await this.repo.save(DEFAULT_ROLES.map((name) => this.repo.create({ name })));
  }

  findAll() {
    return this.repo.find({ order: { createdAt: 'ASC' } });
  }

  async create(dto: CreateRoleDto) {
    const existing = await this.repo.findOne({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A role with this name already exists');
    const item = this.repo.create(dto);
    return this.repo.save(item);
  }

  async remove(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Role not found');
    await this.repo.remove(item);
    return { success: true };
  }
}
