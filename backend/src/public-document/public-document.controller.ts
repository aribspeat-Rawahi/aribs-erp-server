import * as fs from 'fs';
import * as path from 'path';
import { Controller, Get, NotFoundException, Param, Res, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { DocumentLinkService } from '../document-link/document-link.service';
import { InvoiceService } from '../invoice/invoice.service';
import { QuotationService } from '../quotation/quotation.service';
import { DeliveryNoteService } from '../delivery-note/delivery-note.service';

// The ONLY unauthenticated document endpoint: serves a single PDF to
// whoever holds a valid, unexpired secure link (see DocumentLinkService).
// Any problem (bad token, expired, deleted document) returns the same
// generic 404 so nothing about the system is revealed.
@Controller('public/documents')
export class PublicDocumentController {
  constructor(
    private readonly links: DocumentLinkService,
    private readonly invoices: InvoiceService,
    private readonly quotations: QuotationService,
    private readonly deliveryNotes: DeliveryNoteService,
  ) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get(':token')
  async getDocument(@Param('token') token: string, @Res() res: Response) {
    const notFound = new NotFoundException('This link is invalid or has expired.');
    const link = this.links.verify(token);
    if (!link) throw notFound;

    res.set({
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
    });

    try {
      if (link.type === 'invoice') {
        const invoice = await this.invoices.findOne(link.id);
        const filePath = await this.invoices.getPdfPath(link.id);
        if (!fs.existsSync(filePath)) throw notFound;
        res.set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${safeName(invoice.invoiceNumber, 'invoice')}.pdf"`,
        });
        return res.sendFile(path.resolve(filePath));
      }

      if (link.type === 'quotation') {
        const quotation = await this.quotations.findOne(link.id);
        const buffer = await this.quotations.generatePdfBuffer(link.id);
        res.set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${safeName(quotation.quotationNumber, 'quotation')}.pdf"`,
        });
        return res.send(buffer);
      }

      const note = await this.deliveryNotes.findOne(link.id);
      const buffer = await this.deliveryNotes.generatePdfBuffer(link.id);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${safeName(note.deliveryNoteNumber, 'delivery-note')}.pdf"`,
      });
      return res.send(buffer);
    } catch {
      throw notFound;
    }
  }
}

function safeName(value: string | undefined | null, fallback: string): string {
  const cleaned = String(value || '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}
