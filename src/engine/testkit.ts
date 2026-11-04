// Test helpers shared by the engine tests (not imported by the app).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Cadence, Merchant, RecurringSeries, Txn } from '../types';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const STATEMENTS = path.join(ROOT, 'fixtures', 'statements');

export const TEST_KB: Merchant[] = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'test-kb.json'), 'utf8'));

export function readStatement(file: string): string {
  return fs.readFileSync(path.join(STATEMENTS, file), 'utf8');
}

export type ExpectedEntry = {
  key: string;
  displayName: string;
  match: string;
  merchantId: string | null;
  cadence: Cadence;
  currentAmount: number;
  charges: number;
  active: boolean;
  variable?: boolean;
  priceChanges?: { from: number; to: number }[];
  candidates?: string[];
  /** sample.expected.json only: the id in the REAL KB (src/kb) findRecurring must return (null for App Store bundles) */
  kbMerchantId?: string | null;
  /** sample.expected.json only: candidate ids the real KB must offer for a bundled charge */
  kbCandidatesInclude?: string[];
};
export type ExpectedFile = {
  file: string;
  statementStart: string;
  statementEnd: string;
  rows: number;
  active: ExpectedEntry[];
  inactive: ExpectedEntry[];
};

export function readExpected(name: string): ExpectedFile {
  return JSON.parse(fs.readFileSync(path.join(STATEMENTS, `${name}.expected.json`), 'utf8'));
}

export type Scored = {
  expected: number;
  detected: number;
  matched: number;
  recall: number;
  precision: number;
  pairs: { e: ExpectedEntry; s: RecurringSeries }[];
  missed: ExpectedEntry[];
  extra: RecurringSeries[];
};

/** Pair every expected entry with at most one detected series (same merchant / descriptor, same amount). */
export function score(series: RecurringSeries[], expected: ExpectedEntry[]): Scored {
  const taken = new Set<RecurringSeries>();
  const pairs: { e: ExpectedEntry; s: RecurringSeries }[] = [];
  const missed: ExpectedEntry[] = [];
  for (const e of expected) {
    const tol = e.variable ? e.currentAmount * 0.15 : 0.011;
    let best: RecurringSeries | null = null;
    let bestDiff = Infinity;
    for (const s of series) {
      if (taken.has(s)) continue;
      const ident = e.merchantId
        ? s.merchantId === e.merchantId
        : s.merchantId === null && s.descriptors.some((d) => d.toUpperCase().includes(e.match.toUpperCase()));
      if (!ident) continue;
      const diff = Math.abs(s.currentAmount - e.currentAmount);
      if (diff <= tol && diff < bestDiff) {
        best = s;
        bestDiff = diff;
      }
    }
    if (best) {
      taken.add(best);
      pairs.push({ e, s: best });
    } else missed.push(e);
  }
  const extra = series.filter((s) => !taken.has(s));
  return {
    expected: expected.length,
    detected: series.length,
    matched: pairs.length,
    recall: expected.length ? pairs.length / expected.length : 1,
    precision: series.length ? pairs.length / series.length : 1,
    pairs,
    missed,
    extra,
  };
}

/** Synthetic monthly charge helper for hand-built scenarios. */
export function monthly(description: string, amount: number, firstDate: string, count: number, day?: number): Txn[] {
  const out: Txn[] = [];
  const y0 = +firstDate.slice(0, 4), m0 = +firstDate.slice(5, 7);
  const d = day ?? +firstDate.slice(8, 10);
  for (let i = 0; i < count; i++) {
    const total = y0 * 12 + (m0 - 1) + i;
    const y = Math.floor(total / 12), m = (total % 12) + 1;
    out.push({ date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, description, amount });
  }
  return out;
}

export function sortTxns(t: Txn[]): Txn[] {
  return [...t].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ---------------------------------------------------------------------------------------------
// Synthetic data for performance tests

export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A KB the size of the real one (~300 merchants, 2 patterns each) on top of the test KB. */
export function bigKb(): Merchant[] {
  const out: Merchant[] = [...TEST_KB];
  const base = TEST_KB[0];
  for (let i = 0; i < 280; i++) {
    out.push({
      ...base,
      id: `bulk-${i}`,
      name: `Bulk ${i}`,
      match: { patterns: [`ZQX BULK ${i} SERVICE`, `^ZQXB${i}\\b|ZQX BULK ${i} SUB`], examples: [`ZQX BULK ${i} SERVICE`] },
    });
  }
  return out;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function synthetic(count: number, seed = 7): Txn[] {
  const r = prng(seed);
  const txns: Txn[] = [];
  const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, MONTH_DAYS[m - 1])).padStart(2, '0')}`;
  // ~100 subscriptions (half match the KB, half do not), 36 months
  for (let s = 0; s < 100 && txns.length < count; s++) {
    const matched = s % 2 === 0;
    const name = matched ? `ZQX BULK ${s} SERVICE 800-555-0100 CA` : `LOCAL SUB ${s} CLUB BOSTON MA`;
    const amount = Math.round((5 + r() * 60) * 100) / 100;
    const day = 1 + Math.floor(r() * 27);
    for (let m = 0; m < 36; m++) {
      txns.push({ date: iso(2024 + Math.floor(m / 12), (m % 12) + 1, day), description: name, amount });
    }
  }
  // the rest: everyday noise at ~1500 distinct merchants with per-transaction reference ids
  while (txns.length < count) {
    const merchant = Math.floor(r() * 1500);
    const ref = Math.floor(r() * 1e9).toString(36).toUpperCase();
    const kind = r();
    const description =
      kind < 0.3 ? `SQ *SHOP ${merchant} BOSTON MA` : kind < 0.55 ? `AMZN MKTP US*${ref}9X` : kind < 0.8 ? `STORE ${merchant} #${Math.floor(r() * 9999)} CAMBRIDGE MA` : `PURCHASE AUTHORIZED ON 0${1 + Math.floor(r() * 9)}/1${Math.floor(r() * 9)} MERCHANT ${merchant} S${Math.floor(r() * 1e12)}`;
    txns.push({
      date: iso(2024 + Math.floor(r() * 3), 1 + Math.floor(r() * 12), 1 + Math.floor(r() * 28)),
      description,
      amount: Math.round((2 + r() * 150) * 100) / 100,
    });
  }
  return txns.slice(0, count);
}


/** Charges every `days` days starting at `firstDate`. */
export function every(description: string, amount: number, firstDate: string, days: number, count: number): Txn[] {
  const t0 = Date.UTC(+firstDate.slice(0, 4), +firstDate.slice(5, 7) - 1, +firstDate.slice(8, 10));
  const out: Txn[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ date: new Date(t0 + i * days * 864e5).toISOString().slice(0, 10), description, amount });
  }
  return out;
}

/** Charges on explicit dates. */
export function on(description: string, amount: number, dates: string[]): Txn[] {
  return dates.map((date) => ({ date, description, amount }));
}
