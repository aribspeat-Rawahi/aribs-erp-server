import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { SupplierBankAccount } from './supplier-bank-account.entity';
import { SupplierService } from './supplier.service';
import { UpsertSupplierBankAccountDto } from './dto/supplier.dto';
import { verifyFileSignature } from '../common/file-signature.util';
import { discardFile } from '../common/discard-file.util';

@Injectable()
export class SupplierBankAccountService {
  private uploadDir: string;

  constructor(
    @InjectRepository(SupplierBankAccount)
    private repo: Repository<SupplierBankAccount>,
    private supplierService: SupplierService,
    private config: ConfigService,
  ) {
    this.uploadDir = this.config.get('SUPPLIER_BANK_STATEMENT_UPLOAD_DIR') || './uploads/supplier-bank-statements';
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  findBySupplier(supplierId: string) {
    return this.repo.find({ where: { supplierId }, order: { createdAt: 'ASC' } });
  }

  private async findOwned(supplierId: string, id: string) {
    const item = await this.repo.findOne({ where: { id, supplierId } });
    if (!item) throw new NotFoundException('Bank account not found');
    return item;
  }

  async create(supplierId: string, dto: UpsertSupplierBankAccountDto) {
    await this.supplierService.findOne(supplierId); // 404s if the supplier doesn't exist
    const item = this.repo.create({ ...dto, supplierId });
    return this.repo.save(item);
  }

  async update(supplierId: string, id: string, dto: UpsertSupplierBankAccountDto) {
    const item = await this.findOwned(supplierId, id);
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  async remove(supplierId: string, id: string) {
    const item = await this.findOwned(supplierId, id);
    discardFile(item.statementPath);
    await this.repo.remove(item);
    return { ok: true };
  }

  async uploadStatement(supplierId: string, id: string, file: Express.Multer.File) {
    const item = await this.findOwned(supplierId, id);
    const { extension: ext } = verifyFileSignature(file.buffer, ['pdf', 'jpeg', 'png']);
    const fileName = `${id}-${Date.now()}${ext}`;
    const filePath = path.join(this.uploadDir, fileName);

    if (item.statementPath && item.statementPath !== filePath && fs.existsSync(item.statementPath)) {
      fs.unlinkSync(item.statementPath);
    }

    fs.writeFileSync(filePath, file.buffer);
    item.statementPath = filePath;
    item.statementOriginalName = file.originalname;
    return this.repo.save(item);
  }

  async getStatementFilePath(supplierId: string, id: string): Promise<{ filePath: string; originalName: string }> {
    const item = await this.findOwned(supplierId, id);
    if (!item.statementPath || !fs.existsSync(item.statementPath)) {
      throw new NotFoundException('No statement uploaded for this bank account');
    }
    return { filePath: path.resolve(item.statementPath), originalName: item.statementOriginalName || 'statement' };
  }
}
