import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { EmployeeService } from './employee.service';
import { ArchiveEmployeeDto, CreateEmployeeDto, UpdateEmployeeDto } from './dto/hr.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';

const ALLOWED_PHOTO_MIME_TYPES = ['image/png', 'image/jpeg'];

@Controller('employees')
export class EmployeeController {
  constructor(private service: EmployeeService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Post()
  create(@Body() dto: CreateEmployeeDto) {
    return this.service.create(dto);
  }

  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    return this.service.update(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.service.deactivate(id);
  }

  // "Delete" from the main Employees list — moves the employee into the
  // Old Employees or Temporary Employees folder instead of erasing them.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Patch(':id/archive')
  archive(@Param('id') id: string, @Body() dto: ArchiveEmployeeDto) {
    return this.service.archive(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Patch(':id/restore')
  restore(@Param('id') id: string) {
    return this.service.restore(id);
  }

  // Permanent delete — only used from inside the Old/Temporary Employees
  // folders now. The frontend shows a strong confirm warning before
  // calling this, since (unlike archive/restore) it cannot be undone.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  // Upload (or replace) an employee's profile photo. Protected route —
  // photos are shown inside the app only, not public.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Post(':id/photo')
  @UseInterceptors(FileInterceptor('file'))
  uploadPhoto(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!ALLOWED_PHOTO_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Photo must be a PNG or JPG file');
    }
    return this.service.uploadPhoto(id, file);
  }

  // Protected (default JWT guard) — frontend fetches this as a blob,
  // same as the expense invoice file.
  @Get(':id/photo')
  async getPhoto(@Param('id') id: string, @Res() res: Response) {
    const filePath = await this.service.getPhotoFilePath(id);
    res.sendFile(filePath);
  }

  // "Others Detail" section — Guardian/Wife photo and Nominee photo.
  // Same upload/serve pattern as the profile photo above.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Post(':id/guardian-photo')
  @UseInterceptors(FileInterceptor('file'))
  uploadGuardianPhoto(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!ALLOWED_PHOTO_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Photo must be a PNG or JPG file');
    }
    return this.service.uploadGuardianPhoto(id, file);
  }

  @Get(':id/guardian-photo')
  async getGuardianPhoto(@Param('id') id: string, @Res() res: Response) {
    const filePath = await this.service.getGuardianPhotoFilePath(id);
    res.sendFile(filePath);
  }

  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Post(':id/nominee-photo')
  @UseInterceptors(FileInterceptor('file'))
  uploadNomineePhoto(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!ALLOWED_PHOTO_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Photo must be a PNG or JPG file');
    }
    return this.service.uploadNomineePhoto(id, file);
  }

  @Get(':id/nominee-photo')
  async getNomineePhoto(@Param('id') id: string, @Res() res: Response) {
    const filePath = await this.service.getNomineePhotoFilePath(id);
    res.sendFile(filePath);
  }
}
