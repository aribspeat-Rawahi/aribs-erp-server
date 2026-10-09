import { FileInterceptor } from '@nestjs/platform-express';

// Every file upload goes through a size limit: multer stops reading at the
// limit (413) instead of buffering an unbounded file in memory first.
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;

export const DocumentUpload = () => FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } });
export const BackupUpload = () => FileInterceptor('file', { limits: { fileSize: MAX_BACKUP_BYTES, files: 1 } });
