#!/usr/bin/env node
// Turns an off-site backup file (aribs-erp-<time>.tar.gz.enc, downloaded
// from Cloudflare R2) back into a normal .tar.gz you can open.
//
// Usage (on any computer with Node.js 18+):
//   OFFSITE_BACKUP_PASSPHRASE='your passphrase' node decrypt-offsite-backup.js aribs-erp-XXXX.tar.gz.enc
// -> writes aribs-erp-XXXX.tar.gz next to it. Inside:
//      database/<name>.sql   (restore it in Settings > Database Backup > Restore)
//      uploads/...           (copy back into the server's data folder)
//
// If the passphrase is wrong or the file was changed/corrupted, it stops
// with an error and deletes the partial output - nothing half-decrypted is kept.
const crypto = require('crypto');
const fs = require('fs');
const { pipeline } = require('stream/promises');

const MAGIC = Buffer.from('ARIBSBK1', 'ascii');
const HEADER_LEN = MAGIC.length + 16 + 12; // magic + salt + iv
const TAG_LEN = 16;

async function main() {
  const input = process.argv[2];
  const passphrase = process.env.OFFSITE_BACKUP_PASSPHRASE;
  if (!input || !passphrase) {
    console.error("Usage: OFFSITE_BACKUP_PASSPHRASE='...' node decrypt-offsite-backup.js <file.tar.gz.enc> [output.tar.gz]");
    process.exit(2);
  }
  const output = process.argv[3] || input.replace(/\.enc$/, '') || `${input}.tar.gz`;
  if (output === input) throw new Error('Output file name would overwrite the input.');

  const size = fs.statSync(input).size;
  if (size < HEADER_LEN + TAG_LEN) throw new Error('File is too small to be an ARIBS off-site backup.');

  const fd = fs.openSync(input, 'r');
  const header = Buffer.alloc(HEADER_LEN);
  const tag = Buffer.alloc(TAG_LEN);
  fs.readSync(fd, header, 0, HEADER_LEN, 0);
  fs.readSync(fd, tag, 0, TAG_LEN, size - TAG_LEN);
  fs.closeSync(fd);

  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not an ARIBS off-site backup file.');
  const salt = header.subarray(MAGIC.length, MAGIC.length + 16);
  const iv = header.subarray(MAGIC.length + 16, HEADER_LEN);
  const key = crypto.scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      fs.createReadStream(input, { start: HEADER_LEN, end: size - TAG_LEN - 1 }),
      decipher,
      fs.createWriteStream(output),
    );
  } catch (err) {
    fs.rmSync(output, { force: true });
    throw new Error('Could not decrypt: wrong passphrase, or the file is damaged.');
  }
  console.log(`Decrypted to ${output}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
