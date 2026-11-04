/** Page-range parsing. User-facing numbers are 1-based; results are 0-based indices. */

export class RangeSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RangeSyntaxError';
  }
}

function tokens(input: string): string[] {
  return input
    .split(/[,;\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function parseToken(tok: string, pageCount: number): number[] {
  const m = /^(\d*)\s*-\s*(\d*)$/.exec(tok);
  let from: number;
  let to: number;
  if (m) {
    if (m[1] === '' && m[2] === '') throw new RangeSyntaxError(`"${tok}" is not a page range`);
    from = m[1] === '' ? 1 : Number(m[1]);
    to = m[2] === '' ? pageCount : Number(m[2]);
  } else if (/^\d+$/.test(tok)) {
    from = to = Number(tok);
  } else if (tok.toLowerCase() === 'all') {
    from = 1;
    to = pageCount;
  } else if (tok.toLowerCase() === 'last') {
    from = to = pageCount;
  } else {
    throw new RangeSyntaxError(`"${tok}" is not a page number or range`);
  }
  if (from < 1 || to < 1) throw new RangeSyntaxError(`Pages start at 1 (got "${tok}")`);
  if (from > pageCount || to > pageCount) {
    throw new RangeSyntaxError(`"${tok}" is outside this document (${pageCount} page${pageCount === 1 ? '' : 's'})`);
  }
  if (from > to) throw new RangeSyntaxError(`"${tok}" is backwards (use ${to}-${from})`);
  const out: number[] = [];
  for (let p = from; p <= to; p++) out.push(p - 1);
  return out;
}

/** "1-3, 5, 8-" -> [0,1,2,4,7,...]. Order is kept as typed. */
export function parsePageList(input: string, pageCount: number): number[] {
  const toks = tokens(input);
  if (!toks.length) throw new RangeSyntaxError('Enter at least one page or range, for example 1-3, 5');
  return toks.flatMap((t) => parseToken(t, pageCount));
}

/** Each comma-separated token becomes its own group (used for "split into files"). */
export function parseRangeGroups(input: string, pageCount: number): number[][] {
  const toks = tokens(input);
  if (!toks.length) throw new RangeSyntaxError('Enter at least one range, for example 1-3, 4-6, 7-');
  return toks.map((t) => parseToken(t, pageCount));
}

/** [0,1,2,4] -> "1-3, 5" (sorted, de-duplicated). */
export function formatPageList(indices: Iterable<number>): string {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? `${sorted[i] + 1}` : `${sorted[i] + 1}-${sorted[j] + 1}`);
    i = j + 1;
  }
  return parts.join(', ');
}

/** Groups of n consecutive pages: (7, 3) -> [[0,1,2],[3,4,5],[6]] */
export function chunkEvery(pageCount: number, n: number): number[][] {
  if (!Number.isInteger(n) || n < 1) throw new RangeSyntaxError('Pages per file must be a whole number of at least 1');
  const out: number[][] = [];
  for (let s = 0; s < pageCount; s += n) {
    out.push(Array.from({ length: Math.min(n, pageCount - s) }, (_, k) => s + k));
  }
  return out;
}
