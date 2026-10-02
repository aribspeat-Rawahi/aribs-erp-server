import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { PayrollDocument } from './payroll-document.entity';
import { verifyFileSignature } from '../common/file-signature.util';

// Mirrors EmployeeDocumentService's pattern (same signature-verified
// upload + on-disk storage), keyed by payrollId instead of employeeId.
@Injectable()
export class PayrollDocumentService {
  private uploadDir: string;

  constructor(
    @InjectRepository(PayrollDocument)
    private repo: Repository<PayrollDocument>,
    private config: ConfigService,
  ) {
    this.uploadDir = this.config.get('PAYROLL_DOCUMENT_UPLOAD_DIR') || './uploads/payroll-documents';
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  async upload(payrollId: string, label: string, file: Express.Multer.File) {
    const { extension: ext } = verifyFileSignature(file.buffer, ['pdf', 'jpeg', 'png']);
    const fileName = `${payrollId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const filePath = path.join(this.uploadDir, fileName);
    fs.writeFileSync(filePath, file.buffer);

    const doc = this.repo.create({ payrollId, label, originalName: file.originalname, filePath });
    return this.repo.save(doc);
  }

  findByPayroll(payrollId: string) {
    return this.repo.find({ where: { payrollId }, order: { uploadedAt: 'DESC' } });
  }

  private async findOwned(payrollId: string, docId: string) {
    const doc = await this.repo.findOne({ where: { id: docId, payrollId } });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  // "Edit" only renames the label — same convention as CompanyDocument;
  // delete and re-upload for a new file.
  async update(payrollId: string, docId: string, label: string) {
    const doc = await this.findOwned(payrollId, docId);
    doc.label = label;
    return this.repo.save(doc);
  }

  async getFilePath(payrollId: string, docId: string): Promise<{ filePath: string; originalName: string }> {
    const doc = await this.findOwned(payrollId, docId);
    if (!fs.existsSync(doc.filePath)) throw new NotFoundException('Document file is missing on the server');
    return { filePath: path.resolve(doc.filePath), originalName: doc.originalName };
  }

  async remove(payrollId: string, docId: string) {
    const doc = await this.findOwned(payrollId, docId);
    if (fs.existsSync(doc.filePath)) fs.unlinkSync(doc.filePath);
    await this.repo.remove(doc);
    return { ok: true };
  }
}
