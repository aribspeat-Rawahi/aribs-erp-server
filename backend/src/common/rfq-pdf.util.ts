import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';
import { formatQty, unitLabel } from '../units/units';

// Request for Quotation (RFQ) PDF in the usual Omani business layout:
// bilingual (English / Arabic) letterhead and headings, company C.R. No.
// and VATIN, prices asked in Omani Rial to three decimals (baisa), VAT at
// 5% shown separately (Oman VAT Law), a blank price table for the
// supplier to fill, the supplier's own C.R. No. / VATIN, terms, and a
// signature & company stamp block. Arabic uses the bundled Noto Naskh
// Arabic font (SIL Open Font License); if it is missing the PDF is made
// in English only.

export interface RfqPdfItem {
  description: string;
  quantity: number;
  unit?: string;
}

export interface RfqPdfData {
  rfqNumber: string;
  date: string;
  quotesDueBy?: string | null;
  reference?: string | null; // purchase requisition number
  title: string;
  notes?: string | null;
  companyName: string;
  companyNameArabic?: string | null;
  companyVatin?: string | null;
  companyCrNumber?: string | null;
  companyAddress?: string | null;
  companyPhone?: string | null;
  companyEmail?: string | null;
  logoBase64?: string;
  supplier?: {
    name: string;
    contactPerson?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    vatin?: string | null;
    paymentTermsDays?: number | null;
  } | null;
  items: RfqPdfItem[];
  preparedBy?: string | null;
}

const GREEN = '#2f6f22';
const GREEN_DARK = '#234420';
const GREEN_LIGHT = '#eaf6e6';
const GREY = '#555';
const LINE = '#9db894';

function fontDir(): string | null {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'assets', 'fonts'),
    path.resolve(__dirname, '..', '..', '..', 'assets', 'fonts'),
    path.resolve(process.cwd(), 'assets', 'fonts'),
    path.resolve(process.cwd(), 'backend', 'assets', 'fonts'),
  ];
  return candidates.find((d) => fs.existsSync(path.join(d, 'NotoNaskhArabic-Regular.ttf'))) || null;
}

export async function generateRfqPdf(data: RfqPdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const dir = fontDir();
  const hasArabic = !!dir;
  // fontkit trips over the mark anchors of a few letter pairs in this font
  // (e.g. "آخ", "الإ"): such text is laid out without the mark feature
  // instead of failing the whole PDF
  if (dir) {
    doc.registerFont('ar', path.join(dir, 'NotoNaskhArabic-Regular.ttf'));
    doc.registerFont('arb', path.join(dir, 'NotoNaskhArabic-Bold.ttf'));
  }
  // call with the Arabic font already selected (pdfkit keeps the fontkit
  // font of the current font in _font.font)
  const arFeatures = (text: string): any => {
    try {
      (doc as any)._font.font.layout(text, ['rtla']);
      return ['rtla'];
    } catch {
      return { rtla: true, mark: false };
    }
  };
  const L = 36;
  const R = doc.page.width - 36;
  const W = R - L;

  // Arabic text: one line, laid out right-to-left (fontkit "rtla")
  const ar = (text: string, x: number, y: number, width: number, opts: { size?: number; bold?: boolean; color?: string; align?: 'left' | 'right' | 'center' } = {}) => {
    if (!hasArabic || !text) return;
    doc.font(opts.bold ? 'arb' : 'ar');
    doc
      .fontSize(opts.size || 8.5)
      .fillColor(opts.color || GREY)
      .text(text, x, y, { width, align: opts.align || 'right', lineBreak: false, features: arFeatures(text) } as PDFKit.Mixins.TextOptions);
    doc.font('Helvetica');
  };
  const en = (text: string, x: number, y: number, opts: PDFKit.Mixins.TextOptions & { size?: number; bold?: boolean; color?: string } = {}) => {
    const { size, bold, color, ...rest } = opts;
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(size || 9)
      .fillColor(color || '#222')
      .text(text, x, y, rest);
  };

  // ---- letterhead
  let x0 = L;
  if (data.logoBase64) {
    try {
      doc.image(Buffer.from(data.logoBase64, 'base64'), L, 34, { fit: [54, 54] });
      x0 = L + 64;
    } catch {
      /* unreadable logo - leave it out */
    }
  }
  en(data.companyName, x0, 38, { size: 16, bold: true, color: GREEN_DARK, width: data.companyNameArabic ? R - x0 - 230 : R - x0, lineBreak: false, ellipsis: true });
  if (data.companyNameArabic) ar(data.companyNameArabic, R - 220, 34, 220, { size: 15, bold: true, color: GREEN_DARK });
  const idLine = [data.companyCrNumber ? `C.R. No. ${data.companyCrNumber}` : '', data.companyVatin ? `VATIN ${data.companyVatin}` : ''].filter(Boolean).join('   |   ');
  const contactLine = [data.companyAddress, data.companyPhone ? `Tel: ${data.companyPhone}` : '', data.companyEmail || ''].filter(Boolean).join('   |   ');
  const idWithCountry = idLine ? `${idLine}   |   Sultanate of Oman` : 'Sultanate of Oman';
  en(contactLine || idWithCountry, x0, 60, { size: 8.5, color: GREY, width: R - x0 - 130, lineBreak: false, ellipsis: true });
  if (contactLine) en(idWithCountry, x0, 73, { size: 8.5, color: GREY, width: R - x0 - 130, lineBreak: false, ellipsis: true });
  ar('سلطنة عُمان', R - 120, 56, 120, { size: 9 });
  doc.moveTo(L, 94).lineTo(R, 94).lineWidth(1.5).strokeColor(GREEN).stroke();

  // ---- title band
  doc.rect(L, 102, W, 28).fill(GREEN);
  en('REQUEST FOR QUOTATION', L + 12, 110, { size: 13, bold: true, color: '#fff', width: 300, lineBreak: false });
  ar('طلب عرض سعر', R - 212, 104, 200, { size: 14, bold: true, color: '#fff' });

  // ---- supplier box (left) and RFQ details (right)
  const boxTop = 140;
  const boxH = 112;
  const mid = L + W * 0.52;
  doc.lineWidth(0.8).strokeColor(LINE);
  doc.rect(L, boxTop, mid - L - 6, boxH).stroke();
  doc.rect(mid + 6, boxTop, R - mid - 6, boxH).stroke();

  en('TO (SUPPLIER)', L + 10, boxTop + 8, { size: 8, bold: true, color: GREEN });
  ar('إلى السادة', mid - 116, boxTop + 4, 100, { size: 8.5, color: GREEN });
  const s = data.supplier;
  if (s) {
    en(`M/s ${s.name}`, L + 10, boxTop + 22, { size: 10.5, bold: true, width: mid - L - 26, lineBreak: false, ellipsis: true });
    const lines = [
      s.contactPerson ? `Attn: ${s.contactPerson}` : '',
      s.address || '',
      [s.phone ? `Tel: ${s.phone}` : '', s.email || ''].filter(Boolean).join('  |  '),
      s.vatin ? `VATIN: ${s.vatin}` : '',
    ].filter(Boolean);
    en(lines.join('\n'), L + 10, boxTop + 38, { size: 8.5, color: GREY, width: mid - L - 26, height: boxH - 44, lineGap: 2.5 });
  } else {
    en('M/s', L + 10, boxTop + 26, { size: 9.5, bold: true });
    for (let i = 0; i < 3; i++) {
      const y = boxTop + 38 + i * 17;
      doc.moveTo(L + (i === 0 ? 34 : 10), y).lineTo(mid - 16, y).dash(1.5, { space: 2 }).strokeColor('#aaa').stroke().undash();
    }
    en('Attn: / Tel: / VATIN:', L + 10, boxTop + 84, { size: 7.5, color: '#999' });
  }

  const rowStep = 18;
  const rows: [string, string, string][] = [
    ['RFQ No.', data.rfqNumber, 'رقم الطلب'],
    ['Date', data.date, 'التاريخ'],
    ['Quotation due by', data.quotesDueBy || '-', 'آخر موعد للعرض'],
    ['Our reference', data.reference || '-', 'المرجع'],
    ['Currency', 'Omani Rial (OMR)', 'العملة'],
  ];
  const rx = mid + 16;
  const rw = R - mid - 26;
  rows.forEach(([label, value, arLabel], i) => {
    const y = boxTop + 10 + i * rowStep;
    en(label, rx, y, { size: 8, color: GREEN, width: 82, lineBreak: false });
    en(value, rx + 84, y, { size: 8.5, bold: i === 0, width: rw - 84 - 70, lineBreak: false, ellipsis: true });
    ar(arLabel, R - 80, y - 3, 70, { size: 8, color: GREEN });
  });

  // ---- subject and letter text
  let y = boxTop + boxH + 12;
  en('Subject:', L, y, { size: 9, bold: true, color: GREEN_DARK, width: 50, lineBreak: false });
  en(data.title, L + 50, y, { size: 9, bold: true, width: W - 50 - 60 });
  ar('الموضوع', R - 60, y - 3, 60, { size: 8.5, color: GREEN });
  y = Math.max(doc.y, y + 12) + 8;
  en('Dear Sir / Madam,', L, y, { size: 9 });
  y += 14;
  en(
    `Please quote your best prices for the items below in Omani Rial (OMR, three decimals), showing VAT separately at 5% if you are VAT registered in Oman. ` +
      `Kindly send your signed and stamped quotation${data.quotesDueBy ? ` on or before ${data.quotesDueBy}` : ''}, quoting our RFQ No. ${data.rfqNumber}.`,
    L,
    y,
    { size: 9, color: '#333', width: W, lineGap: 2 },
  );
  y = doc.y + 10;

  // ---- items table (prices left blank for the supplier)
  const cols = [
    { en: 'S.No', ar: 'م', w: 32, align: 'center' as const },
    { en: 'Description', ar: 'الوصف', w: 199, align: 'left' as const },
    { en: 'Unit', ar: 'الوحدة', w: 50, align: 'center' as const },
    { en: 'Qty', ar: 'الكمية', w: 62, align: 'right' as const },
    { en: 'Unit Price (OMR)', ar: 'سعر الوحدة', w: 90, align: 'right' as const },
    { en: 'Amount (OMR)', ar: 'المبلغ', w: W - 32 - 199 - 50 - 62 - 90, align: 'right' as const },
  ];
  const headH = hasArabic ? 30 : 20;
  const rowH = 22;
  const bottomLimit = doc.page.height - 60;
  const drawHead = (top: number) => {
    doc.rect(L, top, W, headH).fill(GREEN);
    let cx = L;
    for (const c of cols) {
      en(c.en, cx + 4, top + 5, { size: 8, bold: true, color: '#fff', width: c.w - 8, align: c.align, lineBreak: false });
      ar(c.ar, cx + 4, top + 14, c.w - 8, { size: 7.5, color: '#e6f2e2', align: c.align === 'left' ? 'left' : c.align });
      cx += c.w;
    }
    return top + headH;
  };
  const gridRow = (top: number, h: number, fill?: string) => {
    if (fill) doc.rect(L, top, W, h).fill(fill);
    doc.lineWidth(0.5).strokeColor(LINE).rect(L, top, W, h).stroke();
    let cx = L;
    for (const c of cols.slice(0, -1)) {
      cx += c.w;
      doc.moveTo(cx, top).lineTo(cx, top + h).stroke();
    }
  };
  y = drawHead(y);
  data.items.forEach((it, i) => {
    if (y + rowH > bottomLimit - 40) {
      doc.addPage();
      y = drawHead(40);
    }
    gridRow(y, rowH, i % 2 ? '#fafcf9' : undefined);
    let cx = L;
    const cells = [String(i + 1), it.description, unitLabel(it.unit), formatQty(it.quantity, it.unit), '', ''];
    cells.forEach((v, j) => {
      en(v, cx + 4, y + 7, { size: 8.5, width: cols[j].w - 8, align: cols[j].align, lineBreak: false, ellipsis: true });
      cx += cols[j].w;
    });
    y += rowH;
  });

  // totals (blank, for the supplier)
  const totals: [string, string][] = [
    ['Total before VAT', 'المجموع قبل الضريبة'],
    ['VAT 5%', 'ضريبة القيمة المضافة'],
    ['Total incl. VAT', 'الإجمالي شامل الضريبة'],
  ];
  y += 8;
  if (y + totals.length * 20 + 230 > bottomLimit) {
    doc.addPage();
    y = 40;
  }
  const tLabelX = L + cols[0].w + cols[1].w + cols[2].w;
  const tLabelW = cols[3].w + cols[4].w;
  const tValX = tLabelX + tLabelW;
  const tValW = cols[5].w;
  totals.forEach(([label, arLabel], i) => {
    const grand = i === totals.length - 1;
    if (grand) doc.rect(tLabelX, y, tLabelW + tValW, 20).fill(GREEN_LIGHT);
    doc.lineWidth(0.5).strokeColor(LINE).rect(tLabelX, y, tLabelW, 20).stroke().rect(tValX, y, tValW, 20).stroke();
    en(label, tLabelX + 4, y + 6, { size: 8, bold: grand, color: GREEN_DARK, width: tLabelW / 2, lineBreak: false });
    ar(arLabel, tLabelX + tLabelW / 2, y + 3, tLabelW / 2 - 4, { size: 7.5, color: GREEN_DARK });
    y += 20;
  });
  // left of the totals: what the supplier must state
  const offerTop = y - totals.length * 20;
  const offerW = cols[0].w + cols[1].w + cols[2].w - 10;
  en("SUPPLIER'S OFFER", L, offerTop, { size: 8, bold: true, color: GREEN });
  ar('بيانات عرض المورد', L + offerW - 130, offerTop - 3, 130, { size: 8, color: GREEN });
  const offer = ['Quotation ref. & date', 'Validity of offer', 'Delivery period', 'Payment terms', 'Supplier C.R. No.', 'Supplier VATIN'];
  offer.forEach((label, i) => {
    const oy = offerTop + 13 + i * 14;
    en(label, L, oy, { size: 7.5, color: GREY, width: 100, lineBreak: false });
    doc.moveTo(L + 100, oy + 8).lineTo(L + offerW, oy + 8).dash(1.2, { space: 2 }).strokeColor('#bbb').lineWidth(0.5).stroke().undash();
  });
  y = Math.max(y, offerTop + 13 + offer.length * 14) + 12;

  // ---- terms
  const terms = [
    'Prices in Omani Rial (OMR) to three decimal places. VAT, where applicable, at the standard rate of 5% under the Oman VAT Law, shown separately.',
    'Please state the validity of your offer (at least 30 days), the delivery period and your payment terms' +
      (s?.paymentTermsDays !== undefined && s?.paymentTermsDays !== null ? ` (our usual terms with you: ${s.paymentTermsDays === 0 ? 'cash on delivery' : `${s.paymentTermsDays} days`}).` : '.'),
    `Delivery to our premises${data.companyAddress ? ` (${data.companyAddress})` : ''} unless otherwise agreed; prices to include delivery.`,
    'Quote your Commercial Registration (C.R.) No. and VATIN. A valid tax invoice is required with every delivery.',
    'Quantities may be ordered in part. We may accept any quotation in whole or in part, or none.',
    'This is a request for prices only and not an order. Goods are ordered only by our signed and approved Purchase Order.',
  ];
  if (data.notes) terms.push(data.notes);
  en('TERMS & CONDITIONS', L, y, { size: 8, bold: true, color: GREEN });
  ar('الشروط والأحكام', R - 150, y - 3, 150, { size: 8, color: GREEN });
  y += 13;
  terms.forEach((t, i) => {
    en(`${i + 1}.`, L, y, { size: 7.8, color: '#333', width: 12 });
    en(t, L + 13, y, { size: 7.8, color: '#333', width: W - 13, lineGap: 1.5 });
    y = doc.y + 3;
  });

  // ---- signatures
  y += 10;
  if (y + 70 > bottomLimit) {
    doc.addPage();
    y = 40;
  }
  const sigW = (W - 20) / 2;
  doc.lineWidth(0.8).strokeColor(LINE).rect(L, y, sigW, 66).stroke().rect(L + sigW + 20, y, sigW, 66).stroke();
  en(`For ${data.companyName}`, L + 8, y + 7, { size: 8, bold: true, color: GREEN_DARK, width: sigW - 16, lineBreak: false, ellipsis: true });
  if (data.preparedBy) en(`Prepared by: ${data.preparedBy}`, L + 8, y + 20, { size: 7.5, color: GREY, width: sigW - 16, lineBreak: false, ellipsis: true });
  en('Authorised Signatory', L + 8, y + 52, { size: 7.5, color: GREY });
  ar('التوقيع المعتمد', L + sigW - 108, y + 49, 100, { size: 7.5 });
  en("Supplier's Signature & Company Stamp", L + sigW + 28, y + 52, { size: 7.5, color: GREY });
  ar('توقيع وختم المورد', R - 108, y + 49, 100, { size: 7.5 });
  en('Name / Date:', L + sigW + 28, y + 7, { size: 7.5, color: GREY });

  // ---- footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // the footer sits below the normal bottom margin
    const fy = doc.page.height - 30;
    doc.moveTo(L, fy - 6).lineTo(R, fy - 6).lineWidth(0.5).strokeColor(LINE).stroke();
    en(`${data.rfqNumber}  ·  Request for Quotation  ·  not a purchase order`, L, fy, { size: 7, color: '#888', width: W / 2, lineBreak: false });
    en(`Page ${i - range.start + 1} of ${range.count}`, L + W / 2, fy, { size: 7, color: '#888', width: W / 2, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}
