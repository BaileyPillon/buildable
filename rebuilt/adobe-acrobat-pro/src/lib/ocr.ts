import { createWorker } from 'tesseract.js';
import { PDFDocument } from 'pdf-lib';
import { APP_NAME, loadPdf } from './pdfops';
import { assetUrl, destroyDoc, openPdf, renderToCanvas, viewSize, wasmAllowed } from './pdfjs';
import { addInvisibleText, type OcrWord } from './textlayer';
import type { CancelToken } from './cancel';

/**
 * OCR runs tesseract.js entirely in a Web Worker served from this origin.
 *
 * Engine choice: WebAssembly is faster, but a strict Content-Security-Policy
 * (script-src 'self' without 'wasm-unsafe-eval') makes the browser refuse to compile
 * WebAssembly. tesseract.js 2.x ships a pure-JavaScript (asm.js) core as well, so under
 * such a policy we load that one instead: slower, but it works with no external requests.
 */
export type OcrBackend = 'wasm' | 'asmjs';

export interface OcrResult {
  text: string;
  words: OcrWord[];
}

export interface OcrEngine {
  backend: OcrBackend;
  recognize(canvas: HTMLCanvasElement): Promise<OcrResult>;
  terminate(): Promise<void>;
}

export async function createOcrEngine(
  dpi: number,
  onStatus: (status: string, progress: number) => void,
): Promise<OcrEngine> {
  const backend: OcrBackend = wasmAllowed() ? 'wasm' : 'asmjs';
  const worker = createWorker({
    workerPath: assetUrl('vendor/tesseract/worker.min.js'),
    corePath: assetUrl(backend === 'wasm' ? 'vendor/tesseract/tesseract-core.wasm.js' : 'vendor/tesseract/tesseract-core.asm.js'),
    langPath: assetUrl('vendor/tesseract/lang'),
    workerBlobURL: false, // a blob: worker would violate the CSP
    cacheMethod: 'none', // the model is already a local static file
    gzip: true,
    logger: (m: { status: string; progress: number }) => onStatus(m.status, m.progress),
  });
  await worker.load();
  await worker.loadLanguage('eng');
  await worker.initialize('eng');
  await worker.setParameters({ user_defined_dpi: String(dpi), preserve_interword_spaces: '1' });
  return {
    backend,
    async recognize(canvas) {
      const { data } = await worker.recognize(canvas);
      const words: OcrWord[] = (data.words ?? [])
        .filter((w: { text: string; confidence: number }) => w.text.trim() && w.confidence > 0)
        .map((w: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }) => ({
          text: w.text,
          x0: w.bbox.x0,
          y0: w.bbox.y0,
          x1: w.bbox.x1,
          y1: w.bbox.y1,
        }));
      return { text: data.text ?? '', words };
    },
    async terminate() {
      await worker.terminate();
    },
  };
}

export interface OcrOptions {
  dpi: number;
  /** Leave pages alone if they already contain real text. */
  skipPagesWithText: boolean;
  onStatus: (message: string, fraction: number) => void;
  signal: CancelToken;
}

export interface OcrRunResult {
  pdf: Uint8Array;
  text: string;
  pagesRecognized: number;
  pagesSkipped: number;
  wordsWritten: number;
  backend: OcrBackend;
}

/** Make a PDF searchable: recognise each page image and add an invisible text layer over it. */
export async function ocrPdf(bytes: Uint8Array, opts: OcrOptions): Promise<OcrRunResult> {
  const src = await openPdf(bytes);
  const doc: PDFDocument = await loadPdf(bytes);
  let engine: OcrEngine | undefined;
  const guard = <T>(p: Promise<T>) => opts.signal.race(p);

  try {
    opts.onStatus('Starting the OCR engine (first run loads about 9 MB)...', 0);
    engine = await guard(
      createOcrEngine(opts.dpi, (s, p) => {
        if (/loading|initializ/i.test(s)) opts.onStatus(`Engine: ${s}`, 0);
        void p;
      }),
    );
    const total = src.numPages;
    let recognized = 0;
    let skipped = 0;
    let words = 0;
    const texts: string[] = [];
    for (let i = 1; i <= total; i++) {
      if (opts.signal.cancelled) throw new Error('Cancelled');
      const page = await src.getPage(i);
      if (opts.skipPagesWithText) {
        const tc = await page.getTextContent();
        const chars = tc.items.reduce((n, it) => n + ('str' in it ? it.str.trim().length : 0), 0);
        if (chars > 20) {
          skipped++;
          opts.onStatus(`Page ${i} of ${total}: already has text, skipped`, i / total);
          page.cleanup();
          continue;
        }
      }
      opts.onStatus(`Page ${i} of ${total}: rendering`, (i - 1) / total);
      const canvas = document.createElement('canvas');
      const scale = opts.dpi / 72;
      await renderToCanvas(page, canvas, scale, { dpr: 1, intent: 'print' }).promise;
      opts.onStatus(`Page ${i} of ${total}: recognizing text (${engine.backend === 'wasm' ? 'WebAssembly' : 'JavaScript'} engine)`, (i - 0.5) / total);
      const res = await guard(engine.recognize(canvas));
      // canvas pixels per PDF point (the canvas may have been downscaled if the page is huge)
      const size = viewSize(page);
      const pxPerPt = canvas.width / size.width;
      canvas.width = canvas.height = 0;
      words += await addInvisibleText(doc, i - 1, res.words, pxPerPt);
      texts.push(`--- Page ${i} ---\n${res.text.trim()}`);
      recognized++;
      page.cleanup();
      opts.onStatus(`Page ${i} of ${total}: done`, i / total);
    }
    doc.setProducer(APP_NAME);
    doc.setCreator(APP_NAME);
    const pdf = await doc.save();
    return { pdf, text: texts.join('\n\n'), pagesRecognized: recognized, pagesSkipped: skipped, wordsWritten: words, backend: engine.backend };
  } finally {
    await engine?.terminate().catch(() => undefined);
    await destroyDoc(src).catch(() => undefined);
  }
}
