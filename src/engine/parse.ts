// Statement parsing (SPEC.md "Parsing rules"): CSV (any delimiter, with or without header), OFX/QFX.
// Pure TS, no DOM, no network, no dependencies.
import type { Txn } from '../types';

// ---------------------------------------------------------------------------------------------
// Delimited text

/** Cells kept per row. No bank statement has more than a few dozen columns; a file with millions of cells in one
 *  row (a 24 MB line of "A,A,A,...") would otherwise make every later pass walk millions of columns. */
export const MAX_COLUMNS = 64;

/**
 * Quote-aware delimited parser. Handles "" escapes and newlines inside quotes. Keeps at most MAX_COLUMNS cells per
 * row (the rest are scanned but not stored) and stops after `maxRows` rows (default: no limit).
 */
export function parseDelimited(text: string, delim: string, maxRows = Infinity): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQ = false;
  // only used for cells past MAX_COLUMNS, which are not accumulated: has the dropped cell had a character yet?
  let seen = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    const full = row.length >= MAX_COLUMNS;
    if (inQ) {
      if (c === 34) {
        if (text.charCodeAt(i + 1) === 34) {
          if (!full) field += '"';
          i++;
        } else inQ = false;
      } else if (!full) field += text[i];
      continue;
    }
    if (c === 34) {
      // a quote only opens a quoted field at the start of the field
      if (full ? !seen : field === '') inQ = true;
      else if (!full) field += '"';
      seen = true;
    } else if (text[i] === delim) {
      if (!full) row.push(field);
      field = '';
      seen = false;
    } else if (c === 10 || c === 13) {
      if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
      if (!full) row.push(field);
      field = '';
      seen = false;
      if (row.length > 1 || row[0] !== '') {
        rows.push(row);
        if (rows.length >= maxRows) return rows;
      }
      row = [];
    } else if (full) seen = true;
    else field += text[i];
  }
  if (!(row.length >= MAX_COLUMNS)) row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

const DELIM_SAMPLE_CHARS = 200_000;

function countFields(line: string, delim: string): number {
  let n = 1;
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (!inQ && c === delim) n++;
  }
  return n;
}

/** Pick the delimiter that splits the first lines into the most consistent number (>= 2) of fields. */
export function detectDelimiter(text: string): string {
  // only the first 60 non-empty lines matter: do not split a 24 MB file into 300k strings to read them
  let head = text;
  if (text.length > DELIM_SAMPLE_CHARS) {
    head = text.slice(0, DELIM_SAMPLE_CHARS);
    const cut = Math.max(head.lastIndexOf('\n'), head.lastIndexOf('\r'));
    if (cut > 0) head = head.slice(0, cut); // drop the partial last line
  }
  const lines = head.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '').slice(0, 60);
  let best = ',';
  let bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = new Map<number, number>();
    for (const l of lines) {
      const c = countFields(l, d);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    let mode = 1;
    let modeN = 0;
    for (const [c, k] of counts) if (c > 1 && k > modeN) { mode = c; modeN = k; }
    if (mode < 2) continue;
    const score = (modeN / Math.max(1, lines.length)) * 1000 + mode;
    if (score > bestScore + 1e-9) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Dates

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function validYmd(y: number, m: number, d: number): boolean {
  return y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}
function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function fullYear(y: number): number {
  if (y >= 100) return y;
  return y <= 69 ? 2000 + y : 1900 + y;
}

type DateOrder = 'mdy' | 'dmy';

type DateParts = {
  /** Fully determined ISO date, when the format itself settles the order. */
  iso?: string;
  /** Numeric a/b/year for formats whose order depends on the file (a/b or b/a). */
  a?: number;
  b?: number;
  y?: number;
};

const RE_ISO = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/;
const RE_COMPACT = /^(\d{4})(\d{2})(\d{2})(?:\d{6}.*)?$/;
const RE_NUM = /^(\d{1,2})([/\-.])(\d{1,2})\2(\d{2}|\d{4})(?:[T ,].*)?$/;
const RE_DMON = /^(\d{1,2})[ \-/.]([A-Za-z]{3,9})\.?,?[ \-/.](\d{2}|\d{4})(?:[T ,].*)?$/;
const RE_MONDY = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})(?:[T ,].*)?$/;

/** Split a date string into parts without committing to day-first or month-first. */
export function dateParts(raw: string): DateParts | null {
  const s = raw.trim().replace(/^"|"$/g, '');
  if (!s) return null;
  let m = RE_ISO.exec(s);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    return validYmd(y, mo, d) ? { iso: iso(y, mo, d) } : null;
  }
  m = RE_NUM.exec(s);
  if (m) {
    const a = +m[1], b = +m[3], y = fullYear(+m[4]);
    if (m[2] === '.') {
      // DD.MM.YYYY is unambiguous (day first)
      return validYmd(y, b, a) ? { iso: iso(y, b, a) } : null;
    }
    return { a, b, y };
  }
  m = RE_DMON.exec(s);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    const d = +m[1], y = fullYear(+m[3]);
    return mo && validYmd(y, mo, d) ? { iso: iso(y, mo, d) } : null;
  }
  m = RE_MONDY.exec(s);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    const d = +m[2], y = +m[3];
    return mo && validYmd(y, mo, d) ? { iso: iso(y, mo, d) } : null;
  }
  m = RE_COMPACT.exec(s);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    return validYmd(y, mo, d) ? { iso: iso(y, mo, d) } : null;
  }
  return null;
}

function resolveParts(p: DateParts, order: DateOrder): string | null {
  if (p.iso) return p.iso;
  const a = p.a!, b = p.b!, y = p.y!;
  const [mo, d] = order === 'mdy' ? [a, b] : [b, a];
  return validYmd(y, mo, d) ? iso(y, mo, d) : null;
}

/** Parse one date string (tests and callers that know the order use this directly). */
export function parseDate(raw: string, order: DateOrder = 'mdy'): string | null {
  const p = dateParts(raw);
  return p ? resolveParts(p, order) : null;
}

/**
 * Decide DD/MM vs MM/DD for a whole column. `evidence` says whether a value settled it
 * (some first field > 12, or some second field > 12) or we had to guess.
 */
export function detectDateOrder(values: (DateParts | null)[]): { order: DateOrder; certain: boolean; reason: string } {
  let dmy = 0, mdy = 0, ambiguous = 0;
  for (const p of values) {
    if (!p || p.iso) continue;
    const a = p.a!, b = p.b!;
    if (a > 12 && b <= 12) dmy++;
    else if (b > 12 && a <= 12) mdy++;
    else if (a <= 12 && b <= 12 && a !== b) ambiguous++;
  }
  if (dmy > 0 && mdy === 0) return { order: 'dmy', certain: true, reason: 'a day above 12 appears first' };
  if (mdy > 0 && dmy === 0) return { order: 'mdy', certain: true, reason: 'a day above 12 appears second' };
  if (dmy > 0 && mdy > 0) {
    return { order: dmy > mdy ? 'dmy' : 'mdy', certain: false, reason: 'the file mixes both orders' };
  }
  if (ambiguous === 0) return { order: 'mdy', certain: true, reason: 'no ambiguous dates' };
  // Nothing settles it: prefer the reading that keeps the file in chronological order.
  const viol = (order: DateOrder): number => {
    const days: number[] = [];
    for (const p of values) {
      if (!p) continue;
      const s = resolveParts(p, order);
      if (!s) { days.push(NaN); continue; }
      days.push(Date.parse(s));
    }
    let up = 0, down = 0, bad = 0;
    for (let i = 1; i < days.length; i++) {
      if (Number.isNaN(days[i]) || Number.isNaN(days[i - 1])) { bad++; continue; }
      if (days[i] > days[i - 1]) up++;
      else if (days[i] < days[i - 1]) down++;
    }
    return Math.min(up, down) + bad;
  };
  const vm = viol('mdy'), vd = viol('dmy');
  // switch away from the US default only on clear evidence: perfectly ordered one way, not the other
  if (vd < vm && (vd === 0 || vd * 3 <= vm)) return { order: 'dmy', certain: false, reason: 'DD/MM keeps the rows in date order' };
  return { order: 'mdy', certain: false, reason: vm < vd ? 'MM/DD keeps the rows in date order' : 'US order is the default' };
}

// ---------------------------------------------------------------------------------------------
// Amounts

export type ParsedAmount = { value: number; dir?: 'in' | 'out' };

const CURRENCY_RE = /(?:USD|EUR|GBP|CAD|AUD|CHF|SEK|NOK|DKK|NZD)/gi;

/**
 * Parse a money cell. Handles $ € £, thousands separators, decimal commas, (parens) negatives,
 * leading/trailing minus and trailing CR/DR (reported as `dir`).
 * `decimalComma` is the file-level hint for ambiguous single-separator values.
 */
export function parseAmount(raw: string, decimalComma = false): ParsedAmount | null {
  let s = raw.trim().replace(/^"|"$/g, '');
  if (!s) return null;
  s = s.replace(/[  \s]/g, '').replace(/−/g, '-').replace(CURRENCY_RE, '').replace(/[$€£¥]/g, '');
  let dir: 'in' | 'out' | undefined;
  const crdr = /(CR|DR)$/i.exec(s);
  if (crdr) {
    dir = crdr[1].toUpperCase() === 'CR' ? 'in' : 'out';
    s = s.slice(0, -2);
  }
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  else if (s.startsWith('+')) s = s.slice(1);
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let decimalSep: '.' | ',' | null = null;
  if (lastDot >= 0 && lastComma >= 0) decimalSep = lastDot > lastComma ? '.' : ',';
  else if (lastComma >= 0) {
    const tail = s.length - lastComma - 1;
    const multi = s.indexOf(',') !== lastComma;
    if (multi) decimalSep = null; // 1,234,567 -> thousands
    else if (tail === 3 && !decimalComma) decimalSep = null; // 1,234 -> thousands
    else decimalSep = ',';
  } else if (lastDot >= 0) {
    const tail = s.length - lastDot - 1;
    const multi = s.indexOf('.') !== lastDot;
    if (multi) decimalSep = null; // 1.234.567 -> thousands (EU)
    else if (decimalComma && tail === 3) decimalSep = null; // EU file: 1.234 is a thousand
    else decimalSep = '.';
  }
  let intPart: string, frac = '';
  if (decimalSep) {
    const idx = s.lastIndexOf(decimalSep);
    intPart = s.slice(0, idx);
    frac = s.slice(idx + 1);
  } else intPart = s;
  intPart = intPart.replace(/[.,]/g, '');
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return null;
  const v = Number(`${intPart || '0'}.${frac || '0'}`);
  if (!Number.isFinite(v)) return null;
  return { value: neg ? -v : v, dir };
}

// ---------------------------------------------------------------------------------------------
// Column mapping

const DATE_PRIORITY = [
  'transaction date', 'trans. date', 'trans date', 'date', 'started date', 'booking date', 'posting date',
  'posted date', 'completed date', 'post date', 'value date', 'effective date', 'clearing date',
];
const DESC_PRIORITY = [
  'description', 'transaction description', 'payee', 'merchant', 'merchant name', 'name', 'details',
  'narrative', 'original description', 'memo',
];
const AMOUNT_EXACT = ['amount', 'transaction amount', 'amount (usd)', 'value'];
const DEBIT_NAMES = ['debit', 'debits', 'withdrawal', 'withdrawals', 'money out', 'paid out', 'amount debited'];
const CREDIT_NAMES = ['credit', 'credits', 'deposit', 'deposits', 'money in', 'paid in', 'amount credited'];

type ColumnMap = {
  dates: number[];
  descs: number[];
  amount: number;
  debit: number;
  credit: number;
  state: number;
  /** "Type" column (Apple Card: Purchase / Installment / Payment / Credit), -1 when absent */
  type: number;
  currency: number;
  currencyHint?: string;
};

function cleanHeader(h: string): string {
  return h.replace(/^﻿/, '').replace(/^"|"$/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function mapHeader(cells: string[]): ColumnMap | null {
  const h = cells.map(cleanHeader);
  const find = (names: string[]): number[] => {
    const out: number[] = [];
    for (const n of names) {
      const i = h.indexOf(n);
      if (i >= 0 && !out.includes(i)) out.push(i);
    }
    return out;
  };
  const dates = find(DATE_PRIORITY);
  let amountIdx = find(AMOUNT_EXACT)[0] ?? -1;
  if (amountIdx < 0) amountIdx = h.findIndex((x) => /^amount\b/.test(x) && !/local|available|balance/.test(x));
  const debit = find(DEBIT_NAMES)[0] ?? -1;
  const credit = find(CREDIT_NAMES)[0] ?? -1;
  if (!dates.length || (amountIdx < 0 && debit < 0 && credit < 0)) return null;
  const descs = find(DESC_PRIORITY);
  const state = h.findIndex((x) => x === 'state' || x === 'status');
  const type = h.findIndex((x) => x === 'type' || x === 'transaction type');
  const currency = h.findIndex((x) => x === 'currency');
  const cur = /amount \(([a-z]{3})\)/.exec(h[amountIdx] ?? '');
  return { dates, descs, amount: amountIdx, debit, credit, state, type, currency, currencyHint: cur?.[1]?.toUpperCase() };
}

// ---------------------------------------------------------------------------------------------
// Sign convention for single-amount-column files

// Strong keywords only ever describe money coming in. Weak ones ("PAYMENT", "CREDIT") also appear on
// outgoing rows ("RECURRING PAYMENT AUTHORIZED ON ...", "CREDIT CARD BILL"), so they are used only when no
// strong keyword settles the question. Bare AUTOPAY is not a keyword: on a checking account it is an outgoing bill.
const STRONG_CREDIT =
  /THANK YOU|PAYMENT RECEIVED|PAYMENT FROM|AUTOPAY PAYMENT|\bDEPOSIT\b|PAYROLL|DIRECT ?DEP|\bREFUND\b|INTEREST (?:PAID|PAYMENT|EARNED)|TRANSFER FROM|RECEIVED FROM|\bTOP-?UP\b|\bSALARY\b|DIRECTPAY|\bRETURN\b|\bCASHBACK\b|\bREBATE\b/;
const WEAK_CREDIT = /\bPAYMENT\b(?! TO| AUTHORIZED)|\bCREDIT\b|\bREVERSAL\b/;

/** +1 if charges are positive in the file, -1 if charges are negative. */
export function chargeSign(rows: { value: number; desc: string }[]): { sign: 1 | -1; byKeyword: boolean } {
  let pos = 0, neg = 0, strongPos = 0, strongNeg = 0, weakPos = 0, weakNeg = 0;
  for (const r of rows) {
    if (r.value === 0) continue;
    const d = r.desc.toUpperCase();
    const strong = STRONG_CREDIT.test(d);
    const weak = !strong && WEAK_CREDIT.test(d);
    if (r.value > 0) {
      pos++;
      if (strong) strongPos++;
      else if (weak) weakPos++;
    } else {
      neg++;
      if (strong) strongNeg++;
      else if (weak) weakNeg++;
    }
  }
  // money-in sign = the sign carrying the credit keywords; charges are the opposite
  if (strongPos + strongNeg >= 1 && strongPos !== strongNeg && (strongPos >= 2 * strongNeg || strongNeg >= 2 * strongPos)) {
    return { sign: strongPos > strongNeg ? -1 : 1, byKeyword: true };
  }
  if (strongPos + strongNeg === 0 && weakPos + weakNeg >= 3 && (weakPos >= 3 * weakNeg || weakNeg >= 3 * weakPos)) {
    return { sign: weakPos > weakNeg ? -1 : 1, byKeyword: true };
  }
  return { sign: pos >= neg ? 1 : -1, byKeyword: false };
}

// ---------------------------------------------------------------------------------------------
// CSV files

function stripBom(t: string): string {
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
}

function inferDecimalComma(delim: string, samples: string[]): boolean {
  let comma = 0, dot = 0;
  for (const s0 of samples) {
    const s = s0.replace(/[\s$€£]/g, '');
    if (/^-?\d+,\d{1,2}$/.test(s) || /^-?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) comma++;
    else if (/^-?\d+\.\d{1,2}$/.test(s) || /^-?\d{1,3}(,\d{3})+\.\d{1,2}$/.test(s)) dot++;
  }
  if (comma > 0 && dot === 0) return true;
  if (comma === 0 && dot === 0 && delim === ';') return true;
  return comma > dot * 2;
}

type Inferred = { map: ColumnMap; headerRow: number } | null;

/** Find the header row (within the first 40 rows) or return null for headerless files. */
function findHeader(rows: string[][]): Inferred {
  const limit = Math.min(rows.length, 40);
  for (let i = 0; i < limit; i++) {
    const map = mapHeader(rows[i]);
    if (map) return { map, headerRow: i };
  }
  return null;
}

/** Headerless files (e.g. Wells Fargo: date, amount, *, *, description): infer columns by content. */
function inferColumns(rows: string[][]): ColumnMap | null {
  const sample = rows.slice(0, 200);
  const width = Math.max(...sample.map((r) => r.length));
  if (width < 3) return null;
  const decimalComma = inferDecimalComma(',', sample.flatMap((r) => r));
  type Stat = { date: number; amount: number; text: number; len: number; neg: number; decimals: number };
  const stats: Stat[] = [];
  for (let j = 0; j < width; j++) {
    const st: Stat = { date: 0, amount: 0, text: 0, len: 0, neg: 0, decimals: 0 };
    let n = 0;
    for (const r of sample) {
      const v = (r[j] ?? '').trim();
      if (!v) continue;
      n++;
      if (dateParts(v)) st.date++;
      const a = parseAmount(v, decimalComma);
      if (a && /^[-+(]?[$€£]?[\d.,]+\)?$/.test(v.replace(/\s/g, ''))) {
        st.amount++;
        if (a.value < 0) st.neg++;
        if (/[.,]\d{1,2}$/.test(v)) st.decimals++;
      }
      if (/[A-Za-z]{3,}/.test(v)) {
        st.text++;
        st.len += v.length;
      }
    }
    if (n > 0) {
      st.date /= n; st.amount /= n; st.text /= n;
      st.len = st.text > 0 ? st.len / (st.text * n) : 0;
    }
    stats.push(st);
  }
  const dateCol = stats.findIndex((s) => s.date >= 0.8);
  if (dateCol < 0) return null;
  const amtCands = stats
    .map((s, j) => ({ s, j }))
    .filter(({ s, j }) => j !== dateCol && s.amount >= 0.8 && s.date < 0.5);
  if (!amtCands.length) return null;
  amtCands.sort((x, y) => (y.s.neg > 0 ? 1 : 0) - (x.s.neg > 0 ? 1 : 0) || (y.s.decimals - x.s.decimals) || x.j - y.j);
  const amountCol = amtCands[0].j;
  const descCands = stats
    .map((s, j) => ({ s, j }))
    .filter(({ s, j }) => j !== dateCol && j !== amountCol && s.text >= 0.5)
    .sort((x, y) => y.s.len - x.s.len);
  if (!descCands.length) return null;
  return { dates: [dateCol], descs: [descCands[0].j], amount: amountCol, debit: -1, credit: -1, state: -1, type: -1, currency: -1 };
}

const BAD_STATES = /^(declined|failed|reverted|rejected|cancelled|canceled)$/i;
// Apple Card marks the monthly payments on a financed purchase (an iPhone at 0%) as Type=Installment. They repeat
// like a subscription but are a loan repayment, so they are left out rather than reported as one.
const INSTALLMENT_TYPE = /^installments?$/i;
const SKIP_DESC = /\b(beginning|ending|opening|closing) balance\b|^total\b|^balance\b/i;

function parseCsv(name: string, text: string, warnings: string[]): Txn[] {
  const delim = detectDelimiter(text);
  const rows = parseDelimited(text, delim, MAX_ROWS + 1);
  if (!rows.length) {
    warnings.push(`${name}: the file is empty`);
    return [];
  }
  if (rows.length > MAX_ROWS) {
    rows.length = MAX_ROWS;
    warnings.push(`${name}: only the first ${MAX_ROWS.toLocaleString('en-US')} rows were read; a statement is never this long, so check that it is the right file.`);
  }

  let header = findHeader(rows);
  let map: ColumnMap;
  let dataRows: string[][];
  if (header) {
    map = header.map;
    dataRows = rows.slice(header.headerRow + 1);
  } else {
    const inferred = inferColumns(rows);
    if (!inferred) {
      warnings.push(`${name}: could not find date and amount columns, so this file was skipped`);
      return [];
    }
    map = inferred;
    dataRows = rows;
  }

  // Amount style for the whole file
  const amountSamples: string[] = [];
  for (const r of dataRows.slice(0, 400)) {
    for (const c of [map.amount, map.debit, map.credit]) if (c >= 0 && r[c]) amountSamples.push(r[c]);
  }
  const decimalComma = inferDecimalComma(delim, amountSamples);

  // Date order for the whole file (first date column that parses for most rows wins per row)
  const partsAll = dataRows.map((r) => {
    for (const c of map.dates) {
      const p = dateParts(r[c] ?? '');
      if (p) return p;
    }
    return null;
  });
  const order = detectDateOrder(partsAll);
  if (!order.certain && partsAll.some((p) => p && !p.iso)) {
    warnings.push(
      `${name}: the dates could be DD/MM/YYYY or MM/DD/YYYY and nothing in the file settles it (${order.reason}); assumed ${
        order.order === 'mdy' ? 'MM/DD/YYYY' : 'DD/MM/YYYY'
      }.`,
    );
  }

  const parsed: { date: string; desc: string; value: number; dir?: 'in' | 'out'; explicit: boolean }[] = [];
  let skipped = 0;
  let installments = 0;
  let firstSkipped = '';
  let rowNo = (header ? header.headerRow + 1 : 0);
  for (let i = 0; i < dataRows.length; i++) {
    rowNo++;
    const r = dataRows[i];
    const parts = partsAll[i];
    const date = parts ? resolveParts(parts, order.order) : null;
    let desc = '';
    for (const c of map.descs) {
      const v = (r[c] ?? '').trim();
      if (v) { desc = v; break; }
    }
    if (map.state >= 0 && BAD_STATES.test((r[map.state] ?? '').trim())) continue;
    if (map.type >= 0 && INSTALLMENT_TYPE.test((r[map.type] ?? '').trim())) {
      installments++;
      continue;
    }
    if (SKIP_DESC.test(desc)) continue;

    let value: number | null = null;
    let dir: 'in' | 'out' | undefined;
    let explicit = false;
    if (map.amount >= 0) {
      const a = parseAmount(r[map.amount] ?? '', decimalComma);
      if (a) { value = a.value; dir = a.dir; }
    }
    if (value === null && (map.debit >= 0 || map.credit >= 0)) {
      const d = map.debit >= 0 ? parseAmount(r[map.debit] ?? '', decimalComma) : null;
      const c = map.credit >= 0 ? parseAmount(r[map.credit] ?? '', decimalComma) : null;
      if (d || c) {
        value = Math.abs(d?.value ?? 0) - Math.abs(c?.value ?? 0);
        explicit = true; // sign is already "positive = charge"
      }
    }
    const blank = r.every((c) => c.trim() === '');
    if (!date || value === null || !desc) {
      if (!blank && !(map.amount >= 0 && !(r[map.amount] ?? '').trim() && !explicit) && !(i === 0 && !header)) {
        skipped++;
        if (!firstSkipped) firstSkipped = `row ${rowNo}`;
      }
      continue;
    }
    parsed.push({ date, desc: desc.replace(/\s+/g, ' ').trim(), value, dir, explicit });
  }

  if (skipped > 0) {
    warnings.push(`${name}: skipped ${skipped} row${skipped === 1 ? '' : 's'} with a missing date, description or amount (first: ${firstSkipped}).`);
  }
  if (installments > 0) {
    warnings.push(`${name}: left out ${installments} installment payment${installments === 1 ? '' : 's'} (monthly payments on a financed purchase are not subscriptions).`);
  }
  if (!parsed.length) {
    warnings.push(`${name}: no transactions found`);
    return [];
  }

  // Currency hint
  const cur = new Set<string>();
  if (map.currencyHint) cur.add(map.currencyHint);
  if (map.currency >= 0) for (const r of dataRows.slice(0, 50)) if (r[map.currency]) cur.add(r[map.currency].trim().toUpperCase());
  if (amountSamples.some((s) => /£/.test(s))) cur.add('GBP');
  if (amountSamples.some((s) => /€/.test(s))) cur.add('EUR');
  cur.delete('');
  if (cur.size && !(cur.size === 1 && cur.has('USD')) && ![...cur].every((c) => c === 'USD')) {
    warnings.push(`${name}: amounts look like ${[...cur].join('/')}; they are read as dollars, so savings figures are in that currency.`);
  }

  // Sign convention. Split Debit/Credit columns are already positive = charge.
  const single = parsed.filter((p) => !p.explicit && !p.dir);
  const { sign } = single.length ? chargeSign(single.map((p) => ({ value: p.value, desc: p.desc }))) : { sign: 1 as const };
  const out: Txn[] = [];
  for (const p of parsed) {
    let amount: number;
    if (p.explicit) amount = p.value;
    else if (p.dir) amount = p.dir === 'out' ? Math.abs(p.value) : -Math.abs(p.value);
    else amount = p.value * sign;
    out.push({ date: p.date, description: p.desc, amount: Math.round(amount * 100) / 100, source: name });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// OFX / QFX

function decodeEntities(s: string): string {
  return s.replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'");
}

function parseOfx(name: string, text: string, warnings: string[]): Txn[] {
  const out: Txn[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1, MAX_ROWS + 1);
  if (!blocks.length) {
    warnings.push(`${name}: no transactions found in this OFX file`);
    return [];
  }
  let skipped = 0;
  for (const raw of blocks) {
    const end = raw.search(/<\/STMTTRN>|<\/BANKTRANLIST>|<\/CCSTMTRS>|<\/STMTRS>/i);
    const block = end >= 0 ? raw.slice(0, end) : raw;
    const get = (tag: string): string => {
      const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(block);
      return m ? decodeEntities(m[1]).trim() : '';
    };
    const dt = get('DTPOSTED') || get('DTUSER');
    const dm = /^(\d{4})(\d{2})(\d{2})/.exec(dt);
    const amt = parseAmount(get('TRNAMT'), /^\s*-?\d+,\d{1,2}\s*$/.test(get('TRNAMT')));
    const nameTag = get('NAME') || get('PAYEE');
    const memo = get('MEMO');
    let desc = nameTag;
    if (memo) {
      if (!nameTag) desc = memo;
      else if (memo.toUpperCase().includes(nameTag.toUpperCase())) desc = memo;
      else if (!nameTag.toUpperCase().includes(memo.toUpperCase())) desc = `${nameTag} ${memo}`;
    }
    desc = desc.replace(/\s+/g, ' ').trim();
    if (!dm || !amt || !desc || !validYmd(+dm[1], +dm[2], +dm[3])) {
      skipped++;
      continue;
    }
    // OFX: TRNAMT negative = money out
    out.push({ date: `${dm[1]}-${dm[2]}-${dm[3]}`, description: desc, amount: Math.round(-amt.value * 100) / 100, source: name });
  }
  if (skipped) warnings.push(`${name}: skipped ${skipped} OFX transaction${skipped === 1 ? '' : 's'} with a missing date, amount or name.`);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Public

/** Rows read per file. A statement never has this many; it bounds the work a hostile or wrong file can cause. */
export const MAX_ROWS = 200_000;
/** Largest single file (characters) and largest combined input that parseFiles will read. */
export const MAX_FILE_CHARS = 25_000_000;
export const MAX_TOTAL_CHARS = 30_000_000;

/**
 * Cheap look at the start of a file to catch what is plainly not a CSV/OFX statement (an .xlsx, a PDF, other binary,
 * or a single enormous line) before any real work. Returns a friendly reason, or null when the file looks fine.
 */
export function sniffUnreadable(text: string): string | null {
  if (text.startsWith('PK\u0003\u0004')) {
    return 'this looks like an Excel or zip file, not a CSV. In Excel use Save As and pick CSV, or download the CSV, OFX or QFX version from your bank.';
  }
  if (text.startsWith('%PDF')) {
    return 'this looks like a PDF, which cannot be read here. Download the CSV, OFX or QFX version of the statement from your bank.';
  }
  const head = text.slice(0, 4096);
  let odd = 0;
  for (let i = 0; i < head.length; i++) {
    const c = head.charCodeAt(i);
    if (c === 0) return 'this looks like a binary file, not a text statement. Export the statement as CSV, OFX or QFX.';
    if (c === 0xfffd || (c < 32 && c !== 9 && c !== 10 && c !== 13)) odd++;
  }
  if (head.length > 0 && odd / head.length >= 0.1) {
    return 'this looks like a binary file, not a text statement. Export the statement as CSV, OFX or QFX.';
  }
  // OFX files are sometimes one long line, so only a CSV-ish file without any line break is suspicious
  if (text.length > 65536 && !/[\r\n]/.test(text.slice(0, 65536)) && !/<OFX|<STMTTRN/i.test(text.slice(0, 20000))) {
    return 'this has no line breaks in its first 64 KB, so it is not a statement. Export the statement as CSV, OFX or QFX.';
  }
  return null;
}

/** Parse one file's text. Exposed for tests; use parseFiles in the app. */
export function parseOne(name: string, text0: string): { txns: Txn[]; warnings: string[] } {
  const warnings: string[] = [];
  const text = stripBom(text0);
  const unreadable = sniffUnreadable(text);
  if (unreadable) return { txns: [], warnings: [`${name}: ${unreadable}`] };
  const isOfx = /<OFX[\s>]|OFXHEADER:|<STMTTRN>/i.test(text.slice(0, 20000)) || /<STMTTRN>/i.test(text);
  const txns = isOfx ? parseOfx(name, text, warnings) : parseCsv(name, text, warnings);
  return { txns, warnings };
}

/** Merge files; identical rows that appear in more than one file (overlapping exports) are kept once. */
export function mergeTxns(perFile: Txn[][]): Txn[] {
  const keyOf = (t: Txn) => `${t.date}|${t.amount.toFixed(2)}|${t.description}`;
  const best = new Map<string, { count: number; rows: Txn[] }>();
  for (const txns of perFile) {
    const local = new Map<string, Txn[]>();
    for (const t of txns) {
      const k = keyOf(t);
      const arr = local.get(k);
      if (arr) arr.push(t);
      else local.set(k, [t]);
    }
    for (const [k, rows] of local) {
      const cur = best.get(k);
      // identical purchases inside ONE file are real; only cross-file repeats are duplicates
      if (!cur || rows.length > cur.count) best.set(k, { count: rows.length, rows });
    }
  }
  const all: Txn[] = [];
  // a loop, not push(...rows): spreading 125k+ identical rows into one call overflows the call stack
  for (const { rows } of best.values()) for (const r of rows) all.push(r);
  // stable sort by date
  return all
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : a.i - b.i))
    .map((x) => x.t);
}

export async function parseFiles(
  files: { name: string; text: string }[],
): Promise<{ txns: Txn[]; warnings: string[] }> {
  const warnings: string[] = [];
  const perFile: Txn[][] = [];
  let totalChars = 0;
  for (const f of files) {
    if (f.text.length > MAX_FILE_CHARS) {
      warnings.push(`${f.name}: this file is larger than ${Math.round(MAX_FILE_CHARS / 1_000_000)} MB, which no statement is, so it was skipped.`);
      continue;
    }
    if (totalChars + f.text.length > MAX_TOTAL_CHARS) {
      warnings.push(`${f.name}: skipped, because the files together are larger than ${Math.round(MAX_TOTAL_CHARS / 1_000_000)} MB. Try fewer files at a time.`);
      continue;
    }
    totalChars += f.text.length;
    try {
      const r = parseOne(f.name, f.text);
      warnings.push(...r.warnings);
      perFile.push(r.txns);
    } catch (e) {
      warnings.push(`${f.name}: could not be read (${e instanceof Error ? e.message : 'unknown error'})`);
    }
  }
  const txns = mergeTxns(perFile);
  const raw = perFile.reduce((n, t) => n + t.length, 0);
  if (perFile.length > 1 && raw > txns.length) {
    warnings.push(`Dropped ${raw - txns.length} duplicate row${raw - txns.length === 1 ? '' : 's'} that appear in more than one file.`);
  }
  return { txns, warnings };
}
