import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterUserDto, LoginDto, UpdateUserDto, ChangePasswordDto, SetPasswordDto, ForgotPasswordDto, ResetPasswordDto } from './dto/auth.dto';
import { Roles } from './roles.guard';
import { UserRole } from './user.entity';
import { Public } from './public.decorator';
import { AnySignedInUser, ModuleAccess } from './module-access.decorator';

@Controller('auth')
export class AuthController {
  constructor(private service: AuthService) {}

  // Public: tells the login screen whether to show the one-time
  // "Create the admin account" link (only before any account exists).
  @Public()
  @Get('setup-status')
  async setupStatus() {
    return { needsSetup: await this.service.needsSetup() };
  }

  // Public, but works exactly ONCE: creates the first account as Admin and
  // is refused (403) as soon as any account exists. Rate-limited.
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('setup')
  setup(@Body() dto: RegisterUserDto) {
    return this.service.setupFirstAdmin(dto);
  }

  // User-management routes below are tagged strictRoles: a per-module
  // "Team" grant never replaces the Admin/CEO/MD role check, so nobody
  // can use it to change their own role or permissions.
  //
  // Creating accounts is NOT public any more - only Admin, CEO and MD
  // (the Team page). Nobody on the internet can sign themselves up.
  @ModuleAccess('team', { strictRoles: true })
  @Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD)
  @Post('register')
  register(@Body() dto: RegisterUserDto, @Req() req: any) {
    return this.service.register(dto, { userId: req.user.userId, role: req.user.role });
  }

  // Rate-limited to slow down credential-stuffing/brute-force attempts.
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.service.login(dto);
  }

  // "Forgot password" (public, rate-limited): emails a one-hour reset link.
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.service.forgotPassword(dto.email);
  }

  // Sets a new password from the emailed link (public, rate-limited).
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.service.resetPassword(dto.token, dto.newPassword);
  }

  // Any signed-in user changes their own password (current one required).
  @AnySignedInUser()
  @UseGuards(ThrottlerGuard)
  @Post('change-password')
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: any) {
    return this.service.changeOwnPassword(req.user.userId, dto.currentPassword, dto.newPassword);
  }

  // Any signed-in user: their own up-to-date name, role and module
  // permissions (the app refreshes this on every load).
  @AnySignedInUser()
  @Get('me')
  me(@Req() req: any) {
    return this.service.me(req.user.userId);
  }

  // Team management (list/edit/delete) is Admin, CEO and MD — the three
  // roles trusted with company-wide administration.
  // ?deleted=true switches to the "Deleted / Recall" view.
  @ModuleAccess('team', { strictRoles: true })
  @Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD)
  @Get('users')
  findAll(@Query('deleted') deleted?: string) {
    return this.service.findAll(deleted === 'true');
  }

  // This is how permissions get changed after account creation — change
  // someone's role (e.g. sales -> accountant) or deactivate their login.
  @ModuleAccess('team', { strictRoles: true })
  @Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD)
  @Patch('users/:id')
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto, @Req() req: any) {
    return this.service.updateUser(id, dto, { userId: req.user.userId, role: req.user.role });
  }

  // Set a new password for someone who forgot theirs (Admin accounts:
  // only another Admin).
  @ModuleAccess('team', { strictRoles: true })
  @Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD)
  @Patch('users/:id/password')
  setPassword(@Param('id') id: string, @Body() dto: SetPasswordDto, @Req() req: any) {
    return this.service.adminSetPassword(id, dto.newPassword, { userId: req.user.userId, role: req.user.role });
  }

  // Soft-deletes the user — hides them from the Team list and blocks
  // their login, but keeps the account row and all of their history
  // (invoices, journal entries, etc.) fully intact. Reversible via
  // restore(). Admin/CEO/MD only.
  @ModuleAccess('team', { strictRoles: true })
  @Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD)
  @Delete('users/:id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, req.user.userId, req.user.role);
  }

  // Undoes a delete — brings the account back to the normal Team list.
  @ModuleAccess('team', { strictRoles: true })
  @Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD)
  @Patch('users/:id/restore')
  restore(@Param('id') id: string) {
    return this.service.restore(id);
  }
}
