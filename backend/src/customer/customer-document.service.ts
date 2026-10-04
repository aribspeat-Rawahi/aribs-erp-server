import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { CustomerDocument } from './customer-document.entity';
import { CustomerService } from './customer.service';
import { verifyFileSignature } from '../common/file-signature.util';
import { discardFile } from '../common/discard-file.util';

@Injectable()
export class CustomerDocumentService {
  private uploadDir: string;

  constructor(
    @InjectRepository(CustomerDocument)
    private repo: Repository<CustomerDocument>,
    private customerService: CustomerService,
    private config: ConfigService,
  ) {
    this.uploadDir = this.config.get('CUSTOMER_DOCUMENT_UPLOAD_DIR') || './uploads/customer-documents';
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  // A single customer can have several documents (CR Paper, Vat Reg.
  // Paper, Riyada, Others), so each upload adds a new row rather than
  // replacing one.
  async upload(customerId: string, docType: string, file: Express.Multer.File) {
    await this.customerService.findOne(customerId); // 404s if the customer doesn't exist

    const { extension: ext } = verifyFileSignature(file.buffer, ['pdf', 'jpeg', 'png']);
    const fileName = `${customerId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const filePath = path.join(this.uploadDir, fileName);
    fs.writeFileSync(filePath, file.buffer);

    const doc = this.repo.create({
      customerId,
      docType,
      originalName: file.originalname,
      filePath,
    });
    return this.repo.save(doc);
  }

  findByCustomer(customerId: string) {
    return this.repo.find({ where: { customerId }, order: { uploadedAt: 'DESC' } });
  }

  private async findOwned(customerId: string, docId: string) {
    const doc = await this.repo.findOne({ where: { id: docId, customerId } });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  async getFilePath(customerId: string, docId: string): Promise<{ filePath: string; originalName: string }> {
    const doc = await this.findOwned(customerId, docId);
    if (!fs.existsSync(doc.filePath)) throw new NotFoundException('Document file is missing on the server');
    return { filePath: path.resolve(doc.filePath), originalName: doc.originalName };
  }

  async remove(customerId: string, docId: string) {
    const doc = await this.findOwned(customerId, docId);
    discardFile(doc.filePath);
    await this.repo.remove(doc);
    return { ok: true };
  }
}
