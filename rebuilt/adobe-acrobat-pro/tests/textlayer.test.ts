import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { addInvisibleText } from '../src/lib/textlayer';

describe('OCR text layer', () => {
  it('adds invisible (render mode 3) text that a PDF reader can extract', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    // two words as Tesseract would report them: pixels at 150 DPI (scale 150/72)
    const n = await addInvisibleText(
      doc,
      0,
      [
        { text: 'Hello', x0: 120, y0: 180, x1: 300, y1: 230 },
        { text: 'world', x0: 330, y0: 180, x1: 520, y1: 230 },
      ],
      150 / 72,
    );
    expect(n).toBe(2);
    const bytes = await doc.save({ useObjectStreams: false });

    // Read it back with pdf.js (legacy build runs in Node) and look for the words.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loaded = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
    const page = await loaded.getPage(1);
    const content = await page.getTextContent();
    const text = content.items.map((i) => ('str' in i ? i.str : '')).join(' ');
    expect(text).toContain('Hello');
    expect(text).toContain('world');
    // 120 px at 150 DPI = 57.6 pt from the left
    const hello = content.items.find((i) => 'str' in i && i.str.startsWith('Hello')) as { transform: number[] };
    expect(hello.transform[4]).toBeCloseTo(57.6, 0);
    await loaded.loadingTask.destroy();
  });

  it('puts words in the right place on a rotated page', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 300]);
    page.setRotation({ type: 'degrees', angle: 90 } as never);
    const n = await addInvisibleText(doc, 0, [{ text: 'Rot', x0: 30, y0: 30, x1: 90, y1: 60 }], 1);
    expect(n).toBe(1);
    expect((await PDFDocument.load(await doc.save())).getPageCount()).toBe(1);
  });

  it('skips words it cannot place', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    expect(await addInvisibleText(doc, 0, [{ text: ' ', x0: 0, y0: 0, x1: 10, y1: 10 }, { text: 'x', x0: 5, y0: 5, x1: 5, y1: 20 }], 1)).toBe(0);
  });
});
