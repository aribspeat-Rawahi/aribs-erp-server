import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { Employee } from './employee.entity';
import { EmployeeDocument } from './employee-document.entity';
import { ArchiveEmployeeDto, CreateEmployeeDto, UpdateEmployeeDto } from './dto/hr.dto';
import { verifyFileSignature } from '../common/file-signature.util';
import { discardFile } from '../common/discard-file.util';

@Injectable()
export class EmployeeService {
  private photoUploadDir: string;

  constructor(
    @InjectRepository(Employee)
    private repo: Repository<Employee>,
    @InjectRepository(EmployeeDocument)
    private documentRepo: Repository<EmployeeDocument>,
    private config: ConfigService,
  ) {
    this.photoUploadDir = this.config.get('EMPLOYEE_PHOTO_UPLOAD_DIR') || './uploads/employee-photos';
    fs.mkdirSync(this.photoUploadDir, { recursive: true });
  }

  findAll() {
    return this.repo.find();
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Employee not found');
    return item;
  }

  findByBiometricId(biometricId: string) {
    return this.repo.findOne({ where: { biometricId } });
  }

  // biometricId is a unique column, but it's optional — an empty string
  // ('' from a cleared form field) must be stored as NULL, not '', or
  // the second employee left blank would collide on the unique index
  // (MySQL treats NULL as "no value" for uniqueness, but not '').
  private async checkBiometricIdFree(biometricId: string | null | undefined, excludeId?: string) {
    if (!biometricId) return;
    const existing = await this.repo.findOne({
      where: { biometricId, ...(excludeId ? { id: Not(excludeId) } : {}) },
    });
    if (existing) throw new ConflictException('This Biometric ID is already assigned to another employee');
  }

  // Keeps the `active` flag (read by Payroll/Shift-staff-count logic) in
  // sync whenever `status` is set: Terminated -> inactive, Working/Others
  // -> active. Runs on both create and update.
  private syncActiveFromStatus(item: Employee, status: string | undefined) {
    if (status === undefined) return;
    item.active = status !== 'terminated';
  }

  async create(dto: CreateEmployeeDto) {
    await this.checkBiometricIdFree(dto.biometricId);
    const item = this.repo.create({ ...dto, biometricId: dto.biometricId || null } as any) as unknown as Employee;
    this.syncActiveFromStatus(item, dto.status);
    return this.repo.save(item);
  }

  async update(id: string, dto: UpdateEmployeeDto) {
    const item = await this.findOne(id);
    if (dto.biometricId !== undefined) await this.checkBiometricIdFree(dto.biometricId, id);
    Object.assign(item, dto);
    if (dto.biometricId !== undefined) item.biometricId = (dto.biometricId || null) as unknown as string;
    // Only auto-derive `active` from `status` when the caller isn't
    // explicitly setting `active` itself (e.g. the existing Deactivate
    // button, which only sends { active: false }).
    if (dto.active === undefined) this.syncActiveFromStatus(item, dto.status);
    return this.repo.save(item);
  }

  // Soft-deactivate rather than delete, so historical attendance/payroll
  // records tied to this employee stay intact.
  async deactivate(id: string) {
    const item = await this.findOne(id);
    item.active = false;
    return this.repo.save(item);
  }

  // "Delete" now archives instead of erasing — moves the employee off the
  // main Employees list into the Old Employees or Temporary Employees
  // folder (chosen in the frontend's Archive modal, based on how many
  // days they actually worked). Data stays fully intact and restorable.
  async archive(id: string, dto: ArchiveEmployeeDto) {
    const item = await this.findOne(id);
    item.archiveType = dto.archiveType;
    item.archivedAt = new Date();
    item.active = false;
    item.status = 'terminated';
    return this.repo.save(item);
  }

  // Moves an employee back out of the Old/Temporary Employees folder onto
  // the normal active Employees list.
  async restore(id: string) {
    const item = await this.findOne(id);
    item.archiveType = null;
    item.archivedAt = null;
    item.active = true;
    item.status = 'working';
    return this.repo.save(item);
  }

  // Hard delete — permanently removes the employee row. Used only from
  // within the Old/Temporary Employees folders now (for a genuine mistake
  // entry — never joined, or a duplicate), guarded by a strong warning in
  // the frontend since, unlike archive(), this cannot be undone. Attendance/Payroll
  // records reference employeeId as a plain string (no DB foreign key), so
  // this cannot fail on those; their rows are simply left with an
  // employeeId that no longer resolves (their staffName snapshot is
  // unaffected). Use Deactivate instead when the goal is just to mark
  // someone as no longer active while keeping their record.
  //
  // The employee's own uploaded files (profile photo, documents) ARE
  // cleaned up here, though — those have no snapshot of their own, so
  // left behind they'd just be dead files nothing can ever list, open or
  // remove again once the employee row is gone.
  async remove(id: string) {
    const item = await this.findOne(id);

    discardFile(item.photoPath);
    discardFile(item.guardianPhotoPath);
    discardFile(item.nomineePhotoPath);

    const docs = await this.documentRepo.find({ where: { employeeId: id } });
    for (const doc of docs) {
      discardFile(doc.filePath);
    }
    if (docs.length > 0) await this.documentRepo.remove(docs);

    await this.repo.remove(item);
    return { success: true };
  }

  // Saves/replaces the employee's profile photo (PNG/JPG). Old file (if
  // any, with a different extension) is removed so repeated re-uploads
  // don't accumulate orphaned images — same pattern as the expense
  // invoice upload.
  async uploadPhoto(id: string, file: Express.Multer.File) {
    const item = await this.findOne(id);
    const { extension: ext } = verifyFileSignature(file.buffer, ['jpeg', 'png']);
    const fileName = `${id}${ext}`;
    const filePath = path.join(this.photoUploadDir, fileName);

    if (item.photoPath && item.photoPath !== filePath && fs.existsSync(item.photoPath)) {
      fs.unlinkSync(item.photoPath);
    }

    fs.writeFileSync(filePath, file.buffer);
    item.photoPath = filePath;
    return this.repo.save(item);
  }

  async getPhotoFilePath(id: string): Promise<string> {
    const item = await this.findOne(id);
    if (!item.photoPath || !fs.existsSync(item.photoPath)) {
      throw new NotFoundException('No photo uploaded for this employee');
    }
    return path.resolve(item.photoPath);
  }

  // Guardian/Nominee photos — part of the "Others Detail" section. Same
  // save/replace pattern as uploadPhoto()/getPhotoFilePath() above, just
  // targeting a different column and a sub-folder of the same upload dir
  // so these stay easy to find separately from profile photos on disk.
  private async uploadOtherPhoto(id: string, file: Express.Multer.File, column: 'guardianPhotoPath' | 'nomineePhotoPath', subDir: string) {
    const item = await this.findOne(id);
    const dir = path.join(this.photoUploadDir, subDir);
    fs.mkdirSync(dir, { recursive: true });
    const { extension: ext } = verifyFileSignature(file.buffer, ['jpeg', 'png']);
    const fileName = `${id}${ext}`;
    const filePath = path.join(dir, fileName);

    const existing = item[column];
    if (existing && existing !== filePath && fs.existsSync(existing)) {
      fs.unlinkSync(existing);
    }

    fs.writeFileSync(filePath, file.buffer);
    item[column] = filePath;
    return this.repo.save(item);
  }

  private async getOtherPhotoFilePath(id: string, column: 'guardianPhotoPath' | 'nomineePhotoPath', label: string): Promise<string> {
    const item = await this.findOne(id);
    const filePath = item[column];
    if (!filePath || !fs.existsSync(filePath)) {
      throw new NotFoundException(`No ${label} photo uploaded for this employee`);
    }
    return path.resolve(filePath);
  }

  uploadGuardianPhoto(id: string, file: Express.Multer.File) {
    return this.uploadOtherPhoto(id, file, 'guardianPhotoPath', 'guardian-photos');
  }

  getGuardianPhotoFilePath(id: string) {
    return this.getOtherPhotoFilePath(id, 'guardianPhotoPath', 'guardian');
  }

  uploadNomineePhoto(id: string, file: Express.Multer.File) {
    return this.uploadOtherPhoto(id, file, 'nomineePhotoPath', 'nominee-photos');
  }

  getNomineePhotoFilePath(id: string) {
    return this.getOtherPhotoFilePath(id, 'nomineePhotoPath', 'nominee');
  }
}
