import { Injectable, UnauthorizedException, ConflictException, NotFoundException, BadRequestException, ForbiddenException, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not, MoreThan } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { User, UserRole } from './user.entity';
import { RegisterUserDto, LoginDto, UpdateUserDto } from './dto/auth.dto';
import { EmailService } from '../common/email.service';

export interface Requester {
  userId: string;
  role: string;
}

// Failed sign-ins per email: after MAX_FAILS within FAIL_WINDOW the account
// is locked for LOCK_MS (on top of the per-IP rate limit, so guessing from
// many addresses doesn't help). Kept in memory - one app process.
const MAX_FAILS = 8;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const RESET_TOKEN_MS = 60 * 60 * 1000;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
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
  private readonly logger = new Logger(AuthService.name);
  private fails = new Map<string, { count: number; firstAt: number; lockedUntil: number }>();

  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private jwtService: JwtService,
    private config: ConfigService,
    private email: EmailService,
  ) {}

  private safe(user: User) {
    const { passwordHash: _, resetTokenHash: __, resetTokenExpiresAt: ___, ...rest } = user as User & Record<string, unknown>;
    return rest;
  }

  private sign(user: User) {
    return this.jwtService.sign({ sub: user.id, role: user.role, email: user.email });
  }

  // Only an Admin may create, change, delete or reset an Admin account, or
  // hand out the Admin role - otherwise a CEO/MD account could take over
  // (or lock out) the administrators.
  private assertCanManage(target: { role: UserRole } | null, requester: Requester, newRole?: UserRole) {
    const touchingAdmin = target?.role === UserRole.ADMIN || newRole === UserRole.ADMIN;
    if (touchingAdmin && requester.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only an Admin can create or change an Admin account.');
    }
  }

  // At least one active Admin must remain, or nobody can manage users.
  private async assertAnotherActiveAdmin(exceptId: string) {
    const others = await this.userRepo.count({ where: { role: UserRole.ADMIN, active: true, deletedAt: IsNull(), id: Not(exceptId) } });
    if (others < 1) throw new BadRequestException('This is the last active Admin account - make someone else Admin first.');
  }

  // True only while the system has never had a single account (deleted
  // accounts still count) - used to show/hide the first-run setup screen.
  async needsSetup(): Promise<boolean> {
    return (await this.userRepo.count({ withDeleted: true })) === 0;
  }

  // First-run setup: creates the very first account as Admin. Works exactly
  // once - as soon as any account exists it is refused, so nobody can use it
  // to make themselves an admin later. A database-level lock makes two
  // simultaneous attempts impossible.
  async setupFirstAdmin(dto: RegisterUserDto) {
    return this.userRepo.manager.transaction(async (manager) => {
      await manager.query("SELECT GET_LOCK('aribs_erp_first_admin_setup', 10)");
      try {
        const total = await manager.count(User, { withDeleted: true });
        if (total > 0) throw new ForbiddenException('Setup is already complete. Ask an administrator to create your account.');
        const user = manager.create(User, {
          name: dto.name,
          email: dto.email,
          passwordHash: await bcrypt.hash(dto.password, 10),
          role: UserRole.ADMIN,
        });
        const saved = await manager.save(user);
        return this.safe(saved);
      } finally {
        await manager.query("SELECT RELEASE_LOCK('aribs_erp_first_admin_setup')");
      }
    });
  }

  // Creating accounts is Admin/CEO/MD-only (enforced at the controller) -
  // the same people who can already change anyone's role, so honouring a
  // requested role here grants no extra power. Defaults to Sales.
  async register(dto: RegisterUserDto, requester?: Requester) {
    if (requester) this.assertCanManage(null, requester, dto.role);
    const existing = await this.userRepo.findOne({ where: { email: dto.email }, withDeleted: true });
    if (existing) throw new ConflictException('A user with this email already exists');

    const user = this.userRepo.create({
      name: dto.name,
      email: dto.email,
      passwordHash: await bcrypt.hash(dto.password, 10),
      role: dto.role || UserRole.SALES,
    });
    const saved = await this.userRepo.save(user);
    return this.safe(saved);
  }

  // Called by JwtStrategy on EVERY request: a token is only honoured while
  // its account still exists, is active and not deleted, and the CURRENT
  // role/permissions from the database are used (not the ones baked into
  // the token at login). Deactivating, deleting or demoting a user takes
  // effect immediately instead of after the 8-hour token expiry.
  async findActiveForToken(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId }, withDeleted: true });
    if (!user || !user.active || user.deletedAt) return null;
    return user;
  }

  // The signed-in user's current profile and permissions (what the
  // frontend shows in the menu). Read fresh from the database, so changes
  // an admin makes apply without logging out and in again.
  async me(userId: string) {
    const user = await this.findActiveForToken(userId);
    if (!user) throw new UnauthorizedException();
    return { id: user.id, name: user.name, email: user.email, role: user.role, modulePermissions: user.modulePermissions || null };
  }

  async login(dto: LoginDto) {
    const key = String(dto.email || '').trim().toLowerCase();
    const now = Date.now();
    const f = this.fails.get(key);
    if (f && f.lockedUntil > now) {
      const mins = Math.ceil((f.lockedUntil - now) / 60000);
      throw new HttpException(`Too many wrong passwords. Try again in ${mins} minute(s), or use "Forgot password".`, HttpStatus.TOO_MANY_REQUESTS);
    }
    const fail = () => {
      const cur = this.fails.get(key);
      const rec = !cur || now - cur.firstAt > FAIL_WINDOW_MS ? { count: 0, firstAt: now, lockedUntil: 0 } : cur;
      rec.count++;
      if (rec.count >= MAX_FAILS) {
        rec.lockedUntil = now + LOCK_MS;
        rec.count = 0;
        rec.firstAt = now;
        this.logger.warn(`Sign-in locked for 15 minutes after ${MAX_FAILS} wrong passwords: ${key}`);
      }
      this.fails.set(key, rec);
      if (this.fails.size > 5000) this.fails.clear(); // never grows without bound
      return new UnauthorizedException('Invalid credentials');
    };

    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user || !user.active || user.deletedAt) throw fail();

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw fail();
    this.fails.delete(key);

    const token = this.sign(user);
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
  async updateUser(id: string, dto: UpdateUserDto, requester?: Requester) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    const roleChanges = dto.role !== undefined && dto.role !== user.role;
    const deactivates = dto.active === false && user.active;
    if (requester) {
      this.assertCanManage(user, requester, dto.role);
      if (id === requester.userId && (roleChanges || deactivates)) {
        throw new BadRequestException("You can't change your own role or switch off your own account - ask another Admin.");
      }
    }
    if (user.role === UserRole.ADMIN && user.active && !user.deletedAt && (roleChanges || deactivates)) {
      await this.assertAnotherActiveAdmin(user.id);
    }
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.active !== undefined) user.active = dto.active;
    if (dto.modulePermissions !== undefined) user.modulePermissions = sanitizeModulePermissions(dto.modulePermissions);
    const saved = await this.userRepo.save(user);
    return this.safe(saved);
  }

  // ---- passwords ------------------------------------------------------------

  // Everyone can change their own password (old one required). Other
  // sign-ins of this account stop working; the caller gets a fresh token.
  async changeOwnPassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || !user.active || user.deletedAt) throw new UnauthorizedException();
    if (!(await bcrypt.compare(currentPassword || '', user.passwordHash))) throw new BadRequestException('The current password is wrong.');
    if (currentPassword === newPassword) throw new BadRequestException('The new password must be different.');
    await this.setPassword(user, newPassword);
    return { changed: true, accessToken: this.sign(user) };
  }

  // Admin/CEO/MD set a new password for someone (Admin accounts: Admins only).
  async adminSetPassword(id: string, newPassword: string, requester: Requester) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');
    this.assertCanManage(user, requester);
    if (id === requester.userId) throw new BadRequestException('Use "Change password" for your own account.');
    await this.setPassword(user, newPassword);
    return { changed: true };
  }

  private async setPassword(user: User, newPassword: string) {
    if (!newPassword || newPassword.length < 8) throw new BadRequestException('The password needs at least 8 characters.');
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    // whole seconds: token "iat" is in seconds
    user.passwordChangedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    await this.userRepo.update({ id: user.id }, { passwordHash: user.passwordHash, passwordChangedAt: user.passwordChangedAt, resetTokenHash: null, resetTokenExpiresAt: null });
    this.fails.delete(user.email.toLowerCase());
  }

  // "Forgot password": emails a one-hour, one-time link. Always answers the
  // same way, so it can't be used to find out which emails have accounts.
  async forgotPassword(email: string) {
    const generic = { sent: true, message: 'If this email has an account, a reset link has been sent to it.' };
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user || !user.active || user.deletedAt) return generic;
    const token = randomBytes(32).toString('hex');
    await this.userRepo.update({ id: user.id }, { resetTokenHash: sha256(token), resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_MS) });
    const base = String(this.config.get('PUBLIC_BASE_URL') || '').replace(/\/+$/, '');
    const link = `${base}/reset-password?token=${token}`;
    try {
      await this.email.sendPlainNotice(
        [user.email],
        'ARIBS ERP - reset your password',
        `Hello ${user.name},\n\nSomeone (hopefully you) asked to reset the password of your ARIBS ERP account.\n\n` +
          `Open this link within 1 hour to choose a new password:\n${link}\n\n` +
          `If you didn't ask for this, ignore this email - your password stays the same.`,
      );
    } catch (err) {
      this.logger.error(`Password reset email failed for ${user.email}: ${(err as Error).message}`);
    }
    return generic;
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await this.userRepo.findOne({
      where: { resetTokenHash: sha256(String(token || '')), resetTokenExpiresAt: MoreThan(new Date()) },
    });
    if (!user || !user.active || user.deletedAt) {
      throw new BadRequestException('This reset link is invalid or has expired. Ask for a new one.');
    }
    await this.setPassword(user, newPassword);
    return { changed: true };
  }

  // Soft delete — hides the account from the normal Team list and blocks
  // their login, but the row (and every document/history they created)
  // stays intact and is fully reversible via restore(). Guarded against
  // the two ways this could lock everyone out: deleting your own
  // account, or deleting the last remaining Admin.
  async remove(id: string, requesterId: string, requesterRole?: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.deletedAt) throw new BadRequestException('This user is already deleted.');

    if (id === requesterId) {
      throw new BadRequestException('You cannot delete your own account.');
    }
    if (requesterRole) this.assertCanManage(user, { userId: requesterId, role: requesterRole });

    if (user.role === UserRole.ADMIN && user.active) {
      await this.assertAnotherActiveAdmin(user.id);
    }

    user.deletedAt = new Date();
    const saved = await this.userRepo.save(user);
    return this.safe(saved);
  }

  // Undo a delete — brings the account back into the normal Team list
  // and restores their ability to log in.
  async restore(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.deletedAt) throw new BadRequestException('This user is not deleted.');

    user.deletedAt = null;
    const saved = await this.userRepo.save(user);
    return this.safe(saved);
  }
}
