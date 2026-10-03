import { Body, Controller, Get, NotFoundException, Patch, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/settings.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { Public } from '../auth/public.decorator';
import { ModuleAccess } from '../auth/module-access.decorator';

@ModuleAccess('settings')
@Controller('settings')
export class SettingsController {
  constructor(private service: SettingsService) {}

  // Reading settings (company name, logo, default template) is needed by
  // every logged-in user's dashboard header, AND by the pre-login Sign
  // in / Create admin account pages (they can't send a JWT yet) so they
  // can show the real company name + logo instead of a placeholder.
  // Nothing sensitive here (same info already printed on public invoices).
  @Public()
  @Get()
  get() {
    return this.service.get();
  }

  // Changing company info or the default invoice template is restricted —
  // same role set as Activity Log visibility (admin/ceo/md).
  @Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD)
  @Patch()
  update(@Body() dto: UpdateSettingsDto) {
    return this.service.update(dto);
  }

  // Upload a company logo (PNG/JPG). Used as the watermark + header mark
  // across all invoice templates, and as the dashboard header logo.
  @Roles(UserRole.ADMIN, UserRole.CEO, UserRole.MD)
  @Post('logo')
  @UseInterceptors(FileInterceptor('file'))
  uploadLogo(@UploadedFile() file: Express.Multer.File) {
    return this.service.uploadLogo(file);
  }

  // Serves the raw logo image file so the frontend can actually render it
  // (Settings page preview, sidebar header) — not sensitive, so this is
  // public rather than needing an Authorization header like a plain <img>
  // tag can't send anyway.
  @Public()
  @Get('logo')
  async getLogo(@Res() res: Response) {
    const filePath = await this.service.getLogoFilePath();
    if (!filePath) throw new NotFoundException('No logo has been uploaded yet');
    res.sendFile(filePath);
  }
}
