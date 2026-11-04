import type { BabyEvent, BottleContent, DiaperKind } from './types';

/**
 * Generic CSV importer with a user-confirmed column mapping. It is tuned for the layout the
 * Huckleberry app's CSV export is believed to use (Start, End, Duration, Type, Start Condition,
 * Start Location, End Condition, Notes) but that layout could not be verified here, so the
 * mapping is always shown to the user (and editable) before anything is written.
 */

export type MappedType = 'sleep' | 'breast' | 'bottle' | 'feed' | 'diaper' | 'pump' | 'skip';
export const MAPPED_TYPES: { value: MappedType; label: string }[] = [
  { value: 'sleep', label: 'Sleep' },
  { value: 'breast', label: 'Breast feed' },
  { value: 'bottle', label: 'Bottle feed' },
  { value: 'feed', label: 'Feed (decide from details)' },
  { value: 'diaper', label: 'Diaper' },
  { value: 'pump', label: 'Pumping' },
  { value: 'skip', label: 'Skip these rows' },
];

export interface Mapping {
  /** column indexes, -1 = not present */
  start: number;
  end: number;
  duration: number;
  type: number;
  notes: number;
  child: number;
  /** extra columns scanned for subtype, side, amount, diaper kind */
  details: number[];
  typeMap: Record<string, MappedType>;
  dateOrder: 'mdy' | 'dmy';
  amountUnit: 'ml' | 'oz';
}

const OZ_ML = 29.5735;

export function guessMapping(header: string[], rows: string[][]): Mapping {
  const h = header.map((x) => x.trim().toLowerCase());
  const find = (...res: RegExp[]) => {
    for (const re of res) {
      const i = h.findIndex((x) => re.test(x));
      if (i >= 0) return i;
    }
    return -1;
  };
  const start = find(/^(start|start time|started|begin|from|date ?time|time)$/, /^start\b(?!.*(condition|location))/);
  const end = find(/^(end|end time|ended|stop|finish|to)$/);
  const duration = find(/^(duration|length|minutes|mins)$/, /duration/);
  const type = find(/^(type|activity|event|category|kind)$/);
  const notes = find(/^(notes?|comments?|memo)$/, /note/);
  const child = find(/^(child|baby|child name|baby name)$/);
  const taken = new Set([start, end, duration, type, notes, child]);
  const details = h
    .map((x, i) => (!taken.has(i) && /(condition|location|detail|side|breast|amount|volume|quantity|diaper|content|method|subtype)/.test(x) ? i : -1))
    .filter((i) => i >= 0);
  const typeMap: Record<string, MappedType> = {};
  if (type >= 0) for (const v of distinct(rows, type)) typeMap[v] = guessType(v);
  return { start, end, duration, type, notes, child, details, typeMap, dateOrder: 'mdy', amountUnit: 'ml' };
}

export function distinct(rows: string[][], col: number, limit = 50): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = (r[col] ?? '').trim();
    if (v) set.add(v);
    if (set.size >= limit) break;
  }
  return [...set];
}

export function guessType(raw: string): MappedType {
  const s = raw.toLowerCase();
  if (/solid|growth|medic|temperature|tummy|bath|vitamin|weight|height/.test(s)) return 'skip';
  if (/sleep|nap|bedtime/.test(s)) return 'sleep';
  if (/diaper|nappy|\bpee\b|\bpoo|\bwet\b|dirty|potty/.test(s)) return 'diaper';
  if (/pump/.test(s)) return 'pump';
  if (/bottle/.test(s)) return 'bottle';
  if (/breast|nurs/.test(s)) return 'breast';
  if (/feed/.test(s)) return 'feed';
  return 'skip';
}

/* ------------------------------ parsing helpers ------------------------------ */

export function parseDateTime(raw: string, order: 'mdy' | 'dmy' = 'mdy'): number | null {
  const s = raw.trim();
  if (!s) return null;
  // ISO-ish: 2026-11-03 14:30[:05] or 2026-11-03T14:30:05[Z|+01:00]
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?)?\s*(am|pm)?$/i.exec(s);
  if (m) {
    let hh = m[4] ? +m[4] : 0;
    const mm = m[5] ? +m[5] : 0;
    const ss = m[6] ? +m[6] : 0;
    if (m[8]) hh = to24(hh, m[8]);
    if (m[7]) {
      const t = Date.parse(s);
      return Number.isNaN(t) ? null : t;
    }
    return validLocal(+m[1], +m[2], +m[3], hh, mm, ss);
  }
  // 11/03/2026 2:30 PM, 03.11.2026 14:30
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i.exec(s);
  if (m) {
    let year = +m[3];
    if (year < 100) year += 2000;
    const [a, b] = [+m[1], +m[2]];
    const [month, day] = order === 'mdy' ? [a, b] : [b, a];
    let hh = m[4] ? +m[4] : 0;
    if (m[7]) hh = to24(hh, m[7]);
    return validLocal(year, month, day, hh, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0);
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function to24(h: number, ap: string): number {
  const pm = ap.toLowerCase() === 'pm';
  if (h === 12) return pm ? 12 : 0;
  return pm ? h + 12 : h;
}

function validLocal(y: number, mo: number, d: number, h: number, mi: number, s: number): number | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const dt = new Date(y, mo - 1, d, h, mi, s);
  if (dt.getMonth() !== mo - 1) return null;
  return dt.getTime();
}

/** "1:30" (h:mm), "01:30:15", "90", "1h 30m", "45 min", "1.5 h" -> ms */
export function parseDuration(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  let m = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) return ((+m[1] * 60 + +m[2]) * 60 + (m[3] ? +m[3] : 0)) * 1000;
  m = /^(\d+(?:[.,]\d+)?)$/.exec(s);
  if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 60_000); // bare number = minutes
  const re = /(\d+(?:[.,]\d+)?)\s*(d|h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/g;
  let total = 0;
  let any = false;
  let x: RegExpExecArray | null;
  while ((x = re.exec(s))) {
    any = true;
    const n = parseFloat(x[1].replace(',', '.'));
    const u = x[2][0];
    total += u === 'd' ? n * 86_400_000 : u === 'h' ? n * 3_600_000 : u === 'm' ? n * 60_000 : n * 1000;
  }
  return any ? Math.round(total) : null;
}

export function parseAmountMl(text: string, defaultUnit: 'ml' | 'oz'): number | undefined {
  const m = /(\d+(?:[.,]\d+)?)\s*(ml|cc|oz|ounces?)?/i.exec(text);
  if (!m) return undefined;
  const n = parseFloat(m[1].replace(',', '.'));
  if (!(n > 0)) return undefined;
  const unit = m[2] ? (/oz|ounce/i.test(m[2]) ? 'oz' : 'ml') : defaultUnit;
  return Math.round(unit === 'oz' ? n * OZ_ML : n);
}

export function diaperKindFrom(text: string): DiaperKind | undefined {
  const s = text.toLowerCase();
  const pee = /\bpee\b|\bwet\b|urine|\bp\b/.test(s);
  const poo = /\bpoo|poop|dirty|\bbm\b|stool|\bsoiled\b/.test(s);
  if (/\bboth\b|mixed/.test(s) || (pee && poo)) return 'both';
  if (poo) return 'poo';
  if (pee) return 'pee';
  if (/\bdry\b|clean/.test(s)) return 'dry';
  return undefined;
}

function hash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + s.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/* ------------------------------ row -> event ------------------------------ */

export interface ImportResult {
  events: BabyEvent[];
  skipped: { line: number; reason: string }[];
  ignoredTypes: Record<string, number>;
  counts: Record<string, number>;
}

export function buildEvents(
  rows: string[][],
  m: Mapping,
  childId: string,
  opts: { childFilter?: string | null; hasHeader?: boolean } = {},
): ImportResult {
  const out: ImportResult = { events: [], skipped: [], ignoredTypes: {}, counts: {} };
  const data = opts.hasHeader === false ? rows : rows.slice(1);
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const seen = new Set<string>();
  data.forEach((r, idx) => {
    const line = idx + (opts.hasHeader === false ? 1 : 2);
    if (opts.childFilter && cell(r, m.child) !== opts.childFilter) return;
    const rawType = cell(r, m.type);
    const mapped: MappedType = m.type >= 0 ? m.typeMap[rawType] ?? guessType(rawType) : 'sleep';
    if (mapped === 'skip') {
      out.ignoredTypes[rawType || '(blank)'] = (out.ignoredTypes[rawType || '(blank)'] ?? 0) + 1;
      return;
    }
    const start = parseDateTime(cell(r, m.start), m.dateOrder);
    if (start == null) {
      out.skipped.push({ line, reason: `start time not understood: "${cell(r, m.start)}"` });
      return;
    }
    let end: number | null = null;
    const endRaw = cell(r, m.end);
    if (endRaw) end = parseDateTime(endRaw, m.dateOrder);
    const dur = cell(r, m.duration) ? parseDuration(cell(r, m.duration)) : null;
    if (end == null && dur != null) end = start + dur;
    if (end != null && end < start) {
      out.skipped.push({ line, reason: 'end is before start' });
      return;
    }
    const detailText = [rawType, ...m.details.map((i) => cell(r, i))].join(' | ');
    const lower = detailText.toLowerCase();
    const ev: BabyEvent = { id: '', childId, type: 'sleep', start, end };

    if (mapped === 'sleep') {
      if (end == null) {
        out.skipped.push({ line, reason: 'sleep has no end time or duration' });
        return;
      }
      ev.type = 'sleep';
    } else if (mapped === 'diaper') {
      ev.type = 'diaper';
      ev.end = start;
      ev.diaper = diaperKindFrom(detailText) ?? 'pee';
    } else if (mapped === 'pump') {
      ev.type = 'pump';
      ev.end = end ?? start;
      const amt = parseAmountMl(m.details.map((i) => cell(r, i)).join(' '), m.amountUnit);
      if (amt) ev.amountMl = amt;
    } else {
      // feed
      let method: 'breast' | 'bottle' = mapped === 'breast' ? 'breast' : 'bottle';
      if (mapped === 'feed') {
        const amtText = m.details.map((i) => cell(r, i)).join(' ');
        if (/bottle/.test(lower)) method = 'bottle';
        else if (/breast|\bleft\b|\bright\b|nurs/.test(lower)) method = 'breast';
        else method = /\d\s*(ml|oz|cc)/i.test(amtText) ? 'bottle' : 'breast';
      }
      ev.type = 'feed';
      ev.method = method;
      ev.end = end ?? start;
      if (method === 'bottle') {
        const amt = parseAmountMl(m.details.map((i) => cell(r, i)).join(' '), m.amountUnit);
        if (amt) ev.amountMl = amt;
        let content: BottleContent | undefined;
        if (/formula/.test(lower)) content = 'formula';
        else if (/breast ?milk|expressed|pumped/.test(lower)) content = 'breastmilk';
        if (content) ev.content = content;
      } else {
        const d = ev.end - start;
        const left = /\bleft\b/.test(lower);
        const right = /\bright\b/.test(lower);
        if (d > 0 && left && !right) ev.leftMs = d;
        else if (d > 0 && right && !left) ev.rightMs = d;
      }
    }
    const notes = cell(r, m.notes);
    if (notes) ev.notes = notes;
    ev.id = 'imp-' + hash(`${childId}|${ev.type}|${ev.start}|${ev.end}|${ev.method ?? ev.diaper ?? ''}`);
    if (seen.has(ev.id)) {
      out.skipped.push({ line, reason: 'duplicate row' });
      return;
    }
    seen.add(ev.id);
    out.events.push(ev);
    const key = ev.type === 'feed' ? `feed (${ev.method})` : ev.type;
    out.counts[key] = (out.counts[key] ?? 0) + 1;
  });
  return out;
}
