import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DeliveryNoteService } from './delivery-note.service';
import { CreateDeliveryNoteDto, UpdateDeliveryNoteDto } from './dto/delivery-note.dto';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

@Controller('delivery-notes')
export class DeliveryNoteController {
  constructor(private service: DeliveryNoteService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateDeliveryNoteDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDeliveryNoteDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/mark-delivered')
  markDelivered(@Param('id') id: string) {
    return this.service.markDelivered(id);
  }

  @Get(':id/pdf')
  async downloadPdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.service.generatePdfBuffer(id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="delivery-note-${id}.pdf"` });
    res.send(buffer);
  }

  @Get(':id/whatsapp-link')
  getWhatsappLink(@Param('id') id: string) {
    return this.service.getWhatsappLink(id);
  }

  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.remove(id, { userId: req.user?.userId, email: req.user?.email });
  }
}
