import api from './client';

// Invoices/Quotations/DeliveryNotes are all protected routes, so a plain
// <a href> to the API can't carry the JWT — fetch as a blob instead and
// hand the browser an object URL.
async function fetchPdfBlobUrl(path: string): Promise<string> {
  const res = await api.get(path, { responseType: 'blob' });
  return URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
}

export async function viewPdf(path: string) {
  const url = await fetchPdfBlobUrl(path);
  window.open(url, '_blank');
}

export async function downloadPdf(path: string, filename: string) {
  const url = await fetchPdfBlobUrl(path);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Like fetchPdfBlobUrl, but for files that might not be a PDF (e.g. an
// uploaded expense invoice scan, an employee photo, or an employee
// document can be a PNG/JPG too) — uses the server's actual Content-Type
// instead of assuming application/pdf. Exported so callers that need the
// object URL directly (e.g. an <img> thumbnail fed from a protected
// route) don't have to go through viewFile()'s window.open().
export async function fetchFileBlobUrl(path: string): Promise<string> {
  const res = await api.get(path, { responseType: 'blob' });
  const contentType = String(res.headers['content-type'] || 'application/octet-stream');
  return URL.createObjectURL(new Blob([res.data], { type: contentType }));
}

export async function viewFile(path: string) {
  const url = await fetchFileBlobUrl(path);
  window.open(url, '_blank');
}

// Generic protected-route download (not necessarily a PDF — e.g. the
// Settings page's database backup, which comes back as a .sql file).
// Uses the server's actual Content-Type/filename via a blob, same
// JWT-carrying approach as downloadPdf() above.
export async function downloadFile(path: string, filename: string) {
  const url = await fetchFileBlobUrl(path);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function openWhatsapp(linkPath: string) {
  const res = await api.get(linkPath);
  window.open(res.data.url, '_blank');
}
