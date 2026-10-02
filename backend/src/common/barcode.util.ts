import * as QRCode from 'qrcode';
import { randomBytes } from 'crypto';

// Generates a short, human-typeable unique code for a new product,
// e.g. FG-8F3K2A91. Used as the barcode value that gets printed/scanned.
export function generateProductCode(prefix: string = 'FG'): string {
  const random = randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${random}`;
}

// Renders a QR code (as a PNG data URL) for a given barcode value.
// Used both for printable product labels and for the QR code
// required on Oman-standard invoices.
export async function generateQrDataUrl(value: string): Promise<string> {
  return QRCode.toDataURL(value, { margin: 1, width: 300 });
}
