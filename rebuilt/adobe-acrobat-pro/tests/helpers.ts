import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const here = path.dirname(fileURLToPath(import.meta.url));

export function sample(name: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(here, 'samples', name)));
}

/** Page widths (rounded) of a PDF: each sample page has a distinct width, so this is page identity. */
export async function widths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => Math.round(p.getSize().width));
}

export async function rotations(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => p.getRotation().angle);
}

export function isPdf(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-';
}
