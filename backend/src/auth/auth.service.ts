import { Injectable, UnauthorizedException, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { User, UserRole } from './user.entity';
import { RegisterUserDto, LoginDto, UpdateUserDto } from './dto/auth.dto';
import { MODULE_KEYS, ModuleAccessLevel, ModulePermissions } from './module-permissions';

// Strips out any key that isn't a known module or any value that isn't a
// known access level, so a malformed/malicious payload can never write
// junk into the modulePermissions column.
function sanitizeModulePermissions(input: ModulePermissions | null | undefined): ModulePermissions | null {
  if (!input) return null;
  const validLevels: string[] = Object.values(ModuleAccessLevel);
  const clean: ModulePermissions = {};
  for (const key of MODULE_KEYS) {
    const level = input[key];
    if (level && validLevels.includes(level)) {
      clean[key] = level;
    }
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterUserDto) {
    const existing = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existing) throw new ConflictException('A user with this email already exists');

    const passwordHash = await bcrypt.hash(dto.password, 10);

    // /auth/register is public (no login required), so it must never let
    // someone hand themselves an elevated role. The one exception is
    // bootstrapping: if this is the very first account in the whole
    // system (used by the /setup page), the requested role is honored so
    // that account can be Admin. Every account after that is forced to
    // the lowest-privilege role — real role changes only happen via
    // PATCH /auth/users/:id, which is Admin-only.
    const isFirstUser = (await this.userRepo.count()) === 0;
    const role = isFirstUser ? dto.role || UserRole.SALES : UserRole.SALES;

    const user = this.userRepo.create({
      name: dto.name,
      email: dto.email,
      passwordHash,
      role,
    });
    const saved = await this.userRepo.save(user);
    const { passwordHash: _, ...safeUser } = saved;
    return safeUser;
  }

  async login(dto: LoginDto) {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user || !user.active || user.deletedAt) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const token = this.jwtService.sign({ sub: user.id, role: user.role, email: user.email });
    return {
      accessToken: token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, modulePermissions: user.modulePermissions || null },
    };
  }

  // By default, hides soft-deleted accounts (the normal Team list).
  // Pass onlyDeleted=true for the "Deleted / Recall" view instead.
  findAll(onlyDeleted = false) {
    return this.userRepo.find({
      where: { deletedAt: onlyDeleted ? Not(IsNull()) : IsNull() },
      select: ['id', 'name', 'email', 'role', 'active', 'modulePermissions', 'deletedAt', 'createdAt'],
      order: { createdAt: 'ASC' },
    });
  }

  // Change a user's role, active/inactive status, or per-module
  // permission overrides — this is how permissions get changed after the
  // account already exists. (Deactivating someone instead of deleting
  // keeps their history — invoices they prepared, orders they created —
  // intact.)
  async updateUser(id: string, dto: UpdateUserDto) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.active !== undefined) user.active = dto.active;
    if (dto.modulePermissions !== undefined) user.modulePermissions = sanitizeModulePermissions(dto.modulePermissions);
    const saved = await this.userRepo.save(user);
    const { passwordHash: _, ...safeUser } = saved;
    return safeUser;
  }

  // Soft delete — hides the account from the normal Team list and blocks
  // their login, but the row (and every document/history they created)
  // stays intact and is fully reversible via restore(). Guarded against
  // the two ways this could lock everyone out: deleting your own
  // account, or deleting the last remaining Admin.
  async remove(id: string, requesterId: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.deletedAt) throw new BadRequestException('This user is already deleted.');

    if (id === requesterId) {
      throw new BadRequestException('You cannot delete your own account.');
    }

    if (user.role === UserRole.ADMIN) {
      const adminCount = await this.userRepo.count({ where: { role: UserRole.ADMIN, deletedAt: IsNull() } });
      if (adminCount <= 1) {
        throw new BadRequestException('Cannot delete the last remaining Admin account.');
      }
    }

    user.deletedAt = new Date();
    const saved = await this.userRepo.save(user);
    const { passwordHash: _, ...safeUser } = saved;
    return safeUser;
  }

  // Undo a delete — brings the account back into the normal Team list
  // and restores their ability to log in.
  async restore(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.deletedAt) throw new BadRequestException('This user is not deleted.');

    user.deletedAt = null;
    const saved = await this.userRepo.save(user);
    const { passwordHash: _, ...safeUser } = saved;
    return safeUser;
  }
}
