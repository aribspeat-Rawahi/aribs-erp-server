import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { CustomerBankAccount } from './customer-bank-account.entity';
import { CustomerService } from './customer.service';
import { UpsertCustomerBankAccountDto } from './dto/customer.dto';
import { verifyFileSignature } from '../common/file-signature.util';

@Injectable()
export class CustomerBankAccountService {
  private uploadDir: string;

  constructor(
    @InjectRepository(CustomerBankAccount)
    private repo: Repository<CustomerBankAccount>,
    private customerService: CustomerService,
    private config: ConfigService,
  ) {
    this.uploadDir = this.config.get('CUSTOMER_BANK_STATEMENT_UPLOAD_DIR') || './uploads/customer-bank-statements';
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  findByCustomer(customerId: string) {
    return this.repo.find({ where: { customerId }, order: { createdAt: 'ASC' } });
  }

  private async findOwned(customerId: string, id: string) {
    const item = await this.repo.findOne({ where: { id, customerId } });
    if (!item) throw new NotFoundException('Bank account not found');
    return item;
  }

  async create(customerId: string, dto: UpsertCustomerBankAccountDto) {
    await this.customerService.findOne(customerId); // 404s if the customer doesn't exist
    const item = this.repo.create({ ...dto, customerId });
    return this.repo.save(item);
  }

  async update(customerId: string, id: string, dto: UpsertCustomerBankAccountDto) {
    const item = await this.findOwned(customerId, id);
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  async remove(customerId: string, id: string) {
    const item = await this.findOwned(customerId, id);
    if (item.statementPath && fs.existsSync(item.statementPath)) fs.unlinkSync(item.statementPath);
    await this.repo.remove(item);
    return { ok: true };
  }

  async uploadStatement(customerId: string, id: string, file: Express.Multer.File) {
    const item = await this.findOwned(customerId, id);
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

  async getStatementFilePath(customerId: string, id: string): Promise<{ filePath: string; originalName: string }> {
    const item = await this.findOwned(customerId, id);
    if (!item.statementPath || !fs.existsSync(item.statementPath)) {
      throw new NotFoundException('No statement uploaded for this bank account');
    }
    return { filePath: path.resolve(item.statementPath), originalName: item.statementOriginalName || 'statement' };
  }
}
