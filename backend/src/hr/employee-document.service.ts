import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { EmployeeDocument } from './employee-document.entity';
import { EmployeeService } from './employee.service';
import { verifyFileSignature } from '../common/file-signature.util';
import { discardFile } from '../common/discard-file.util';

@Injectable()
export class EmployeeDocumentService {
  private uploadDir: string;

  constructor(
    @InjectRepository(EmployeeDocument)
    private repo: Repository<EmployeeDocument>,
    private employeeService: EmployeeService,
    private config: ConfigService,
  ) {
    this.uploadDir = this.config.get('EMPLOYEE_DOCUMENT_UPLOAD_DIR') || './uploads/employee-documents';
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  // A single employee can have many documents (Residence ID, Passport,
  // Visa, ...), so each upload adds a new row rather than replacing one —
  // unlike the single profile photo / expense invoice.
  async upload(employeeId: string, label: string, file: Express.Multer.File) {
    await this.employeeService.findOne(employeeId); // 404s if the employee doesn't exist

    const { extension: ext } = verifyFileSignature(file.buffer, ['pdf', 'jpeg', 'png']);
    const fileName = `${employeeId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const filePath = path.join(this.uploadDir, fileName);
    fs.writeFileSync(filePath, file.buffer);

    const doc = this.repo.create({
      employeeId,
      label,
      originalName: file.originalname,
      filePath,
    });
    return this.repo.save(doc);
  }

  findByEmployee(employeeId: string) {
    return this.repo.find({ where: { employeeId }, order: { uploadedAt: 'DESC' } });
  }

  private async findOwned(employeeId: string, docId: string) {
    const doc = await this.repo.findOne({ where: { id: docId, employeeId } });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  async getFilePath(employeeId: string, docId: string): Promise<{ filePath: string; originalName: string }> {
    const doc = await this.findOwned(employeeId, docId);
    if (!fs.existsSync(doc.filePath)) throw new NotFoundException('Document file is missing on the server');
    return { filePath: path.resolve(doc.filePath), originalName: doc.originalName };
  }

  async remove(employeeId: string, docId: string) {
    const doc = await this.findOwned(employeeId, docId);
    discardFile(doc.filePath);
    await this.repo.remove(doc);
    return { ok: true };
  }
}
