import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { Settings } from './settings.entity';
import { UpdateSettingsDto } from './dto/settings.dto';
import { verifyFileSignature } from '../common/file-signature.util';

@Injectable()
export class SettingsService {
  private uploadDir: string;

  constructor(
    @InjectRepository(Settings)
    private repo: Repository<Settings>,
    private config: ConfigService,
  ) {
    this.uploadDir = this.config.get('LOGO_UPLOAD_DIR') || './uploads/branding';
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  // There is only ever one settings row — create it on first access.
  async get(): Promise<Settings> {
    let settings = await this.repo.findOne({ where: { id: 1 } });
    if (!settings) {
      settings = this.repo.create({ id: 1 });
      settings = await this.repo.save(settings);
    }
    return settings;
  }

  async update(dto: UpdateSettingsDto) {
    const settings = await this.get();
    Object.assign(settings, dto);
    return this.repo.save(settings);
  }

  // Saves the uploaded logo to disk and records its path. Every invoice
  // template (classic / formal / po_style) reads this same path for its
  // watermark and header logo — so a single upload updates all of them.
  async uploadLogo(file: Express.Multer.File) {
    const { extension: ext } = verifyFileSignature(file.buffer, ['jpeg', 'png']);
    const fileName = `logo${ext}`;
    const filePath = path.join(this.uploadDir, fileName);
    fs.writeFileSync(filePath, file.buffer);

    const settings = await this.get();
    settings.logoPath = filePath;
    return this.repo.save(settings);
  }

  // Used by the invoice PDF generator to read the current logo, if any.
  async getLogoBase64(): Promise<string | undefined> {
    const settings = await this.get();
    if (settings.logoPath && fs.existsSync(settings.logoPath)) {
      return fs.readFileSync(settings.logoPath).toString('base64');
    }
    return undefined;
  }

  // Used by the frontend Settings page (and sidebar) to actually display
  // the uploaded logo image, separate from getLogoBase64 which is only
  // for embedding into generated PDFs.
  async getLogoFilePath(): Promise<string | undefined> {
    const settings = await this.get();
    if (settings.logoPath && fs.existsSync(settings.logoPath)) {
      return path.resolve(settings.logoPath);
    }
    return undefined;
  }
}
