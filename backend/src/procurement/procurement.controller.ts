import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PurchaseRequisitionService } from './purchase-requisition.service';
import { RfqService } from './rfq.service';
import { AwardRfqDto, CreateRequisitionDto, CreateRfqDto, RfqQuoteDto, UpdateRequisitionDto } from './dto/procurement.dto';
import { ModuleAccess } from '../auth/module-access.decorator';

interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}
const actorOf = (req: AuthedRequest) => ({ userId: req.user?.userId, email: req.user?.email, role: req.user?.role });

// Suppliers > Requisitions. Anyone with Suppliers access may request;
// approval follows Settings > Approval rules.
@ModuleAccess('suppliers')
@Controller('purchase-requisitions')
export class PurchaseRequisitionController {
  constructor(private service: PurchaseRequisitionService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateRequisitionDto, @Req() req: AuthedRequest) {
    return this.service.create(dto, actorOf(req));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRequisitionDto, @Req() req: AuthedRequest) {
    return this.service.update(id, dto, actorOf(req));
  }

  @Post(':id/resubmit')
  resubmit(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.resubmit(id, actorOf(req));
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.cancel(id, actorOf(req));
  }

  @Post(':id/close')
  close(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.close(id, actorOf(req));
  }
}

// Suppliers > RFQs: ask several suppliers for prices, compare, choose.
@ModuleAccess('suppliers')
@Controller('rfqs')
export class RfqController {
  constructor(private service: RfqService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  // ?supplierId= fills in the "To" box for that supplier
  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @Query('supplierId') supplierId: string | undefined, @Res() res: Response) {
    const { buffer, fileName } = await this.service.pdf(id, supplierId || undefined);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fileName}"` });
    res.send(buffer);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateRfqDto, @Req() req: AuthedRequest) {
    return this.service.create(dto, actorOf(req));
  }

  @Post(':id/quotes')
  addQuote(@Param('id') id: string, @Body() dto: RfqQuoteDto, @Req() req: AuthedRequest) {
    return this.service.saveQuote(id, dto, actorOf(req));
  }

  @Patch(':id/quotes/:quoteId')
  updateQuote(@Param('id') id: string, @Param('quoteId') quoteId: string, @Body() dto: RfqQuoteDto, @Req() req: AuthedRequest) {
    return this.service.saveQuote(id, dto, actorOf(req), quoteId);
  }

  @Delete(':id/quotes/:quoteId')
  removeQuote(@Param('id') id: string, @Param('quoteId') quoteId: string) {
    return this.service.removeQuote(id, quoteId);
  }

  @Post(':id/award')
  award(@Param('id') id: string, @Body() dto: AwardRfqDto, @Req() req: AuthedRequest) {
    return this.service.award(id, dto, actorOf(req));
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.cancel(id, actorOf(req));
  }
}
