import { BadRequestException, Body, Controller, Get, HttpCode, Post, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { InjectDataSource } from '@nestjs/typeorm';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { Public } from '../auth/public.decorator';
import { AnySignedInUser, ModuleAccess } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { reportError, sendTestAlert } from './error-alert';

export class ClientErrorDto {
  @IsString()
  @MaxLength(500)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  stack?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  path?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  userAgent?: string;
}

@Controller()
export class MonitoringController {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  // For an outside uptime monitor (e.g. UptimeRobot): 200 when the app AND
  // its database answer, 503 otherwise. Reveals nothing else.
  @Public()
  @Get('health')
  async health() {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'unreachable' });
    }
  }

  // A page crashed in someone's browser/app (the "This page couldn't be
  // displayed" screen) - email the team. Signed-in users only, rate-limited.
  @AnySignedInUser()
  @UseGuards(ThrottlerGuard)
  @Post('monitoring/client-error')
  @HttpCode(204)
  clientError(@Body() dto: ClientErrorDto, @Req() req: { user?: { email?: string; role?: string } }) {
    const err = new Error(dto.message);
    err.stack = dto.stack ? `${dto.message}\n${dto.stack}` : '';
    reportError('Page crash (frontend)', err, {
      Page: dto.path,
      User: req.user?.email ? `${req.user.email} (${req.user.role})` : undefined,
      Device: dto.userAgent,
    });
  }

  // Settings > "Send test email": checks the whole email path right now and
  // returns the real reason if it fails (e.g. wrong SMTP password). Admin only.
  @ModuleAccess('settings', { strictRoles: true })
  @Roles(UserRole.ADMIN)
  @Post('monitoring/test-alert')
  async testAlert(@Req() req: { user?: { email?: string } }) {
    try {
      return await sendTestAlert(req.user?.email || 'admin');
    } catch (err) {
      throw new BadRequestException(`Test email failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
