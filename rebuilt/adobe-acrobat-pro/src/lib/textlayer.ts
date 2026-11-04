import {
  PDFDocument,
  PDFFont,
  StandardFonts,
  TextRenderingMode,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setTextRenderingMode,
} from 'pdf-lib';
import { viewTransformForPage } from './geometry';
import { sanitizeForFont } from './annotate';

/** A recognized word. Coordinates are pixels in the rendered page image (origin top-left). */
export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const fontCache = new WeakMap<PDFDocument, PDFFont>();

/**
 * Lay an invisible (render mode 3) text layer over a page so it becomes searchable and
 * selectable while the scanned image stays exactly as it was.
 * `pxPerPt` is how many image pixels one PDF point spans (render scale).
 * Returns the number of words written.
 */
export async function addInvisibleText(doc: PDFDocument, pageIndex: number, words: OcrWord[], pxPerPt: number): Promise<number> {
  const page = doc.getPages()[pageIndex];
  if (!page) return 0;
  let font = fontCache.get(doc);
  if (!font) {
    font = await doc.embedFont(StandardFonts.Helvetica);
    fontCache.set(doc, font);
  }
  const vt = viewTransformForPage(page);
  page.translateContent(0, 0); // isolate whatever transform the original content leaves behind
  let written = 0;
  for (const w of words) {
    const text = sanitizeForFont(font, w.text.trim()).text;
    if (!text.trim()) continue;
    const left = w.x0 / pxPerPt;
    const right = w.x1 / pxPerPt;
    const top = w.y0 / pxPerPt;
    const bottom = w.y1 / pxPerPt;
    const boxW = right - left;
    const boxH = bottom - top;
    if (!(boxW > 0 && boxH > 0)) continue;
    const size = Math.min(200, Math.max(4, boxH / 0.75));
    const natural = font.widthOfTextAtSize(text, size);
    if (!(natural > 0)) continue;
    const squeeze = Math.min(400, Math.max(10, (boxW / natural) * 100));
    const hasDescender = /[gjpqy,;()Q]/.test(text);
    const baseline = bottom - (hasDescender ? 0.21 * size : 0);
    const p = vt.toUser(left, baseline);
    page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible), setCharacterSqueeze(squeeze));
    page.drawText(text, { x: p.x, y: p.y, size, font, rotate: degrees(vt.textAngle) });
    page.pushOperators(popGraphicsState());
    written++;
  }
  return written;
}
