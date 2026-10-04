# Restoring from the off-site backup (Cloudflare R2)

Use this only if the server's own backups are gone (hosting account lost,
server damaged). For normal mistakes, use **Settings > Database Backup** in the ERP.

## What you need
- Access to the Cloudflare account (R2 > bucket `aribs-erp-backups`)
- The encryption passphrase (`OFFSITE_BACKUP_PASSPHRASE`) - from your password manager / paper copy
- A computer with Node.js 18+ installed

## Steps
1. **Download the backup**: Cloudflare dashboard > R2 > `aribs-erp-backups` > folder `production` >
   pick the newest `aribs-erp-<date>.tar.gz.enc` > Download.
2. **Decrypt it** (in this repo's `backend/scripts` folder, or copy the script anywhere):
   ```bash
   OFFSITE_BACKUP_PASSPHRASE='your passphrase' node decrypt-offsite-backup.js aribs-erp-<date>.tar.gz.enc
   ```
   On Windows PowerShell:
   ```powershell
   $env:OFFSITE_BACKUP_PASSPHRASE='your passphrase'; node decrypt-offsite-backup.js aribs-erp-<date>.tar.gz.enc
   ```
   You get `aribs-erp-<date>.tar.gz`. Open it with 7-Zip / `tar -xzf`. Inside:
   - `database/aribs-erp-backup-....sql` - the full database
   - `uploads/...` - all uploaded files
3. **Bring the ERP up** on the (new) server as usual (empty database is fine).
4. **Restore the database**: log in as Admin > Settings > Database Backup > Restore >
   choose the `.sql` file > type RESTORE.
5. **Restore the files**: upload the `uploads` folder into the server's data folder
   (`DATA_DIR`, e.g. `/home/<user>/erp-data/uploads`) with the hosting File Manager / SFTP,
   replacing what is there.
6. Check a few invoices (PDF), employee documents and the company logo.

## Notes
- Wrong passphrase or damaged file: the script stops with an error and keeps nothing.
- Backups older than 30 days are removed automatically by the bucket's lifecycle rule.
