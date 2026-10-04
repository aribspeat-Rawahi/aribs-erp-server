import * as fs from 'fs';
import { deletionContext } from '../deleted-records/deletion-context';

// Use instead of fs.unlinkSync when a record's file is deleted. Inside a
// DELETE request the file is only renamed (parked) so "Undo" can bring it
// back; parked files are removed when the undo window closes. Outside a
// DELETE request it is a plain delete. Never throws.
export function discardFile(filePath?: string | null) {
  if (!filePath) return;
  try {
    if (!fs.existsSync(filePath)) return;
    const ctx = deletionContext.getStore();
    if (ctx) {
      const parked = `${filePath}.deleted-${Date.now()}`;
      fs.renameSync(filePath, parked);
      ctx.files.push({ from: filePath, to: parked });
    } else {
      fs.unlinkSync(filePath);
    }
  } catch {
    /* file cleanup is best-effort */
  }
}
