import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterUserDto, LoginDto, UpdateUserDto } from './dto/auth.dto';
import { Roles } from './roles.guard';
import { UserRole } from './user.entity';
import { Public } from './public.decorator';

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

  // Creating accounts is NOT public any more - only Admin, CEO and MD
  // (the Team page). Nobody on the internet can sign themselves up.
  @Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD)
  @Post('register')
  register(@Body() dto: RegisterUserDto) {
    return this.service.register(dto);
  }

  // Rate-limited to slow down credential-stuffing/brute-force attempts.
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.service.login(dto);
  }

  // Team management (list/edit/delete) is Admin, CEO and MD — the three
  // roles trusted with company-wide administration.
  // ?deleted=true switches to the "Deleted / Recall" view.
  @Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD)
  @Get('users')
  findAll(@Query('deleted') deleted?: string) {
    return this.service.findAll(deleted === 'true');
  }

  // This is how permissions get changed after account creation — change
  // someone's role (e.g. sales -> accountant) or deactivate their login.
  @Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD)
  @Patch('users/:id')
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.service.updateUser(id, dto);
  }

  // Soft-deletes the user — hides them from the Team list and blocks
  // their login, but keeps the account row and all of their history
  // (invoices, journal entries, etc.) fully intact. Reversible via
  // restore(). Admin/CEO/MD only.
  @Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD)
  @Delete('users/:id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, req.user.userId);
  }

  // Undoes a delete — brings the account back to the normal Team list.
  @Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD)
  @Patch('users/:id/restore')
  restore(@Param('id') id: string) {
    return this.service.restore(id);
  }
}
