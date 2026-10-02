import PDFDocument from 'pdfkit';

// One line in the Statement of Account's transaction table — an invoice
// (debit, increases what the customer owes) or a payment (credit,
// reduces it). Sorted chronologically by InvoiceService before this file
// ever sees them.
export interface StatementTransaction {
  date: string;
  type: 'invoice' | 'payment';
  reference: string;
  description: string;
  debit: number;
  credit: number;
}

export interface StatementPdfData {
  customerName: string;
  customerAddress?: string;
  customerPhone?: string;
  customerVatin?: string;
  companyName: string;
  companyVatin: string;
  companyAddress?: string;
  companyPhone?: string;
  startDate: string;
  endDate: string;
  openingBalance: number;
  transactions: StatementTransaction[];
  closingBalance: number;
  logoBase64?: string;
}

const GREEN = '#2f6f22';
const GREEN_DARK = '#234420';
const GREEN_LIGHT = '#eaf6e6';

function omr(n: number) {
  return n.toFixed(3);
}

// Table column layout, shared between the header row and every body row
// so they always line up.
const COLS = {
  date: { x: 40, w: 65 },
  desc: { x: 105, w: 210 },
  ref: { x: 315, w: 75 },
  debit: { x: 390, w: 65 },
  credit: { x: 455, w: 65 },
  balance: { x: 520, w: 65 },
};

function drawTableHeader(doc: PDFKit.PDFDocument, y: number, pageWidth: number) {
  doc.rect(40, y, pageWidth - 80, 20).fill(GREEN_DARK);
  doc.fillColor('#fff').fontSize(9);
  doc.text('Date', COLS.date.x + 4, y + 6, { width: COLS.date.w });
  doc.text('Description', COLS.desc.x, y + 6, { width: COLS.desc.w });
  doc.text('Ref', COLS.ref.x, y + 6, { width: COLS.ref.w });
  doc.text('Debit', COLS.debit.x, y + 6, { width: COLS.debit.w, align: 'right' });
  doc.text('Credit', COLS.credit.x, y + 6, { width: COLS.credit.w, align: 'right' });
  doc.text('Balance', COLS.balance.x, y + 6, { width: COLS.balance.w - 6, align: 'right' });
  return y + 20;
}

function drawRow(
  doc: PDFKit.PDFDocument,
  y: number,
  cells: { date: string; desc: string; ref: string; debit: string; credit: string; balance: string },
  opts: { bold?: boolean; shaded?: boolean; pageWidth: number },
) {
  if (opts.shaded) {
    doc.rect(40, y - 2, opts.pageWidth - 80, 18).fill(GREEN_LIGHT);
  }
  doc.fillColor(opts.bold ? GREEN_DARK : '#24291f').fontSize(9);
  if (opts.bold) doc.font('Helvetica-Bold'); else doc.font('Helvetica');
  doc.text(cells.date, COLS.date.x + 4, y, { width: COLS.date.w });
  doc.text(cells.desc, COLS.desc.x, y, { width: COLS.desc.w });
  doc.text(cells.ref, COLS.ref.x, y, { width: COLS.ref.w });
  doc.text(cells.debit, COLS.debit.x, y, { width: COLS.debit.w, align: 'right' });
  doc.text(cells.credit, COLS.credit.x, y, { width: COLS.credit.w, align: 'right' });
  doc.text(cells.balance, COLS.balance.x, y, { width: COLS.balance.w - 6, align: 'right' });
  doc.font('Helvetica');
  return y + 18;
}

export async function generateStatementPdf(data: StatementPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 0 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;
      const bottomLimit = pageHeight - 60;

      function drawHeader() {
        if (data.logoBase64) {
          doc.image(Buffer.from(data.logoBase64, 'base64'), 40, 36, { width: 42, height: 42 });
        }
        doc.fontSize(15).fillColor(GREEN_DARK).text(data.companyName, 92, 38);
        doc.fontSize(9).fillColor('#6b7062').text(`VATIN: ${data.companyVatin}`, 92, 56);
        if (data.companyAddress) doc.text(data.companyAddress, 92, 68);
        if (data.companyPhone) doc.text(data.companyPhone, 92, 80);

        const rightX = 320;
        const rightW = pageWidth - 40 - rightX;
        doc.fontSize(18).fillColor('#4C9A3B').text('STATEMENT OF ACCOUNT', rightX, 40, { width: rightW, align: 'right' });
        doc.fontSize(9).fillColor('#333').text(`Period: ${data.startDate} to ${data.endDate}`, rightX, 62, { width: rightW, align: 'right' });
        doc.text(`Generated: ${new Date().toISOString().slice(0, 10)}`, rightX, 74, { width: rightW, align: 'right' });

        doc.moveTo(40, 96).lineTo(pageWidth - 40, 96).strokeColor('#4C9A3B').lineWidth(2).stroke();

        let y = 110;
        doc.fontSize(9).fillColor('#8a8f80').text('CUSTOMER', 40, y);
        y += 13;
        doc.fontSize(11).fillColor('#24291f').text(data.customerName, 40, y);
        y += 15;
        doc.fontSize(9).fillColor('#6b7062');
        if (data.customerAddress) { doc.text(data.customerAddress, 40, y); y += 12; }
        if (data.customerPhone) { doc.text(data.customerPhone, 40, y); y += 12; }
        if (data.customerVatin) { doc.text(`VATIN: ${data.customerVatin}`, 40, y); y += 12; }

        return Math.max(y + 8, 168);
      }

      let y = drawHeader();
      y = drawTableHeader(doc, y, pageWidth);

      y = drawRow(
        doc,
        y,
        { date: data.startDate, desc: 'Opening Balance', ref: '-', debit: '-', credit: '-', balance: omr(data.openingBalance) },
        { bold: true, shaded: true, pageWidth },
      );

      let running = data.openingBalance;
      for (const t of data.transactions) {
        if (y > bottomLimit) {
          doc.addPage();
          y = 40;
          y = drawTableHeader(doc, y, pageWidth);
        }
        running = Math.round((running + t.debit - t.credit) * 1000) / 1000;
        y = drawRow(
          doc,
          y,
          {
            date: t.date,
            desc: t.description,
            ref: t.reference,
            debit: t.debit ? omr(t.debit) : '-',
            credit: t.credit ? omr(t.credit) : '-',
            balance: omr(running),
          },
          { pageWidth },
        );
      }

      if (y > bottomLimit) {
        doc.addPage();
        y = 40;
      }
      y += 6;
      doc.moveTo(320, y).lineTo(pageWidth - 40, y).strokeColor('#dcdad3').lineWidth(1).stroke();
      y += 10;
      y = drawRow(
        doc,
        y,
        { date: '', desc: '', ref: '', debit: '', credit: 'Closing Balance', balance: omr(data.closingBalance) },
        { bold: true, shaded: true, pageWidth },
      );

      if (data.transactions.length === 0) {
        doc.fontSize(9).fillColor('#8a8f80').text('No transactions in this period.', 40, y + 10);
      }

      doc.fontSize(8).fillColor('#999').text(
        'This statement reflects transactions recorded in the system as of the generation date above.',
        40,
        pageHeight - 40,
        { width: pageWidth - 80 },
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
