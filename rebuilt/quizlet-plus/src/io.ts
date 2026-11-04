/**
 * Text import/export: Quizlet paste, CSV and JSON. Pure string-in, structure-out functions so
 * they can be unit tested without a browser. Images travel as data: URLs inside JSON only.
 */
import type { SchedFields, Settings } from './types';

export interface ParsedCard {
  front: string;
  back: string;
}
export interface Skipped {
  line: number;
  text: string;
  reason: string;
}
export interface ParseResult {
  cards: ParsedCard[];
  skipped: Skipped[];
}

const stripBom = (s: string) => s.replace(/^﻿/, '');

/**
 * Quizlet's export: one card per line, a TAB between term and definition (the defaults of its
 * Export dialog). Other separators can be passed when the export used custom ones.
 */
export function parseQuizlet(text: string, termSep = '\t', rowSep = '\n'): ParseResult {
  const cards: ParsedCard[] = [];
  const skipped: Skipped[] = [];
  const rows = rowSep === '\n' ? stripBom(text).split(/\r?\n/) : stripBom(text).split(rowSep);
  rows.forEach((raw, i) => {
    const row = rowSep === '\n' ? raw : raw.replace(/\r?\n/g, ' ');
    if (!row.trim()) return;
    const at = row.indexOf(termSep);
    if (at < 0) {
      skipped.push({ line: i + 1, text: row.slice(0, 80), reason: 'no separator between term and definition' });
      return;
    }
    const front = row.slice(0, at).trim();
    const back = row.slice(at + termSep.length).trim();
    if (!front || !back) {
      skipped.push({ line: i + 1, text: row.slice(0, 80), reason: 'term or definition is empty' });
      return;
    }
    cards.push({ front, back });
  });
  return { cards, skipped };
}

// ---------------------------------------------------------------- CSV

export function detectDelimiter(text: string): string {
  const first = stripBom(text).split(/\r?\n/, 1)[0] ?? '';
  let best = ',';
  let bestN = 0;
  for (const d of [',', ';', '\t']) {
    // count delimiters outside quotes
    let n = 0;
    let q = false;
    for (const ch of first) {
      if (ch === '"') q = !q;
      else if (!q && ch === d) n++;
    }
    if (n > bestN) {
      best = d;
      bestN = n;
    }
  }
  return best;
}

/** RFC 4180 style parser: quoted fields, "" escapes, newlines inside quotes. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = stripBom(text);
  const delim = delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0].trim() !== '') rows.push(row);
    row = [];
  };
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === '') inQuotes = true;
    else if (ch === delim) endField();
    else if (ch === '\n') endRow();
    else if (ch === '\r') {
      if (src[i + 1] === '\n') i++;
      endRow();
    } else field += ch;
    i++;
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

export interface CsvRow extends ParsedCard {
  deck?: string;
}
export interface CsvResult {
  rows: CsvRow[];
  skipped: Skipped[];
  hadHeader: boolean;
}

const FRONT_NAMES = ['front', 'term', 'question', 'word', 'prompt'];
const BACK_NAMES = ['back', 'definition', 'answer', 'meaning', 'translation'];

/** First two columns are front/back; a header row naming them (and optionally "deck") is honoured. */
export function parseCsvCards(text: string): CsvResult {
  const table = parseCsv(text);
  const skipped: Skipped[] = [];
  const rows: CsvRow[] = [];
  if (!table.length) return { rows, skipped, hadHeader: false };
  const head = table[0].map((c) => c.trim().toLowerCase());
  let fi = head.findIndex((c) => FRONT_NAMES.includes(c));
  let bi = head.findIndex((c) => BACK_NAMES.includes(c));
  const di = head.indexOf('deck');
  const hadHeader = fi >= 0 && bi >= 0;
  if (!hadHeader) {
    fi = 0;
    bi = 1;
  }
  table.slice(hadHeader ? 1 : 0).forEach((cols, i) => {
    const line = i + 1 + (hadHeader ? 1 : 0);
    const front = (cols[fi] ?? '').trim();
    const back = (cols[bi] ?? '').trim();
    if (!front || !back) {
      skipped.push({ line, text: cols.join(',').slice(0, 80), reason: 'needs both a front and a back column' });
      return;
    }
    const deck = di >= 0 ? (cols[di] ?? '').trim() : '';
    rows.push(deck ? { front, back, deck } : { front, back });
  });
  return { rows, skipped, hadHeader };
}

export function csvEscape(v: string): string {
  return /[",\r\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(table: string[][]): string {
  return table.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

export function cardsToCsv(cards: readonly ParsedCard[], deckName?: string): string {
  const withDeck = deckName !== undefined;
  const head = withDeck ? ['deck', 'front', 'back'] : ['front', 'back'];
  return toCsv([head, ...cards.map((c) => (withDeck ? [deckName, c.front, c.back] : [c.front, c.back]))]);
}

// ---------------------------------------------------------------- JSON

export interface ImportCard {
  id?: string;
  front: string;
  back: string;
  /** data: URL */
  frontImage?: string;
  backImage?: string;
  createdAt?: number;
  sched?: SchedFields;
}
export interface ImportDeck {
  id?: string;
  name: string;
  description?: string;
  newPerDay?: number;
  reviewsPerDay?: number;
  createdAt?: number;
  cards: ImportCard[];
}
export interface ImportReview {
  cardId: string;
  deckId: string;
  ts: number;
  rating: 1 | 2 | 3 | 4;
  prevState: 0 | 1 | 2 | 3;
  state: 0 | 1 | 2 | 3;
  elapsedDays: number;
  scheduledDays: number;
  mode: 'flip' | 'type' | 'choice' | 'match';
  durationMs: number;
}
export interface ImportBundle {
  decks: ImportDeck[];
  reviews: ImportReview[];
  settings?: Partial<Settings>;
  /** true when the file came from this app's full backup (ids, scheduling and history kept) */
  isBackup: boolean;
}

export const BACKUP_APP = 'flashcards-plus';
export const BACKUP_VERSION = 1;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const pick = (o: Record<string, unknown>, names: string[]): unknown => {
  for (const n of names) if (o[n] !== undefined && o[n] !== null) return o[n];
  return undefined;
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isDataUrl = (v: unknown): v is string => typeof v === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(v);

function readSched(v: unknown): SchedFields | undefined {
  if (!isObj(v)) return undefined;
  const state = num(v.state);
  const due = num(v.due);
  const stability = num(v.stability);
  const difficulty = num(v.difficulty);
  if (state === undefined || due === undefined || stability === undefined || difficulty === undefined) return undefined;
  if (![0, 1, 2, 3].includes(state)) return undefined;
  return {
    state: state as SchedFields['state'],
    due,
    stability,
    difficulty,
    reps: num(v.reps) ?? 0,
    lapses: num(v.lapses) ?? 0,
    lastReview: num(v.lastReview) ?? null,
    scheduledDays: num(v.scheduledDays) ?? 0,
  };
}

function readCard(v: unknown): ImportCard | null {
  if (!isObj(v)) return null;
  const front = str(pick(v, ['front', 'term', 'question', 'q', 'word']));
  const back = str(pick(v, ['back', 'definition', 'answer', 'a', 'meaning']));
  const fi = isDataUrl(v.frontImage) ? v.frontImage : undefined;
  const bi = isDataUrl(v.backImage) ? v.backImage : undefined;
  if ((!front?.trim() && !fi) || (!back?.trim() && !bi)) return null;
  const card: ImportCard = { front: (front ?? '').trim(), back: (back ?? '').trim() };
  const id = str(v.id);
  if (id) card.id = id;
  if (fi) card.frontImage = fi;
  if (bi) card.backImage = bi;
  const created = num(v.createdAt);
  if (created !== undefined) card.createdAt = created;
  const sched = readSched(v.sched);
  if (sched) card.sched = sched;
  return card;
}

function readDeck(v: unknown, fallbackName: string): ImportDeck | null {
  if (!isObj(v) || !Array.isArray(v.cards)) return null;
  const cards = v.cards.map(readCard).filter((c): c is ImportCard => c !== null);
  const deck: ImportDeck = { name: (str(v.name) ?? '').trim() || fallbackName, cards };
  const id = str(v.id);
  if (id) deck.id = id;
  const description = str(v.description);
  if (description) deck.description = description;
  const np = num(v.newPerDay);
  if (np !== undefined) deck.newPerDay = np;
  const rp = num(v.reviewsPerDay);
  if (rp !== undefined) deck.reviewsPerDay = rp;
  const ca = num(v.createdAt);
  if (ca !== undefined) deck.createdAt = ca;
  return deck;
}

function readReview(v: unknown): ImportReview | null {
  if (!isObj(v)) return null;
  const cardId = str(v.cardId);
  const deckId = str(v.deckId);
  const ts = num(v.ts);
  const rating = num(v.rating);
  const prevState = num(v.prevState);
  const state = num(v.state);
  if (!cardId || !deckId || ts === undefined || !rating || prevState === undefined || state === undefined) return null;
  if (![1, 2, 3, 4].includes(rating) || ![0, 1, 2, 3].includes(prevState) || ![0, 1, 2, 3].includes(state)) return null;
  const mode = str(v.mode);
  return {
    cardId,
    deckId,
    ts,
    rating: rating as ImportReview['rating'],
    prevState: prevState as ImportReview['prevState'],
    state: state as ImportReview['state'],
    elapsedDays: num(v.elapsedDays) ?? 0,
    scheduledDays: num(v.scheduledDays) ?? 0,
    mode: mode === 'type' || mode === 'choice' || mode === 'match' ? mode : 'flip',
    durationMs: num(v.durationMs) ?? 0,
  };
}

/**
 * Accepts this app's backup/deck exports, `{decks:[...]}`, a single `{name, cards}` deck, or a
 * bare array of `{front, back}` / `{term, definition}` objects.
 */
export function parseJsonImport(text: string, fallbackName = 'Imported deck'): ImportBundle {
  let data: unknown;
  try {
    data = JSON.parse(stripBom(text));
  } catch {
    throw new Error('That is not valid JSON.');
  }
  if (Array.isArray(data)) {
    const cards = data.map(readCard).filter((c): c is ImportCard => c !== null);
    if (!cards.length) throw new Error('No cards found: each item needs a "front" and a "back" (or "term" and "definition").');
    return { decks: [{ name: fallbackName, cards: stripIds(cards) }], reviews: [], isBackup: false };
  }
  if (!isObj(data)) throw new Error('Unrecognised JSON: expected an object or an array of cards.');
  const isBackup = data.app === BACKUP_APP;
  let decks: ImportDeck[] = [];
  if (Array.isArray(data.decks)) {
    decks = data.decks.map((d, i) => readDeck(d, `${fallbackName} ${i + 1}`)).filter((d): d is ImportDeck => d !== null);
  } else if (Array.isArray(data.cards)) {
    const d = readDeck(data, fallbackName);
    if (d) decks = [d];
  }
  if (!decks.length) throw new Error('No decks found in that JSON file.');
  const reviews = isBackup && Array.isArray(data.reviews) ? data.reviews.map(readReview).filter((r): r is ImportReview => r !== null) : [];
  const bundle: ImportBundle = { decks, reviews, isBackup };
  if (isBackup && isObj(data.settings)) bundle.settings = data.settings as Partial<Settings>;
  return bundle;
}

function stripIds(cards: ImportCard[]): ImportCard[] {
  return cards.map(({ id: _id, ...rest }) => rest);
}
