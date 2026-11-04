import { PDFDocument, PDFPage, degrees } from 'pdf-lib';

export const APP_NAME = 'Private PDF Toolkit';

export class PdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfError';
  }
}

/** Load with friendly errors for the two cases users actually hit. */
export async function loadPdf(bytes: Uint8Array, label = 'This file'): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { throwOnInvalidObject: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/encrypt/i.test(msg)) {
      throw new PdfError(`${label} is password-protected. Remove the password in the app that created it, then try again.`);
    }
    throw new PdfError(`${label} could not be read as a PDF (${msg}).`);
  }
}

export function normalizeAngle(a: number): number {
  return ((Math.round(a / 90) * 90) % 360 + 360) % 360;
}

function stamp(doc: PDFDocument) {
  doc.setProducer(APP_NAME);
  doc.setCreator(APP_NAME);
  doc.setModificationDate(new Date());
}

/** One output page: which source file, which page of it (0-based) and how much extra rotation. */
export interface PageSpec {
  source: number;
  page: number;
  rotate?: number;
}

/**
 * Build a new PDF from pages of several sources, in the given order,
 * with optional extra rotation. This is the engine behind merge, reorder,
 * rotate and delete in the page organizer.
 */
export async function assemble(sources: Uint8Array[], specs: PageSpec[]): Promise<Uint8Array> {
  if (!specs.length) throw new PdfError('There are no pages to export.');
  const docs = await Promise.all(sources.map((b, i) => loadPdf(b, `File ${i + 1}`)));
  for (const s of specs) {
    if (!docs[s.source]) throw new PdfError(`Unknown source file ${s.source}.`);
    if (s.page < 0 || s.page >= docs[s.source].getPageCount()) {
      throw new PdfError(`Page ${s.page + 1} does not exist in file ${s.source + 1}.`);
    }
  }
  const out = await PDFDocument.create();

  // Copy each source's pages in one call so shared fonts/images are copied once.
  // A page used twice is copied again (a PDFPage can only be added once).
  const firstUse = new Map<string, number>();
  const wanted: number[][] = docs.map(() => []);
  specs.forEach((s, idx) => {
    const key = `${s.source}:${s.page}`;
    if (!firstUse.has(key)) {
      firstUse.set(key, idx);
      wanted[s.source].push(s.page);
    }
  });
  const copied = new Map<string, PDFPage>();
  for (let si = 0; si < docs.length; si++) {
    if (!wanted[si].length) continue;
    const pages = await out.copyPages(docs[si], wanted[si]);
    pages.forEach((p, k) => copied.set(`${si}:${wanted[si][k]}`, p));
  }

  for (let idx = 0; idx < specs.length; idx++) {
    const s = specs[idx];
    const key = `${s.source}:${s.page}`;
    const page = firstUse.get(key) === idx ? copied.get(key)! : (await out.copyPages(docs[s.source], [s.page]))[0];
    const extra = normalizeAngle(s.rotate ?? 0);
    if (extra) page.setRotation(degrees(normalizeAngle(page.getRotation().angle + extra)));
    out.addPage(page);
  }
  stamp(out);
  return out.save();
}

/** Concatenate whole documents in order. */
export async function mergePdfs(sources: Uint8Array[]): Promise<Uint8Array> {
  if (sources.length < 1) throw new PdfError('Choose at least one PDF to merge.');
  const counts = await Promise.all(sources.map(async (b, i) => (await loadPdf(b, `File ${i + 1}`)).getPageCount()));
  const specs: PageSpec[] = [];
  counts.forEach((n, source) => {
    for (let page = 0; page < n; page++) specs.push({ source, page });
  });
  return assemble(sources, specs);
}

/** Keep only these pages (0-based), in the order given. */
export async function extractPages(src: Uint8Array, pages: number[]): Promise<Uint8Array> {
  if (!pages.length) throw new PdfError('Choose at least one page to extract.');
  return assemble([src], pages.map((page) => ({ source: 0, page })));
}

/** One output PDF per group of pages. */
export async function splitByGroups(src: Uint8Array, groups: number[][]): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (const g of groups) out.push(await extractPages(src, g));
  return out;
}

/** Rotate pages in place (keeps forms, links and metadata). `pages` are 0-based; omit for all. */
export async function rotatePages(src: Uint8Array, delta: number, pages?: number[]): Promise<Uint8Array> {
  const doc = await loadPdf(src);
  const all = doc.getPages();
  const targets = pages ?? all.map((_, i) => i);
  for (const i of targets) {
    if (i < 0 || i >= all.length) throw new PdfError(`Page ${i + 1} does not exist.`);
    all[i].setRotation(degrees(normalizeAngle(all[i].getRotation().angle + delta)));
  }
  stamp(doc);
  return doc.save();
}

/** Remove pages (0-based). Refuses to remove every page. */
export async function deletePages(src: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const doc = await loadPdf(src);
  const n = doc.getPageCount();
  const unique = [...new Set(pages)];
  for (const i of unique) if (i < 0 || i >= n) throw new PdfError(`Page ${i + 1} does not exist.`);
  if (unique.length >= n) throw new PdfError('A PDF needs at least one page, so not every page can be deleted.');
  for (const i of unique.sort((a, b) => b - a)) doc.removePage(i);
  stamp(doc);
  return doc.save();
}

export interface PageInfo {
  count: number;
  rotations: number[];
  sizes: Array<{ width: number; height: number }>;
}

export async function getPageInfo(src: Uint8Array): Promise<PageInfo> {
  const doc = await loadPdf(src);
  const pages = doc.getPages();
  return {
    count: pages.length,
    rotations: pages.map((p) => normalizeAngle(p.getRotation().angle)),
    sizes: pages.map((p) => p.getSize()),
  };
}

export function baseName(filename: string): string {
  return filename.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '_') || 'document';
}
