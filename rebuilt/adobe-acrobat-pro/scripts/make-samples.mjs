// Generates the small sample PDFs used by the unit tests (tests/samples/*.pdf).
// Each page has a distinctive width so tests can tell pages apart after merge/split/reorder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'samples');
fs.mkdirSync(dir, { recursive: true });
const fixed = new Date('2026-01-01T00:00:00Z');

async function make(file, label, widths, height, rotations = []) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(fixed);
  doc.setModificationDate(fixed);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  widths.forEach((w, i) => {
    const page = doc.addPage([w, height]);
    page.drawText(`${label} page ${i + 1}`, { x: 20, y: height - 40, size: 16, font, color: rgb(0, 0, 0) });
    if (rotations[i]) page.setRotation(degrees(rotations[i]));
  });
  fs.writeFileSync(path.join(dir, file), await doc.save());
}

await make('alpha-3p.pdf', 'Alpha', [200, 210, 220], 300);
await make('beta-2p.pdf', 'Beta', [300, 310], 400);
await make('gamma-rotated.pdf', 'Gamma', [250, 260], 350, [90, 0]);

// A form with a text field, a checkbox and a dropdown
{
  const doc = await PDFDocument.create();
  doc.setCreationDate(fixed);
  const page = doc.addPage([300, 300]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Form sample', { x: 20, y: 270, size: 16, font });
  const form = doc.getForm();
  const name = form.createTextField('full_name');
  name.addToPage(page, { x: 20, y: 220, width: 200, height: 24 });
  const agree = form.createCheckBox('agree');
  agree.addToPage(page, { x: 20, y: 180, width: 16, height: 16 });
  const colour = form.createDropdown('colour');
  colour.addOptions(['Red', 'Green', 'Blue']);
  colour.addToPage(page, { x: 20, y: 130, width: 120, height: 24 });
  fs.writeFileSync(path.join(dir, 'form.pdf'), await doc.save());
}
console.log('samples written to', dir);
