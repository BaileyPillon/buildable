import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PdfError } from './pdfops';

// The worker is a same-origin file emitted by the build (allowed by `script-src 'self'`).
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy, RenderTask };
export const AnnotationMode = pdfjs.AnnotationMode;

/** Release a document and its worker resources. */
export function destroyDoc(doc: PDFDocumentProxy | null | undefined): Promise<void> {
  return doc ? doc.loadingTask.destroy() : Promise.resolve();
}

/** Absolute URL of a file shipped next to index.html. */
export function assetUrl(rel: string): string {
  return new URL(rel, document.baseURI).href;
}

let wasmOk: boolean | undefined;
/**
 * Can this page compile WebAssembly? A strict Content-Security-Policy without
 * 'wasm-unsafe-eval' makes this false; we then fall back to pure-JS code paths.
 */
export function wasmAllowed(): boolean {
  if (wasmOk === undefined) {
    try {
      new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
      wasmOk = true;
    } catch {
      wasmOk = false;
    }
  }
  return wasmOk;
}

/** Open PDF bytes for rendering. The bytes are copied because pdf.js transfers its input to the worker. */
export async function openPdf(bytes: Uint8Array, label = 'This file'): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    standardFontDataUrl: assetUrl('vendor/pdfjs/standard_fonts/'),
    cMapUrl: assetUrl('vendor/pdfjs/cmaps/'),
    cMapPacked: true,
    iccUrl: assetUrl('vendor/pdfjs/iccs/'),
    wasmUrl: assetUrl('vendor/pdfjs/wasm/'),
    useWasm: wasmAllowed(),
  });
  try {
    return await task.promise;
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'PasswordException') {
      throw new PdfError(`${label} is password-protected. Remove the password in the app that created it, then try again.`);
    }
    throw new PdfError(`${label} could not be opened as a PDF (${e instanceof Error ? e.message : String(e)}).`);
  }
}

const MAX_CANVAS_PIXELS = 36_000_000;

export interface RenderOptions {
  /** Device-pixel multiplier for sharp output on HiDPI screens. */
  dpr?: number;
  annotationMode?: number;
  /**
   * 'print' renders without requestAnimationFrame, so background jobs (compress, OCR) keep
   * running when the tab is hidden, and it draws annotations/form appearances as printed.
   */
  intent?: 'display' | 'print';
}

/**
 * Render a page so it is `cssScale` CSS-pixels per PDF point wide.
 * Returns the render task (so callers can cancel) plus its promise.
 */
export function renderToCanvas(page: PDFPageProxy, canvas: HTMLCanvasElement, cssScale: number, opts: RenderOptions = {}) {
  let dpr = opts.dpr ?? Math.min(window.devicePixelRatio || 1, 2);
  const base = page.getViewport({ scale: cssScale });
  while (base.width * dpr * base.height * dpr > MAX_CANVAS_PIXELS && dpr > 0.25) dpr *= 0.8;
  const viewport = page.getViewport({ scale: cssScale * dpr });
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  canvas.style.width = `${viewport.width / dpr}px`;
  canvas.style.height = `${viewport.height / dpr}px`;
  const task = page.render({
    canvas,
    viewport,
    background: 'rgb(255,255,255)',
    annotationMode: opts.annotationMode ?? AnnotationMode.ENABLE,
    intent: opts.intent ?? 'display',
  });
  return task;
}

/** Page size in points as displayed (rotation applied). */
export function viewSize(page: PDFPageProxy): { width: number; height: number } {
  const v = page.getViewport({ scale: 1 });
  return { width: v.width, height: v.height };
}

/** A tiny serial queue so thumbnails render a few at a time and the UI stays responsive. */
export class RenderQueue {
  private running = 0;
  private waiting: Array<() => void> = [];
  constructor(private limit = 2) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.limit) await new Promise<void>((r) => this.waiting.push(r));
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }
}
