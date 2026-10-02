import { BadRequestException } from '@nestjs/common';

// Client-supplied `mimetype` and `originalname` are both attacker
// controlled — a malicious upload can claim to be a PNG while actually
// being an HTML/JS payload, and an extension derived from `originalname`
// can smuggle in `..`, a double extension, or something executable.
// This sniffs the actual file content's magic bytes to determine the
// real type, and returns a safe, fixed extension derived from that
// detected type — never from anything the client sent.

export type DetectedFileType = 'jpeg' | 'png' | 'pdf' | 'zip';

interface SignatureDef {
  type: DetectedFileType;
  // Safe extension to use when saving a file detected as this type.
  extension: string;
  // Magic bytes to match at the start of the buffer.
  signature: number[];
}

const SIGNATURES: SignatureDef[] = [
  { type: 'jpeg', extension: '.jpg', signature: [0xff, 0xd8, 0xff] },
  { type: 'png', extension: '.png', signature: [0x89, 0x50, 0x4e, 0x47] },
  { type: 'pdf', extension: '.pdf', signature: [0x25, 0x50, 0x44, 0x46] },
  // .docx/.xlsx (and any other Office Open XML / plain ZIP) share this
  // signature — callers that accept those formats pass a mapping for
  // 'zip' to the extension they actually want saved.
  { type: 'zip', extension: '.zip', signature: [0x50, 0x4b, 0x03, 0x04] },
];

function detectType(buffer: Buffer): DetectedFileType | undefined {
  for (const def of SIGNATURES) {
    if (buffer.length >= def.signature.length && def.signature.every((byte, i) => buffer[i] === byte)) {
      return def.type;
    }
  }
  return undefined;
}

/**
 * Verifies that `buffer`'s real content matches one of `allowedTypes`
 * (sniffed from magic bytes, ignoring whatever mimetype/extension the
 * client claimed) and returns the safe extension to save it under.
 *
 * @param buffer uploaded file content (e.g. Express.Multer.File#buffer)
 * @param allowedTypes the detected types this upload endpoint accepts
 * @param extensionOverrides optional per-type extension overrides, e.g.
 *   { zip: '.docx' } for an endpoint that specifically accepts .docx
 * @throws BadRequestException if the content doesn't match any allowed type
 */
export function verifyFileSignature(
  buffer: Buffer,
  allowedTypes: DetectedFileType[],
  extensionOverrides?: Partial<Record<DetectedFileType, string>>,
): { type: DetectedFileType; extension: string } {
  const detected = detectType(buffer);
  if (!detected || !allowedTypes.includes(detected)) {
    throw new BadRequestException(
      'The uploaded file does not look like a valid ' + allowedTypes.join('/').toUpperCase() + ' file.',
    );
  }
  const def = SIGNATURES.find((s) => s.type === detected)!;
  const extension = extensionOverrides?.[detected] || def.extension;
  return { type: detected, extension };
}
