import * as fs from 'fs';
import * as path from 'path';

// Must be the FIRST import in main.ts.
//
// Every upload/backup location in this app defaults to a path relative to
// the process working directory (e.g. "./uploads/invoices"), and those
// relative paths are also what gets stored in the database (invoice.pdfPath,
// document.filePath, ...).
//
// On Hostinger, every Git auto-deploy rebuilds the app folder, so anything
// written inside it can disappear. Setting DATA_DIR to a folder OUTSIDE the
// app (e.g. /home/<user>/erp-data) moves the working directory there before
// any module loads, so all uploads, invoice PDFs and backups land in that
// persistent folder - and all existing relative paths in the database keep
// resolving correctly once the old "uploads" folder is copied into it.
//
// Leave DATA_DIR unset for local development (behaves exactly as before).
const dataDir = process.env.DATA_DIR?.trim();

if (dataDir) {
  const resolved = path.resolve(dataDir);
  fs.mkdirSync(resolved, { recursive: true });
  process.chdir(resolved);
  console.log(`[data-dir] Using persistent data directory: ${resolved}`);
}
