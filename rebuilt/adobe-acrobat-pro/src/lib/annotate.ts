import { PDFDocument, PDFFont, StandardFonts, degrees, rgb } from 'pdf-lib';
import { viewTransformForPage } from './geometry';

export type AnnotFont = 'Helvetica' | 'Times' | 'Courier';

/** Positions are in "view points": the page as displayed (rotation applied), origin top-left. */
export interface TextAnnot {
  type: 'text';
  page: number;
  x: number;
  y: number;
  text: string;
  size: number;
  font: AnnotFont;
  color: string; // #rrggbb
}

export interface ImageAnnot {
  type: 'image';
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  png: Uint8Array;
}

export type Annot = TextAnnot | ImageAnnot;

/** Layout constants shared by the on-screen editor and the PDF writer so they agree. */
export const TEXT_PAD = 2;
export const LINE_HEIGHT = 1.2;
/** Distance from top of a CSS line box (line-height 1.2) to the baseline, in em. */
export const BASELINE_EM: Record<AnnotFont, number> = { Helvetica: 0.947, Times: 0.938, Courier: 0.866 };

export const STANDARD: Record<AnnotFont, StandardFonts> = {
  Helvetica: StandardFonts.Helvetica,
  Times: StandardFonts.TimesRoman,
  Courier: StandardFonts.Courier,
};

export function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Standard PDF fonts only cover WinAnsi; swap anything else for "?" and report how many. */
export function sanitizeForFont(font: PDFFont, text: string): { text: string; replaced: number } {
  const set = new Set(font.getCharacterSet());
  let replaced = 0;
  let out = '';
  for (const ch of text.replace(/\t/g, '    ')) {
    const cp = ch.codePointAt(0)!;
    if (set.has(cp)) out += ch;
    else {
      out += '?';
      replaced++;
    }
  }
  return { text: out, replaced };
}

/** Draw typed text boxes and signature/image stamps onto pages. Returns warnings. */
export async function applyAnnotations(doc: PDFDocument, items: Annot[]): Promise<string[]> {
  const warnings: string[] = [];
  const pages = doc.getPages();
  const fonts = new Map<AnnotFont, PDFFont>();
  const isolated = new Set<number>();
  let replacedTotal = 0;

  for (const item of items) {
    const page = pages[item.page];
    if (!page) continue;
    if (!isolated.has(item.page)) {
      // Wrap existing content in q/Q so a leftover transform cannot move what we draw.
      page.translateContent(0, 0);
      isolated.add(item.page);
    }
    const vt = viewTransformForPage(page);
    if (item.type === 'text') {
      let font = fonts.get(item.font);
      if (!font) {
        font = await doc.embedFont(STANDARD[item.font]);
        fonts.set(item.font, font);
      }
      const color = hexToRgb(item.color);
      const lines = item.text.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!line.trim()) return;
        const clean = sanitizeForFont(font!, line);
        replacedTotal += clean.replaced;
        const baselineY = item.y + TEXT_PAD + item.size * (BASELINE_EM[item.font] + i * LINE_HEIGHT);
        const p = vt.toUser(item.x + TEXT_PAD, baselineY);
        page.drawText(clean.text, { x: p.x, y: p.y, size: item.size, font, color, rotate: degrees(vt.textAngle) });
      });
    } else {
      const img = await doc.embedPng(item.png);
      const p = vt.toUser(item.x, item.y + item.height); // bottom-left corner of the stamp
      page.drawImage(img, { x: p.x, y: p.y, width: item.width, height: item.height, rotate: degrees(vt.textAngle) });
    }
  }
  if (replacedTotal) {
    warnings.push(`${replacedTotal} character${replacedTotal === 1 ? '' : 's'} outside the standard PDF fonts were replaced with "?".`);
  }
  return warnings;
}
