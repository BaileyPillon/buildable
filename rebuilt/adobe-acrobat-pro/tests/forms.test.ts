import { describe, expect, it } from 'vitest';
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFTextField } from 'pdf-lib';
import { applyFormValues, readForm } from '../src/lib/formfields';
import { applyAnnotations } from '../src/lib/annotate';
import { loadPdf } from '../src/lib/pdfops';
import { sample } from './helpers';

describe('form fields', () => {
  it('lists fields with their page and position', async () => {
    const doc = await loadPdf(sample('form.pdf'));
    const info = readForm(doc);
    const names = info.widgets.map((w) => w.fieldName).sort();
    expect(names).toEqual(['agree', 'colour', 'full_name']);
    const text = info.widgets.find((w) => w.fieldName === 'full_name')!;
    expect(text.kind).toBe('text');
    expect(text.page).toBe(0);
    text.rect.forEach((v, i) => expect(Math.abs(v - [20, 220, 220, 244][i])).toBeLessThanOrEqual(0.5)); // pdf-lib insets by half a border
    expect(info.widgets.find((w) => w.fieldName === 'colour')!.options).toEqual(['Red', 'Green', 'Blue']);
    expect(info.initial.agree).toBe(false);
  });

  it('writes values that survive a save and reload', async () => {
    const doc = await loadPdf(sample('form.pdf'));
    const warnings = applyFormValues(doc, { full_name: 'Ada Lovelace', agree: true, colour: 'Green' });
    expect(warnings).toEqual([]);
    const again = await PDFDocument.load(await doc.save());
    const form = again.getForm();
    expect((form.getField('full_name') as PDFTextField).getText()).toBe('Ada Lovelace');
    expect((form.getField('agree') as PDFCheckBox).isChecked()).toBe(true);
    expect((form.getField('colour') as PDFDropdown).getSelected()).toEqual(['Green']);
  });

  it('flattening removes the interactive fields', async () => {
    const doc = await loadPdf(sample('form.pdf'));
    applyFormValues(doc, { full_name: 'Flat' });
    doc.getForm().flatten();
    const again = await PDFDocument.load(await doc.save());
    expect(again.getForm().getFields()).toHaveLength(0);
  });

  it('reports a field problem instead of throwing', async () => {
    const doc = await loadPdf(sample('form.pdf'));
    const warnings = applyFormValues(doc, { no_such_field: 'x' });
    expect(warnings.length).toBe(1);
  });

  it('returns nothing for a PDF without a form', async () => {
    const doc = await loadPdf(sample('alpha-3p.pdf'));
    expect(readForm(doc).widgets).toEqual([]);
  });
});

describe('typed text and signature stamps', () => {
  // 1x1 transparent PNG
  const png = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg=='),
    (c) => c.charCodeAt(0),
  );

  it('draws onto the right pages and keeps the page count', async () => {
    const doc = await loadPdf(sample('gamma-rotated.pdf'));
    const warnings = await applyAnnotations(doc, [
      { type: 'text', page: 0, x: 20, y: 20, text: 'Hello\nWorld', size: 14, font: 'Helvetica', color: '#112233' },
      { type: 'image', page: 1, x: 30, y: 40, width: 100, height: 40, png },
    ]);
    expect(warnings).toEqual([]);
    const out = await PDFDocument.load(await doc.save());
    expect(out.getPageCount()).toBe(2);
  });

  it('flags characters the standard fonts cannot print', async () => {
    const doc = await loadPdf(sample('alpha-3p.pdf'));
    const warnings = await applyAnnotations(doc, [
      { type: 'text', page: 0, x: 5, y: 5, text: 'café 你好', size: 12, font: 'Times', color: '#000000' },
    ]);
    expect(warnings[0]).toMatch(/2 characters/);
  });
});
