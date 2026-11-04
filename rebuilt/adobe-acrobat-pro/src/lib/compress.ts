import { PDFDocument } from 'pdf-lib';
import { APP_NAME } from './pdfops';
import type { CancelToken } from './cancel';
import { destroyDoc, openPdf, renderToCanvas, viewSize } from './pdfjs';

export interface CompressOptions {
  /** JPEG quality, 0.05 - 1 */
  quality: number;
  /** Render resolution. 72 = native page size. */
  dpi: number;
  onProgress?: (done: number, total: number) => void;
  signal?: CancelToken;
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) return reject(new Error('The browser could not encode a JPEG for this page.'));
        resolve(new Uint8Array(await blob.arrayBuffer()));
      },
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Re-render every page to a JPEG image and rebuild the PDF from those images.
 * Text becomes pixels (no selecting/searching); links, forms and bookmarks are dropped.
 */
export async function compressPdf(bytes: Uint8Array, opts: CompressOptions): Promise<Uint8Array> {
  const src = await openPdf(bytes);
  try {
    const out = await PDFDocument.create();
    const scale = opts.dpi / 72;
    for (let i = 1; i <= src.numPages; i++) {
      if (opts.signal?.cancelled) throw new Error('Cancelled');
      const page = await src.getPage(i);
      const { width, height } = viewSize(page);
      const canvas = document.createElement('canvas');
      await renderToCanvas(page, canvas, scale, { dpr: 1, intent: 'print' }).promise;
      const jpg = await canvasToJpeg(canvas, opts.quality);
      canvas.width = canvas.height = 0; // release the bitmap memory right away
      const img = await out.embedJpg(jpg);
      const p = out.addPage([width, height]);
      p.drawImage(img, { x: 0, y: 0, width, height });
      page.cleanup();
      opts.onProgress?.(i, src.numPages);
    }
    out.setProducer(APP_NAME);
    out.setCreator(APP_NAME);
    return await out.save();
  } finally {
    await destroyDoc(src);
  }
}
