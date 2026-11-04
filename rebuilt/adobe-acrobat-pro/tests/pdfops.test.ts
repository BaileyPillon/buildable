import { describe, expect, it } from 'vitest';
import {
  assemble,
  deletePages,
  extractPages,
  getPageInfo,
  mergePdfs,
  normalizeAngle,
  rotatePages,
  splitByGroups,
} from '../src/lib/pdfops';
import { chunkEvery, parseRangeGroups } from '../src/lib/ranges';
import { isPdf, rotations, sample, widths } from './helpers';

const alpha = sample('alpha-3p.pdf'); // widths 200, 210, 220
const beta = sample('beta-2p.pdf'); // widths 300, 310
const gamma = sample('gamma-rotated.pdf'); // widths 250, 260; page 1 rotated 90

describe('merge', () => {
  it('concatenates documents in the order given', async () => {
    const out = await mergePdfs([alpha, beta]);
    expect(isPdf(out)).toBe(true);
    expect(await widths(out)).toEqual([200, 210, 220, 300, 310]);
  });

  it('keeps order when the inputs are swapped', async () => {
    expect(await widths(await mergePdfs([beta, alpha]))).toEqual([300, 310, 200, 210, 220]);
  });

  it('merges three files and preserves existing page rotation', async () => {
    const out = await mergePdfs([alpha, gamma, beta]);
    expect(await widths(out)).toEqual([200, 210, 220, 250, 260, 300, 310]);
    expect(await rotations(out)).toEqual([0, 0, 0, 90, 0, 0, 0]);
  });

  it('can reorder pages across files, rotate and drop pages in one pass (assemble)', async () => {
    const out = await assemble(
      [alpha, beta],
      [
        { source: 1, page: 1 }, // beta p2 (310)
        { source: 0, page: 0, rotate: 90 }, // alpha p1 (200), rotated
        { source: 0, page: 2 }, // alpha p3 (220); alpha p2 deliberately left out
      ],
    );
    expect(await widths(out)).toEqual([310, 200, 220]);
    expect(await rotations(out)).toEqual([0, 90, 0]);
  });

  it('can use the same source page twice', async () => {
    const out = await assemble([alpha], [{ source: 0, page: 1 }, { source: 0, page: 1 }]);
    expect(await widths(out)).toEqual([210, 210]);
  });

  it('rejects a file that is not a PDF with a readable message', async () => {
    await expect(mergePdfs([alpha, new TextEncoder().encode('not a pdf at all')])).rejects.toThrow(/File 2/);
  });

  it('refuses to produce an empty document', async () => {
    await expect(assemble([alpha], [])).rejects.toThrow(/no pages/i);
  });
});

describe('split and extract', () => {
  it('extracts pages in the order requested', async () => {
    const out = await extractPages(alpha, [2, 0]);
    expect(await widths(out)).toEqual([220, 200]);
  });

  it('splits by page ranges into one PDF per range', async () => {
    const merged = await mergePdfs([alpha, beta]); // 5 pages: 200 210 220 300 310
    const groups = parseRangeGroups('1-2, 3, 4-', 5);
    const parts = await splitByGroups(merged, groups);
    expect(parts).toHaveLength(3);
    expect(await widths(parts[0])).toEqual([200, 210]);
    expect(await widths(parts[1])).toEqual([220]);
    expect(await widths(parts[2])).toEqual([300, 310]);
    parts.forEach((p) => expect(isPdf(p)).toBe(true));
  });

  it('splits every N pages, with a shorter final file', async () => {
    const merged = await mergePdfs([alpha, beta]);
    const parts = await splitByGroups(merged, chunkEvery(5, 2));
    expect(await Promise.all(parts.map(widths))).toEqual([[200, 210], [220, 300], [310]]);
  });

  it('splitting into single pages gives one file per page', async () => {
    const parts = await splitByGroups(alpha, chunkEvery(3, 1));
    expect(await Promise.all(parts.map(widths))).toEqual([[200], [210], [220]]);
  });

  it('refuses to extract nothing', async () => {
    await expect(extractPages(alpha, [])).rejects.toThrow(/at least one page/i);
  });

  it('reports out-of-range pages', async () => {
    await expect(extractPages(alpha, [7])).rejects.toThrow(/does not exist/i);
  });
});

describe('rotate', () => {
  it('rotates every page clockwise by 90 when no selection is given', async () => {
    const out = await rotatePages(alpha, 90);
    expect(await rotations(out)).toEqual([90, 90, 90]);
    expect(await widths(out)).toEqual([200, 210, 220]); // page boxes are unchanged, only /Rotate
  });

  it('rotates only the chosen pages', async () => {
    const out = await rotatePages(alpha, 180, [1]);
    expect(await rotations(out)).toEqual([0, 180, 0]);
  });

  it('adds to existing rotation and wraps at 360', async () => {
    const out = await rotatePages(gamma, 270, [0]); // 90 + 270 = 360 -> 0
    expect(await rotations(out)).toEqual([0, 0]);
    const left = await rotatePages(alpha, -90, [0]); // counter-clockwise
    expect(await rotations(left)).toEqual([270, 0, 0]);
  });

  it('four quarter-turns return to the start', async () => {
    let cur = alpha;
    for (let i = 0; i < 4; i++) cur = await rotatePages(cur, 90);
    expect(await rotations(cur)).toEqual([0, 0, 0]);
  });

  it('rejects pages that do not exist', async () => {
    await expect(rotatePages(alpha, 90, [5])).rejects.toThrow(/does not exist/i);
  });

  it('normalizes angles', () => {
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(450)).toBe(90);
    expect(normalizeAngle(0)).toBe(0);
  });
});

describe('delete', () => {
  it('removes the chosen pages', async () => {
    const out = await deletePages(alpha, [1]);
    expect(await widths(out)).toEqual([200, 220]);
    expect((await getPageInfo(out)).count).toBe(2);
  });

  it('refuses to delete every page', async () => {
    await expect(deletePages(alpha, [0, 1, 2])).rejects.toThrow(/at least one page/i);
  });
});
