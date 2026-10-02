import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Team } from './team.entity';
import { CreateTeamDto } from './dto/role-team.dto';

@Injectable()
export class TeamService {
  constructor(
    @InjectRepository(Team)
    private repo: Repository<Team>,
  ) {}

  findAll() {
    return this.repo.find({ order: { createdAt: 'ASC' } });
  }

  async create(dto: CreateTeamDto) {
    const existing = await this.repo.findOne({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A team with this name already exists');
    const item = this.repo.create(dto);
    return this.repo.save(item);
  }

  async remove(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Team not found');
    await this.repo.remove(item);
    return { success: true };
  }
}
