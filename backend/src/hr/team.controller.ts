import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { TeamService } from './team.service';
import { CreateTeamDto } from './dto/role-team.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';

@Controller('teams')
export class TeamController {
  constructor(private service: TeamService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Post()
  create(@Body() dto: CreateTeamDto) {
    return this.service.create(dto);
  }

  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
