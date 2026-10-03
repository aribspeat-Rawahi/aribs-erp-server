import api from './client';
import { isNativeApp, openInNativeViewer, shareNativeFile } from './nativeApp';

// Invoices/Quotations/DeliveryNotes are all protected routes, so a plain
// <a href> to the API can't carry the JWT — fetch as a blob instead and
// hand the browser an object URL.
//
// Inside the Android app, a blob URL can't be opened or "downloaded" by the
// WebView, so every action below switches to the phone's own PDF viewer /
// share sheet there (see nativeApp.ts). Browser and Windows app behaviour
// is unchanged.

async function fetchBlob(path: string, fallbackType: string): Promise<{ blob: Blob; fileName: string | null }> {
  const res = await api.get(path, { responseType: 'blob' });
  const contentType = String(res.headers['content-type'] || fallbackType);
  const disposition = String(res.headers['content-disposition'] || '');
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return {
    blob: new Blob([res.data], { type: contentType }),
    fileName: match ? decodeURIComponent(match[1]) : null,
  };
}

async function fetchPdfBlobUrl(path: string): Promise<string> {
  const { blob } = await fetchBlob(path, 'application/pdf');
  return URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
}

function defaultFileName(blob: Blob): string {
  const ext = blob.type.split('/')[1]?.split(';')[0] || 'pdf';
  return `document.${ext === 'jpeg' ? 'jpg' : ext}`;
}

// Native actions are started from plain onClick handlers, so show the
// reason instead of failing silently.
async function runNative(action: () => Promise<void>) {
  try {
    await action();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Something went wrong while opening the file.';
    // "canceled" = the user just closed the share sheet - not an error.
    if (!/cancel/i.test(message)) window.alert(message);
  }
}

function triggerBrowserDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function viewPdf(path: string, filename?: string) {
  if (isNativeApp()) {
    return runNative(async () => {
      const { blob, fileName } = await fetchBlob(path, 'application/pdf');
      await openInNativeViewer(new Blob([blob], { type: 'application/pdf' }), filename || fileName || 'document.pdf');
    });
  }
  const url = await fetchPdfBlobUrl(path);
  window.open(url, '_blank');
}

export async function downloadPdf(path: string, filename: string) {
  if (isNativeApp()) {
    // On the phone "download" opens the share sheet, which includes
    // "Save to Files" / Drive as well as WhatsApp etc.
    return runNative(async () => {
      const { blob } = await fetchBlob(path, 'application/pdf');
      await shareNativeFile(new Blob([blob], { type: 'application/pdf' }), filename, filename);
    });
  }
  const url = await fetchPdfBlobUrl(path);
  triggerBrowserDownload(url, filename);
}

// Sends the real PDF file (not just a text summary):
// - Android app: native share sheet with the PDF attached (pick WhatsApp).
// - Browsers that support sharing files (e.g. Chrome on Android/Windows):
//   the system share dialog.
// - Otherwise: falls back to a normal download.
export async function sharePdf(path: string, filename: string, title = filename) {
  if (isNativeApp()) {
    return runNative(async () => {
      const { blob } = await fetchBlob(path, 'application/pdf');
      await shareNativeFile(new Blob([blob], { type: 'application/pdf' }), filename, title);
    });
  }

  const { blob } = await fetchBlob(path, 'application/pdf');
  const file = new File([blob], filename, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return; // user closed the dialog
    }
  }
  triggerBrowserDownload(URL.createObjectURL(file), filename);
}

// Like fetchPdfBlobUrl, but for files that might not be a PDF (e.g. an
// uploaded expense invoice scan, an employee photo, or an employee
// document can be a PNG/JPG too) — uses the server's actual Content-Type
// instead of assuming application/pdf. Exported so callers that need the
// object URL directly (e.g. an <img> thumbnail fed from a protected
// route) don't have to go through viewFile()'s window.open().
export async function fetchFileBlobUrl(path: string): Promise<string> {
  const { blob } = await fetchBlob(path, 'application/octet-stream');
  return URL.createObjectURL(blob);
}

export async function viewFile(path: string) {
  if (isNativeApp()) {
    return runNative(async () => {
      const { blob, fileName } = await fetchBlob(path, 'application/octet-stream');
      await openInNativeViewer(blob, fileName || defaultFileName(blob));
    });
  }
  const url = await fetchFileBlobUrl(path);
  window.open(url, '_blank');
}

// Generic protected-route download (not necessarily a PDF — e.g. the
// Settings page's database backup, which comes back as a .sql file).
// Uses the server's actual Content-Type/filename via a blob, same
// JWT-carrying approach as downloadPdf() above.
export async function downloadFile(path: string, filename: string) {
  if (isNativeApp()) {
    return runNative(async () => {
      const { blob } = await fetchBlob(path, 'application/octet-stream');
      await shareNativeFile(blob, filename, filename);
    });
  }
  const url = await fetchFileBlobUrl(path);
  triggerBrowserDownload(url, filename);
}

export async function openWhatsapp(linkPath: string) {
  const res = await api.get(linkPath);
  window.open(res.data.url, '_blank');
}
