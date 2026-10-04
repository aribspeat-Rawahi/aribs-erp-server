import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { CompanyDocument } from './company-document.entity';
import { verifyFileSignature } from '../common/file-signature.util';
import { discardFile } from '../common/discard-file.util';

// Mirrors CustomerDocumentService's pattern (customer/customer-document.service.ts)
// — same on-disk storage + signature-verified upload approach, just without
// a parent customerId since these documents belong to the company itself.
@Injectable()
export class CompanyDocumentService {
  private uploadDir: string;

  constructor(
    @InjectRepository(CompanyDocument)
    private repo: Repository<CompanyDocument>,
    private config: ConfigService,
  ) {
    this.uploadDir = this.config.get('COMPANY_DOCUMENT_UPLOAD_DIR') || './uploads/company-documents';
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  async upload(title: string, file: Express.Multer.File) {
    const { extension: ext } = verifyFileSignature(file.buffer, ['pdf', 'jpeg', 'png']);
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const filePath = path.join(this.uploadDir, fileName);
    fs.writeFileSync(filePath, file.buffer);

    const doc = this.repo.create({ title, originalName: file.originalname, filePath });
    return this.repo.save(doc);
  }

  findAll() {
    return this.repo.find({ order: { uploadedAt: 'DESC' } });
  }

  private async findOrThrow(id: string) {
    const doc = await this.repo.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  // "Edit" only renames the label — the uploaded file itself is never
  // swapped in place; delete and re-upload for a new file.
  async update(id: string, title: string) {
    const doc = await this.findOrThrow(id);
    doc.title = title;
    return this.repo.save(doc);
  }

  async getFilePath(id: string): Promise<{ filePath: string; originalName: string }> {
    const doc = await this.findOrThrow(id);
    if (!fs.existsSync(doc.filePath)) throw new NotFoundException('Document file is missing on the server');
    return { filePath: path.resolve(doc.filePath), originalName: doc.originalName };
  }

  async remove(id: string) {
    const doc = await this.findOrThrow(id);
    discardFile(doc.filePath);
    await this.repo.remove(doc);
    return { ok: true };
  }
}
