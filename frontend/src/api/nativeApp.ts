// Bridges to the ARIBS ERP Android app (Capacitor), used only when this
// web app is running INSIDE the app. In a normal browser or the Windows
// app, isNativeApp() is false and none of this is used.
//
// The plugins (Filesystem, Share, FileOpener) are compiled into the APK and
// exposed by Capacitor on window.Capacitor.Plugins, so the website doesn't
// need any Capacitor npm packages of its own.

type CapacitorPlugin = Record<string, (...args: unknown[]) => Promise<any>>;

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, CapacitorPlugin | undefined>;
}

function capacitor(): CapacitorGlobal | undefined {
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

export function isNativeApp(): boolean {
  try {
    return Boolean(capacitor()?.isNativePlatform?.());
  } catch {
    return false;
  }
}

function plugin(name: string): CapacitorPlugin {
  const found = capacitor()?.Plugins?.[name];
  if (!found) {
    throw new Error('This feature needs the latest ARIBS ERP app. Please update the app and try again.');
  }
  return found;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      // "data:application/pdf;base64,AAAA..." -> "AAAA..."
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, '-').trim();
  return cleaned || 'document.pdf';
}

// Writes the file into the app's private cache folder and returns its
// native file:// URI (needed by the viewer and share sheet).
async function writeToCache(blob: Blob, fileName: string): Promise<string> {
  const data = await blobToBase64(blob);
  const result = await plugin('Filesystem').writeFile({
    path: `shared/${safeFileName(fileName)}`,
    data,
    directory: 'CACHE',
    recursive: true,
  });
  return result.uri as string;
}

// Opens the file in the phone's PDF/image viewer.
export async function openInNativeViewer(blob: Blob, fileName: string): Promise<void> {
  const uri = await writeToCache(blob, fileName);
  await plugin('FileOpener').open({
    filePath: uri,
    contentType: blob.type || 'application/pdf',
    openWithDefault: true,
  });
}

// Opens Android's share sheet with the real file attached - pick WhatsApp,
// Gmail, Drive, "Save to Files", etc.
export async function shareNativeFile(blob: Blob, fileName: string, title: string): Promise<void> {
  const uri = await writeToCache(blob, fileName);
  await plugin('Share').share({
    title,
    dialogTitle: title,
    files: [uri],
  });
}
