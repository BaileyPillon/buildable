/** Card images: shrink on the way in, keep as Blobs in IndexedDB, show via object URLs. */

const MAX_EDGE = 900;

export async function shrinkImage(file: Blob): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('That file is not an image.');
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Could not read that image.');
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 300_000) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.85));
  return out && out.size < file.size ? out : file;
}

/** Object URLs created for the current screen; revoked when the screen is torn down. */
export class UrlBag {
  private urls: string[] = [];
  url(blob: Blob): string {
    const u = URL.createObjectURL(blob);
    this.urls.push(u);
    return u;
  }
  dispose(): void {
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls = [];
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

/** Decodes a base64 data: URL by hand (fetch() on data: URLs is blocked by connect-src 'self'). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]+)((?:;[^;,]+)*?);base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('Bad image data.');
  const bin = atob(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}
