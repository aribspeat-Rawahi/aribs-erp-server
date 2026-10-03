import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

export type SharedDocumentType = 'invoice' | 'quotation' | 'delivery_note';

const TYPE_CODES: Record<SharedDocumentType, string> = {
  invoice: 'i',
  quotation: 'q',
  delivery_note: 'd',
};
const CODE_TYPES: Record<string, SharedDocumentType> = { i: 'invoice', q: 'quotation', d: 'delivery_note' };

export interface VerifiedDocumentLink {
  type: SharedDocumentType;
  id: string;
}

// Creates and verifies "secure PDF links" that can be sent to a customer
// (e.g. inside a WhatsApp message) so they can open ONE document's PDF
// without logging in.
//
// A token = base64url("<typeCode>.<documentId>.<expiresAtUnixSeconds>")
//           + "." + HMAC-SHA256 signature of that payload.
// Nothing is stored in the database: the signature proves the server
// issued it, and the expiry inside it makes it stop working on its own.
@Injectable()
export class DocumentLinkService {
  private readonly logger = new Logger(DocumentLinkService.name);

  constructor(private readonly config: ConfigService) {}

  private get secret(): string | null {
    // A dedicated secret is preferred; falling back to JWT_SECRET (with a
    // distinct prefix) keeps links working if it hasn't been set yet.
    const dedicated = this.config.get<string>('DOCUMENT_LINK_SECRET');
    if (dedicated && dedicated.trim()) return dedicated.trim();
    const jwt = this.config.get<string>('JWT_SECRET');
    return jwt && jwt.trim() ? `document-link:${jwt.trim()}` : null;
  }

  private get baseUrl(): string | null {
    const url = this.config.get<string>('PUBLIC_BASE_URL');
    return url && url.trim() ? url.trim().replace(/\/+$/, '') : null;
  }

  private get ttlSeconds(): number {
    const days = Number(this.config.get<string>('DOCUMENT_LINK_TTL_DAYS') || 7);
    const safeDays = Number.isFinite(days) && days > 0 ? Math.min(days, 90) : 7;
    return Math.round(safeDays * 24 * 60 * 60);
  }

  private sign(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('base64url');
  }

  // Returns a full public URL, or null when PUBLIC_BASE_URL / a secret
  // isn't configured (callers then simply send the message without a link).
  createUrl(type: SharedDocumentType, id: string): string | null {
    const secret = this.secret;
    const base = this.baseUrl;
    if (!secret || !base) {
      this.logger.warn('Secure PDF links disabled: set PUBLIC_BASE_URL (and DOCUMENT_LINK_SECRET).');
      return null;
    }
    const expiresAt = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    const payload = `${TYPE_CODES[type]}.${id}.${expiresAt}`;
    const token = `${Buffer.from(payload).toString('base64url')}.${this.sign(payload, secret)}`;
    return `${base}/api/public/documents/${token}`;
  }

  // Returns the document the token points to, or null if the token is
  // malformed, tampered with or expired.
  verify(token: string): VerifiedDocumentLink | null {
    const secret = this.secret;
    if (!secret || typeof token !== 'string' || token.length > 512) return null;

    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    const encodedPayload = token.slice(0, dot);
    const signature = token.slice(dot + 1);

    let payload: string;
    try {
      payload = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    } catch {
      return null;
    }

    const expected = Buffer.from(this.sign(payload, secret));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

    const [code, id, expiresAtRaw] = payload.split('.');
    const type = CODE_TYPES[code];
    const expiresAt = Number(expiresAtRaw);
    if (!type || !id || !Number.isFinite(expiresAt)) return null;
    if (expiresAt < Math.floor(Date.now() / 1000)) return null;

    return { type, id };
  }
}
