import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { amountToOmaniWords } from './number-to-words.util';
import { formatQty, formatQtyWithUnit, unitLabel } from '../units/units';

export interface InvoicePdfItem {
  description: string;
  quantity: number;
  // pcs | bags | kg | litre | ton - shown as "10 Bags", "2.500 Tons"
  unit?: string;
  unitPrice: number;
  vatRate: number;
  lineTotal: number;
}

export interface InvoicePdfData {
  invoiceNumber: string;
  version: number;
  issueDate: string;
  dueDate?: string;
  deliveryDate?: string;
  quotationNumber?: string;
  companyName: string;
  companyVatin: string;
  companyAddress?: string;
  companyPhone?: string;
  customerName: string;
  customerAddress?: string;
  customerPhone?: string;
  customerVatin?: string;
  items: InvoicePdfItem[];
  // Standardized totals breakdown — same five figures shown the same way
  // across all three templates: Gross, Discount, Taxable, VAT, Net.
  grossAmount: number;
  discountAmount: number;
  taxableAmount: number;
  vatAmount: number;
  netAmount: number;
  vatExcluded: boolean;
  paymentType?: string;
  deliveryMethod?: string;
  logoBase64?: string;
  template: 'classic' | 'formal' | 'po_style';
  // Reuses the exact same three layouts for Quotations — only the
  // title text changes ("INVOICE" -> "QUOTATION"). Defaults to invoice
  // for backward compatibility with existing call sites.
  // Reuses the exact same three layouts for Quotations and Delivery
  // Notes — only the title text changes. Defaults to invoice for
  // backward compatibility with existing call sites.
  documentType?: 'invoice' | 'quotation' | 'delivery_note' | 'credit_note';
  // Label for the quotationNumber row (default "Quotation No"); a credit
  // note uses it for the original invoice number.
  referenceLabel?: string;
}

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank Transfer',
  card_machine: 'Card Payment',
  cheque: 'Cheque',
  conditional: 'Conditional Payment',
};

function paymentTypeLabel(paymentType?: string) {
  if (!paymentType) return '-';
  return PAYMENT_TYPE_LABELS[paymentType] || paymentType;
}

function deliveryMethodLabel(method?: string) {
  if (method === 'on_site') return 'Delivery on Site';
  if (method === 'in_store') return 'In Store Delivery';
  return '-';
}

function docLabel(data: InvoicePdfData, base: string) {
  if (data.documentType === 'quotation') {
    return base.replace(/INVOICE/g, 'QUOTATION').replace(/Invoice/g, 'Quotation');
  }
  if (data.documentType === 'delivery_note') {
    return base.replace(/INVOICE/g, 'DELIVERY NOTE').replace(/Invoice/g, 'Delivery Note');
  }
  if (data.documentType === 'credit_note') {
    return base.replace(/INVOICE/g, 'CREDIT NOTE').replace(/Invoice/g, 'Credit Note');
  }
  return base;
}

const GREEN = '#2f6f22';
const GREEN_DARK = '#234420';
const GREEN_LIGHT = '#eaf6e6';

async function drawWatermark(doc: PDFKit.PDFDocument, logoBase64: string | undefined, opacity = 0.07) {
  if (!logoBase64) return;
  const logoBuf = Buffer.from(logoBase64, 'base64');
  const size = 260;
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  doc.save();
  doc.opacity(opacity);
  doc.image(logoBuf, (pageWidth - size) / 2, (pageHeight - size) / 2, { width: size, height: size });
  doc.opacity(1);
  doc.restore();
}

async function drawQr(doc: PDFKit.PDFDocument, data: InvoicePdfData, x: number, y: number, size = 64) {
  const payload = JSON.stringify({
    vatin: data.companyVatin,
    invoiceNumber: data.invoiceNumber,
    date: data.issueDate,
    total: data.netAmount,
  });
  const qrDataUrl = await QRCode.toDataURL(payload, { margin: 0, width: 150 });
  const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');
  doc.image(qrBuffer, x, y, { width: size, height: size });
}

// ---------- CLASSIC: round logo, centered watermark, minimal ----------
async function renderClassic(doc: PDFKit.PDFDocument, data: InvoicePdfData) {
  const pageWidth = doc.page.width;
  await drawWatermark(doc, data.logoBase64, 0.06);

  if (data.logoBase64) {
    doc.image(Buffer.from(data.logoBase64, 'base64'), 40, 40, { width: 46, height: 46 });
  }
  doc.fontSize(17).fillColor(GREEN_DARK).text(data.companyName, 96, 44);
  doc.fontSize(10).fillColor('#6b7062').text(`VATIN: ${data.companyVatin}`, 96, 64);

  // Right-hand column of header text: give every line of it an explicit
  // width so align:'right' aligns against the page's actual right margin
  // (pageWidth - 40) instead of pdfkit's default, which is the true page
  // edge — that mismatch is what pushed this text past the margin line.
  const rightColX = 300;
  const rightColWidth = pageWidth - 40 - rightColX;
  doc.fontSize(21).fillColor('#4C9A3B')
    .text(docLabel(data, data.vatExcluded ? 'INVOICE (VAT EXCLUDED)' : 'INVOICE'), rightColX, 44, { width: rightColWidth, align: 'right' });
  doc.fontSize(10).fillColor('#333')
    .text(`${docLabel(data, 'Invoice No')}: ${data.invoiceNumber} (v${data.version})`, rightColX, 68, { width: rightColWidth, align: 'right' })
    .text(`Date: ${data.issueDate}`, rightColX, 81, { width: rightColWidth, align: 'right' });
  if (data.dueDate) doc.text(`Due: ${data.dueDate}`, rightColX, 94, { width: rightColWidth, align: 'right' });
  if (data.deliveryDate) doc.text(`Delivery: ${data.deliveryDate}`, rightColX, 107, { width: rightColWidth, align: 'right' });
  if (data.quotationNumber) doc.text(`${data.referenceLabel || 'Quotation No'}: ${data.quotationNumber}`, rightColX, 120, { width: rightColWidth, align: 'right' });

  doc.moveTo(40, 136).lineTo(pageWidth - 40, 136).strokeColor('#4C9A3B').lineWidth(2).stroke();

  // Bill To — field order: Name, Address, Phone, VATIN (same everywhere).
  let y = 154;
  doc.fontSize(10).fillColor('#8a8f80').text('BILL TO', 40, y);
  y += 15;
  doc.fontSize(12).fillColor('#24291f').text(data.customerName, 40, y);
  y += 17;
  doc.fontSize(10).fillColor('#6b7062');
  if (data.customerAddress) { doc.text(data.customerAddress, 40, y); y += 14; }
  if (data.customerPhone) { doc.text(data.customerPhone, 40, y); y += 14; }
  if (data.customerVatin) { doc.text(`VATIN: ${data.customerVatin}`, 40, y); y += 14; }
  if (data.paymentType) {
    doc.fontSize(10).fillColor('#6b7062').text(`Payment: ${paymentTypeLabel(data.paymentType)}`, rightColX, 154, { width: rightColWidth, align: 'right' });
  }
  if (data.deliveryMethod) {
    doc.fontSize(10).fillColor('#6b7062').text(`Delivery Method: ${deliveryMethodLabel(data.deliveryMethod)}`, rightColX, 168, { width: rightColWidth, align: 'right' });
  }

  y = Math.max(y + 14, 232);
  doc.rect(40, y, pageWidth - 80, 22).fill(GREEN_DARK);
  doc.fillColor('#fff').fontSize(10);
  doc.text('Item', 46, y + 6, { width: 180 });
  doc.text('Qty', 228, y + 6, { width: 72, align: 'right' });
  doc.text('Unit Price', 300, y + 6, { width: 80, align: 'right' });
  doc.text('VAT', 380, y + 6, { width: 60, align: 'right' });
  doc.text('Total', 445, y + 6, { width: 90, align: 'right' });
  y += 28;

  doc.fillColor('#24291f').fontSize(10);
  for (const item of data.items) {
    doc.text(item.description, 46, y, { width: 180 });
    doc.text(formatQtyWithUnit(item.quantity, item.unit), 228, y, { width: 72, align: 'right' });
    doc.text(item.unitPrice.toFixed(3), 300, y, { width: 80, align: 'right' });
    doc.text(data.vatExcluded ? '-' : ((item.unitPrice * item.quantity * item.vatRate) / 100).toFixed(3), 380, y, { width: 60, align: 'right' });
    doc.text(item.lineTotal.toFixed(3), 445, y, { width: 90, align: 'right' });
    y += 22;
  }

  const pageHeight = doc.page.height;
  y = pageHeight - 228;
  doc.moveTo(340, y).lineTo(pageWidth - 40, y).strokeColor('#dcdad3').lineWidth(1).stroke();
  y += 10;
  const rows: [string, string][] = [
    ['Gross Amount', data.grossAmount.toFixed(3)],
    ['Discount Amount', data.discountAmount ? data.discountAmount.toFixed(3) : '-'],
    ['Taxable Amount', data.taxableAmount.toFixed(3)],
    ['VAT Amount (5%)', data.vatAmount.toFixed(3)],
  ];
  doc.fontSize(10).fillColor('#555');
  for (const [label, value] of rows) {
    doc.text(label, 340, y, { width: 90 });
    doc.text(`${value} OMR`, 445, y, { width: 90, align: 'right' });
    y += 17;
  }
  doc.fontSize(14).fillColor(GREEN_DARK);
  doc.text('Net Amount', 340, y, { width: 90 });
  doc.text(`${data.netAmount.toFixed(3)} OMR`, 445, y, { width: 90, align: 'right' });

  await drawQr(doc, data, 40, pageHeight - 140, 70);
  doc.fontSize(8).fillColor('#999').text('Scan to verify', 40, pageHeight - 66);

  doc.fontSize(9).fillColor('#8a8f80')
    .text('Prepared By: ______________________', 200, pageHeight - 100);
  doc.text('Received By: ______________________', 350, pageHeight - 100);
}

// ---------- FORMAL: bordered boxes, bank details, 3 signatures ----------
async function renderFormal(doc: PDFKit.PDFDocument, data: InvoicePdfData) {
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const margin = 34;
  const pad = 13; // standard inner padding for every box/cell in this template
  const boxLeft = margin, boxRight = pageWidth - margin, boxTop = margin, boxBottom = pageHeight - margin;

  await drawWatermark(doc, data.logoBase64, 0.07);

  doc.rect(boxLeft, boxTop, boxRight - boxLeft, boxBottom - boxTop).strokeColor(GREEN).lineWidth(1.5).stroke();

  // Title bar
  const titleH = 28;
  doc.rect(boxLeft, boxTop, boxRight - boxLeft, titleH).fill(GREEN_LIGHT);
  doc.fontSize(14).fillColor(GREEN).text(docLabel(data, data.vatExcluded ? 'TAX INVOICE (VAT EXCLUDED)' : 'TAX INVOICE'), boxLeft, boxTop + 9, { width: boxRight - boxLeft, align: 'center' });
  doc.moveTo(boxLeft, boxTop + titleH).lineTo(boxRight, boxTop + titleH).strokeColor(GREEN).lineWidth(1.5).stroke();

  // Header: company (left) | doc info (right)
  const headerTop = boxTop + titleH;
  // Quotations don't carry payment terms (no payment has happened yet).
  const infoRows: [string, string][] = [
    [docLabel(data, 'Invoice No.'), data.invoiceNumber],
    ['Date', data.issueDate],
    ...(data.documentType === 'quotation' ? [] : [['Payment Terms', paymentTypeLabel(data.paymentType)] as [string, string]]),
    ['Due Date', data.dueDate || '-'],
    ['Delivery Date', data.deliveryDate || '-'],
  ];
  if (data.quotationNumber) infoRows.push([data.referenceLabel || 'Quotation No', data.quotationNumber]);
  const headerHeight = 26 + infoRows.length * 15;
  const midX = boxLeft + (boxRight - boxLeft) * 0.58;
  doc.moveTo(midX, headerTop).lineTo(midX, headerTop + headerHeight).strokeColor(GREEN).lineWidth(1.5).stroke();
  doc.moveTo(boxLeft, headerTop + headerHeight).lineTo(boxRight, headerTop + headerHeight).strokeColor(GREEN).lineWidth(1.5).stroke();

  if (data.logoBase64) doc.image(Buffer.from(data.logoBase64, 'base64'), boxLeft + pad, headerTop + pad, { width: 42, height: 42 });
  doc.fontSize(12.5).fillColor(GREEN_DARK).text(data.companyName, boxLeft + pad + 50, headerTop + pad);
  doc.fontSize(9).fillColor('#444').text(
    `${data.companyAddress || 'Sultanate of Oman'}\nVATIN: ${data.companyVatin}${data.companyPhone ? '  |  Tel: ' + data.companyPhone : ''}`,
    boxLeft + pad + 50, headerTop + pad + 16, { width: midX - boxLeft - pad - 58, lineGap: 2 },
  );

  let iy = headerTop + pad;
  const rowH = (headerHeight - pad) / infoRows.length;
  for (const [label, value] of infoRows) {
    doc.fontSize(9).fillColor(GREEN).text(label, midX + pad, iy, { width: 95 });
    doc.fillColor('#222').text(value, midX + pad + 98, iy, { width: boxRight - midX - pad - 106 });
    iy += rowH;
  }

  // Party row — Bill To (left) | Terms of Delivery (right)
  const partyTop = headerTop + headerHeight;
  const partyHeight = 72;
  doc.moveTo(midX, partyTop).lineTo(midX, partyTop + partyHeight).strokeColor(GREEN).lineWidth(1.5).stroke();
  doc.moveTo(boxLeft, partyTop + partyHeight).lineTo(boxRight, partyTop + partyHeight).strokeColor(GREEN).lineWidth(1.5).stroke();

  doc.fontSize(9).fillColor(GREEN).text('BILL TO', boxLeft + pad, partyTop + pad);
  doc.fontSize(10.5).fillColor('#111').text(data.customerName, boxLeft + pad, partyTop + pad + 15);
  const custLines = [data.customerAddress, data.customerPhone, data.customerVatin ? `VATIN: ${data.customerVatin}` : undefined].filter(Boolean).join('\n');
  doc.fontSize(9).fillColor('#444').text(custLines, boxLeft + pad, partyTop + pad + 32, { width: midX - boxLeft - pad * 2, lineGap: 3 });

  doc.fontSize(9).fillColor(GREEN).text('TERMS OF DELIVERY', midX + pad, partyTop + pad);
  doc.fontSize(9).fillColor('#444').text(deliveryMethodLabel(data.deliveryMethod), midX + pad, partyTop + pad + 17);

  // Items table
  const tableTop = partyTop + partyHeight;
  const colX = [boxLeft, boxLeft + 32, boxLeft + 232, boxLeft + 285, boxLeft + 348, boxLeft + 390, boxLeft + 448];
  const headers = ['Sl', 'Description of Goods', 'Qty', 'Rate', 'Unit', 'VAT', 'Amount'];
  const tableHeaderH = 22;
  doc.rect(boxLeft, tableTop, boxRight - boxLeft, tableHeaderH).fill(GREEN);
  doc.fontSize(9).fillColor('#fff');
  headers.forEach((h, i) => {
    const w = (colX[i + 1] || boxRight) - colX[i];
    doc.text(h, colX[i] + 6, tableTop + 7, { width: w - 10, align: i >= 2 ? 'right' : 'left' });
  });

  const itemRowH = 21;
  let ty = tableTop + tableHeaderH + 6;
  doc.fontSize(9).fillColor('#222');
  data.items.forEach((item, idx) => {
    const vals = [
      String(idx + 1),
      item.description,
      formatQty(item.quantity, item.unit),
      item.unitPrice.toFixed(3),
      unitLabel(item.unit),
      data.vatExcluded ? '-' : ((item.unitPrice * item.quantity * item.vatRate) / 100).toFixed(3),
      item.lineTotal.toFixed(3),
    ];
    vals.forEach((v, i) => {
      const w = (colX[i + 1] || boxRight) - colX[i];
      doc.text(v, colX[i] + 6, ty, { width: w - 10, align: i >= 2 ? 'right' : (i === 0 ? 'center' : 'left') });
    });
    ty += itemRowH;
  });

  // Bottom stack anchored near bottom of outer box
  const bottomHeight = 182;
  const bottomTop = boxBottom - bottomHeight;
  doc.moveTo(boxLeft, bottomTop).lineTo(boxRight, bottomTop).strokeColor(GREEN).lineWidth(1.5).stroke();

  const wordsWidth = (boxRight - boxLeft) * 0.58;
  const totalsBlockH = 66;
  doc.moveTo(boxLeft + wordsWidth, bottomTop).lineTo(boxLeft + wordsWidth, bottomTop + totalsBlockH).strokeColor(GREEN).lineWidth(1.5).stroke();
  doc.fontSize(9).fillColor(GREEN).text('AMOUNT CHARGEABLE (IN WORDS)', boxLeft + pad, bottomTop + pad);
  doc.fontSize(9.5).fillColor('#333').text(amountToOmaniWords(data.netAmount), boxLeft + pad, bottomTop + pad + 15, { width: wordsWidth - pad * 2, lineGap: 2 });

  const totalRows: [string, string, boolean?][] = [
    ['Gross Amount', data.grossAmount.toFixed(3)],
    ['Discount Amount', data.discountAmount ? data.discountAmount.toFixed(3) : '-'],
    ['Taxable Amount', data.taxableAmount.toFixed(3)],
    ['VAT Amount (5%)', data.vatAmount.toFixed(3)],
    ['Net Amount (OMR)', data.netAmount.toFixed(3), true],
  ];
  let ry = bottomTop + 7;
  const rowStep = 10;
  for (const [label, value, grand] of totalRows) {
    doc.fillColor(grand ? GREEN_DARK : '#333').fontSize(grand ? 10.5 : 9);
    doc.text(label, boxLeft + wordsWidth + pad, ry, { width: 95 });
    doc.text(value, boxLeft + wordsWidth + pad + 98, ry, { width: boxRight - (boxLeft + wordsWidth) - pad - 106, align: 'right' });
    ry += grand ? 10 : rowStep;
  }

  const sigTop = bottomTop + totalsBlockH;
  doc.moveTo(boxLeft, sigTop).lineTo(boxRight, sigTop).strokeColor(GREEN).lineWidth(1.5).stroke();
  const bankWidth = wordsWidth;
  doc.moveTo(boxLeft + bankWidth, sigTop).lineTo(boxLeft + bankWidth, boxBottom).strokeColor(GREEN).lineWidth(1.5).stroke();
  doc.fontSize(9).fillColor(GREEN).text("COMPANY'S BANK DETAILS", boxLeft + pad, sigTop + pad);
  doc.fontSize(9).fillColor('#444').text(
    `A/c Holder: ${data.companyName}\nBank: Bank Muscat\nIBAN: OM57...`,
    boxLeft + pad, sigTop + pad + 15, { width: bankWidth - pad * 2, lineGap: 3 },
  );

  const sigAreaLeft = boxLeft + bankWidth;
  const sigColW = (boxRight - sigAreaLeft) / 3;
  const sigLabels = ['Prepared By', 'Verified By', 'Received By'];
  sigLabels.forEach((label, i) => {
    const x = sigAreaLeft + i * sigColW;
    if (i > 0) doc.moveTo(x, sigTop).lineTo(x, boxBottom).strokeColor('#cfe8c8').lineWidth(1).stroke();
    doc.fontSize(9).fillColor(GREEN_DARK).text(label, x + 6, boxBottom - 20, { width: sigColW - 12, align: 'center' });
  });
}

// ---------- PO_STYLE: letterhead header, Gross/Taxable/Net breakdown ----------
async function renderPoStyle(doc: PDFKit.PDFDocument, data: InvoicePdfData) {
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const margin = 34;
  const pad = 10;
  const boxLeft = margin, boxRight = pageWidth - margin, boxTop = margin, boxBottom = pageHeight - margin;

  await drawWatermark(doc, data.logoBase64, 0.07);
  doc.rect(boxLeft, boxTop, boxRight - boxLeft, boxBottom - boxTop).strokeColor(GREEN_DARK).lineWidth(1.5).stroke();

  // Letterhead
  const letterheadH = 58;
  if (data.logoBase64) doc.image(Buffer.from(data.logoBase64, 'base64'), boxLeft + pad, boxTop + pad, { width: 36, height: 36 });
  doc.fontSize(15).fillColor(GREEN_DARK).text(data.companyName.toUpperCase(), boxLeft + pad + 46, boxTop + pad);
  doc.fontSize(9).fillColor('#444').text(
    `${data.companyAddress || 'Sultanate of Oman'} | CR No: 1400123
Tel: ${data.companyPhone || '-'} | VATIN: ${data.companyVatin}`,
    boxLeft + pad + 46, boxTop + pad + 17, { width: boxRight - boxLeft - pad * 2 - 46, lineGap: 2 },
  );
  doc.moveTo(boxLeft, boxTop + letterheadH).lineTo(boxRight, boxTop + letterheadH).strokeColor(GREEN_DARK).lineWidth(1.5).stroke();

  // Title bar
  const titleH = 26;
  doc.rect(boxLeft, boxTop + letterheadH, boxRight - boxLeft, titleH).fill('#4C9A3B');
  doc.fontSize(12).fillColor('#fff').text(
    docLabel(data, data.vatExcluded ? 'TAX INVOICE (VAT EXCLUDED)' : 'TAX INVOICE'),
    boxLeft, boxTop + letterheadH + 7, { width: boxRight - boxLeft, align: 'center' },
  );

  // Info grid — customer (left) | doc info (right), plain label:value
  const infoTop = boxTop + letterheadH + titleH;
  const rightRows: [string, string][] = [
    ['Doc No', data.invoiceNumber],
    ['Doc Date', data.issueDate],
    ['Currency', 'OMR'],
    ...(data.documentType === 'quotation' ? [] : [['Payment Terms', paymentTypeLabel(data.paymentType)] as [string, string]]),
    ['Delivery Method', deliveryMethodLabel(data.deliveryMethod)],
    ['Delivery Date', data.deliveryDate || '-'],
  ];
  if (data.quotationNumber) rightRows.push([data.referenceLabel || 'Quotation No', data.quotationNumber]);
  const infoH = pad * 2 + Math.max(4, rightRows.length) * 15 - 15;
  doc.moveTo(boxLeft, infoTop + infoH).lineTo(boxRight, infoTop + infoH).strokeColor(GREEN_DARK).lineWidth(1.5).stroke();
  const infoMid = boxLeft + (boxRight - boxLeft) * 0.55;
  doc.moveTo(infoMid, infoTop).lineTo(infoMid, infoTop + infoH).strokeColor('#cfe0c8').lineWidth(1).stroke();

  const leftRows: [string, string][] = [
    ['Customer', data.customerName],
    ['Address', data.customerAddress || '-'],
    ['Tel No', data.customerPhone || '-'],
    ['VATIN', data.customerVatin || '-'],
  ];
  let ly = infoTop + pad;
  for (const [label, value] of leftRows) {
    doc.fontSize(9).fillColor(GREEN_DARK).text(`${label} :`, boxLeft + pad, ly, { width: 62 });
    doc.fillColor('#222').text(value, boxLeft + pad + 66, ly, { width: infoMid - boxLeft - pad - 74 });
    ly += 15;
  }

  let ry = infoTop + pad;
  for (const [label, value] of rightRows) {
    doc.fontSize(9).fillColor(GREEN_DARK).text(`${label} :`, infoMid + pad, ry, { width: 82 });
    doc.fillColor('#222').text(value, infoMid + pad + 86, ry, { width: boxRight - infoMid - pad - 94 });
    ry += 15;
  }

  // Items table
  const tableTop = infoTop + infoH;
  const colX = [boxLeft, boxLeft + 34, boxLeft + 195, boxLeft + 232, boxLeft + 274, boxLeft + 332, boxLeft + 401, boxLeft + 454];
  const headers = ['S NO', 'Item Name', 'Units', 'Qty', 'Rate', 'Taxable', 'VAT', 'Total'];
  const tableHeaderH = 24;
  doc.rect(boxLeft, tableTop, boxRight - boxLeft, tableHeaderH).fill(GREEN_LIGHT);
  doc.fontSize(9).fillColor(GREEN_DARK);
  headers.forEach((h, i) => {
    const w = (colX[i + 1] || boxRight) - colX[i];
    doc.text(h, colX[i] + 6, tableTop + 7, { width: w - 10, align: i >= 2 ? 'right' : (i === 0 ? 'center' : 'left') });
  });
  doc.moveTo(boxLeft, tableTop + tableHeaderH).lineTo(boxRight, tableTop + tableHeaderH).strokeColor(GREEN_DARK).lineWidth(1.5).stroke();

  const itemRowH = 20;
  let iy = tableTop + tableHeaderH + 6;
  doc.fontSize(9).fillColor('#222');
  data.items.forEach((item, idx) => {
    const taxable = item.unitPrice * item.quantity;
    const vat = data.vatExcluded ? 0 : (taxable * item.vatRate) / 100;
    const vals = [
      String(idx + 1),
      item.description,
      unitLabel(item.unit),
      formatQty(item.quantity, item.unit),
      item.unitPrice.toFixed(3),
      taxable.toFixed(3),
      vat.toFixed(3),
      item.lineTotal.toFixed(3),
    ];
    vals.forEach((v, i) => {
      const w = (colX[i + 1] || boxRight) - colX[i];
      doc.text(v, colX[i] + 6, iy, { width: w - 10, align: i >= 3 ? 'right' : (i <= 0 || i === 2 ? 'center' : 'left') });
    });
    iy += itemRowH;
  });

  // Bottom: narration (left) + gross/taxable/vat/net (right). Reserves
  // 205pt above the signature row for this block, but when the item
  // table is short it rises to sit just below the table instead of
  // floating far down the page with a big empty gap above it.
  const bottomReserve = 205;
  const bottomTop = Math.min(boxBottom - bottomReserve, iy + 16);
  doc.moveTo(boxLeft, bottomTop).lineTo(boxRight, bottomTop).strokeColor(GREEN_DARK).lineWidth(1.5).stroke();
  doc.fontSize(9).fillColor(GREEN_DARK).text('Narration :', boxLeft + pad, bottomTop + pad);

  const sumX = boxLeft + (boxRight - boxLeft) * 0.55;
  const sumRows: [string, string, boolean?][] = [
    ['Gross Amount :', data.grossAmount.toFixed(3)],
    ['Discount Amount :', data.discountAmount ? data.discountAmount.toFixed(3) : '-'],
    ['Taxable Amount :', data.taxableAmount.toFixed(3)],
    ['VAT Amount (5%) :', data.vatAmount.toFixed(3)],
    ['Net Amount :', data.netAmount.toFixed(3), true],
  ];
  let sy = bottomTop + pad;
  for (const [label, value, grand] of sumRows) {
    doc.fontSize(grand ? 11 : 9).fillColor(grand ? GREEN_DARK : '#333');
    doc.text(label, sumX, sy, { width: 92 });
    doc.text(value, sumX + 96, sy, { width: boxRight - sumX - pad - 96, align: 'right' });
    sy += grand ? 13 : 12;
  }

  const wordsTop = bottomTop + 96;
  doc.moveTo(boxLeft, wordsTop).lineTo(boxRight, wordsTop).dash(2, { space: 2 }).strokeColor('#b9c9b3').lineWidth(1).stroke();
  doc.undash();
  doc.fontSize(9).fillColor(GREEN_DARK).text('Net Amount in words :', boxLeft + pad, wordsTop + pad - 2);
  doc.fontSize(9).fillColor('#333').text(amountToOmaniWords(data.netAmount), boxLeft + pad, wordsTop + pad + 11, { width: boxRight - boxLeft - pad * 2, lineGap: 2 });

  // Signature row at very bottom — tall enough to actually sign in,
  // with a short line sitting just above each label to sign on.
  const sigHeight = 58;
  const sigTop = boxBottom - sigHeight;
  doc.moveTo(boxLeft, sigTop).lineTo(boxRight, sigTop).strokeColor(GREEN_DARK).lineWidth(1.5).stroke();
  const sigColW = (boxRight - boxLeft) / 3;
  const sigLabels = ['Prepared By', 'Checked By', 'Approved By'];
  sigLabels.forEach((label, i) => {
    const x = boxLeft + i * sigColW;
    if (i > 0) doc.moveTo(x, sigTop).lineTo(x, boxBottom).strokeColor('#b9c9b3').lineWidth(1).stroke();
    doc.moveTo(x + 16, boxBottom - 22).lineTo(x + sigColW - 16, boxBottom - 22).strokeColor('#9fb896').lineWidth(0.75).stroke();
    doc.fontSize(9).fillColor(GREEN_DARK).text(label, x, boxBottom - 16, { width: sigColW, align: 'center' });
  });
}


export async function generateInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 0 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const render = async () => {
        if (data.template === 'formal') await renderFormal(doc, data);
        else if (data.template === 'po_style') await renderPoStyle(doc, data);
        else await renderClassic(doc, data);
        doc.end();
      };
      render().catch(reject);
    } catch (err) {
      reject(err);
    }
  });
}
