import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { SupplierDocument } from './supplier-document.entity';
import { SupplierService } from './supplier.service';
import { verifyFileSignature } from '../common/file-signature.util';
import { discardFile } from '../common/discard-file.util';

@Injectable()
export class SupplierDocumentService {
  private uploadDir: string;

  constructor(
    @InjectRepository(SupplierDocument)
    private repo: Repository<SupplierDocument>,
    private supplierService: SupplierService,
    private config: ConfigService,
  ) {
    this.uploadDir = this.config.get('SUPPLIER_DOCUMENT_UPLOAD_DIR') || './uploads/supplier-documents';
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  async upload(supplierId: string, docType: string, file: Express.Multer.File) {
    await this.supplierService.findOne(supplierId); // 404s if the supplier doesn't exist

    const { extension: ext } = verifyFileSignature(file.buffer, ['pdf', 'jpeg', 'png']);
    const fileName = `${supplierId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const filePath = path.join(this.uploadDir, fileName);
    fs.writeFileSync(filePath, file.buffer);

    const doc = this.repo.create({
      supplierId,
      docType,
      originalName: file.originalname,
      filePath,
    });
    return this.repo.save(doc);
  }

  findBySupplier(supplierId: string) {
    return this.repo.find({ where: { supplierId }, order: { uploadedAt: 'DESC' } });
  }

  private async findOwned(supplierId: string, docId: string) {
    const doc = await this.repo.findOne({ where: { id: docId, supplierId } });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  async getFilePath(supplierId: string, docId: string): Promise<{ filePath: string; originalName: string }> {
    const doc = await this.findOwned(supplierId, docId);
    if (!fs.existsSync(doc.filePath)) throw new NotFoundException('Document file is missing on the server');
    return { filePath: path.resolve(doc.filePath), originalName: doc.originalName };
  }

  async remove(supplierId: string, docId: string) {
    const doc = await this.findOwned(supplierId, docId);
    discardFile(doc.filePath);
    await this.repo.remove(doc);
    return { ok: true };
  }
}
