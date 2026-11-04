import type { AppSettings, BabyEvent, BackupFile, Child, EventType } from './types';
import { DEFAULT_SETTINGS } from './types';
import { toCsv } from './csv';

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO-8601 in local time with explicit offset, e.g. 2026-11-03T09:05:00-05:00 */
export function toIsoLocal(ms: number): string {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`
  );
}

/* ----------------------------- JSON backup ----------------------------- */

export function makeBackup(children: Child[], events: BabyEvent[], settings: AppSettings, now = Date.now()): BackupFile {
  return { app: 'nestlog', version: 1, exportedAt: new Date(now).toISOString(), settings, children, events };
}

const EVENT_TYPES: EventType[] = ['sleep', 'feed', 'diaper', 'pump'];
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

export function sanitizeEvent(raw: unknown): BabyEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (!isStr(e.id) || !isStr(e.childId) || !EVENT_TYPES.includes(e.type as EventType) || !isNum(e.start)) return null;
  const out: BabyEvent = {
    id: e.id,
    childId: e.childId,
    type: e.type as EventType,
    start: e.start,
    end: isNum(e.end) ? e.end : null,
  };
  if (isStr(e.notes) && e.notes) out.notes = e.notes;
  if (e.method === 'breast' || e.method === 'bottle') out.method = e.method;
  if (isNum(e.leftMs)) out.leftMs = e.leftMs;
  if (isNum(e.rightMs)) out.rightMs = e.rightMs;
  if (e.activeSide === 'left' || e.activeSide === 'right') out.activeSide = e.activeSide;
  if (isNum(e.sideSince)) out.sideSince = e.sideSince;
  if (e.content === 'breastmilk' || e.content === 'formula' || e.content === 'other') out.content = e.content;
  if (isNum(e.amountMl)) out.amountMl = e.amountMl;
  if (e.diaper === 'pee' || e.diaper === 'poo' || e.diaper === 'both' || e.diaper === 'dry') out.diaper = e.diaper;
  return out;
}

export function sanitizeChild(raw: unknown): Child | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (!isStr(c.id) || !isStr(c.name) || !isStr(c.birthdate)) return null;
  const child: Child = { id: c.id, name: c.name, birthdate: c.birthdate, createdAt: isNum(c.createdAt) ? c.createdAt : Date.now() };
  if (Array.isArray(c.wakeBands)) {
    const bands = c.wakeBands.filter(
      (b): b is { fromWeeks: number; toWeeks: number; minMin: number; maxMin: number } =>
        !!b && isNum(b.fromWeeks) && isNum(b.toWeeks) && isNum(b.minMin) && isNum(b.maxMin),
    );
    if (bands.length) child.wakeBands = bands;
  }
  return child;
}

export type ParsedBackup = { ok: true; children: Child[]; events: BabyEvent[]; settings: AppSettings; skipped: number } | { ok: false; error: string };

export function parseBackup(text: string): ParsedBackup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  const d = data as Partial<BackupFile> | null;
  if (!d || d.app !== 'nestlog' || !Array.isArray(d.children) || !Array.isArray(d.events)) {
    return { ok: false, error: 'This does not look like a Nestlog backup (missing app/children/events).' };
  }
  const children = d.children.map(sanitizeChild).filter((c): c is Child => c !== null);
  const events = d.events.map(sanitizeEvent).filter((e): e is BabyEvent => e !== null);
  const s = (d.settings ?? {}) as Partial<AppSettings>;
  const settings: AppSettings = {
    units: s.units === 'oz' ? 'oz' : 'ml',
    themeMode: s.themeMode === 'day' || s.themeMode === 'night' ? s.themeMode : DEFAULT_SETTINGS.themeMode,
    selectedChildId: isStr(s.selectedChildId) ? s.selectedChildId : null,
  };
  return { ok: true, children, events, settings, skipped: d.events.length - events.length };
}

/** Merge by id: incoming rows win. Events pointing at an unknown child are dropped. */
export function mergeData(
  cur: { children: Child[]; events: BabyEvent[] },
  inc: { children: Child[]; events: BabyEvent[] },
): { children: Child[]; events: BabyEvent[]; addedEvents: number; updatedEvents: number; dropped: number } {
  const children = new Map(cur.children.map((c) => [c.id, c]));
  for (const c of inc.children) children.set(c.id, c);
  const events = new Map(cur.events.map((e) => [e.id, e]));
  let added = 0;
  let updated = 0;
  let dropped = 0;
  for (const e of inc.events) {
    if (!children.has(e.childId)) {
      dropped++;
      continue;
    }
    if (events.has(e.id)) updated++;
    else added++;
    events.set(e.id, e);
  }
  return { children: [...children.values()], events: [...events.values()], addedEvents: added, updatedEvents: updated, dropped };
}

/* ----------------------------- CSV export / import ----------------------------- */

export const CSV_HEADER = ['child', 'type', 'start', 'end', 'duration_min', 'method', 'diaper', 'left_min', 'right_min', 'amount_ml', 'content', 'notes', 'id'];

const mins = (ms: number | undefined) => (ms == null ? '' : Math.round((ms / 60000) * 100) / 100);

export function eventsToCsv(events: BabyEvent[], children: Child[]): string {
  const names = new Map(children.map((c) => [c.id, c.name]));
  const rows: (string | number | null)[][] = [CSV_HEADER];
  for (const e of [...events].sort((a, b) => a.start - b.start)) {
    rows.push([
      names.get(e.childId) ?? e.childId,
      e.type,
      toIsoLocal(e.start),
      e.end == null ? '' : toIsoLocal(e.end),
      e.end == null ? '' : mins(e.end - e.start),
      e.method ?? '',
      e.diaper ?? '',
      mins(e.leftMs),
      mins(e.rightMs),
      e.amountMl ?? '',
      e.content ?? '',
      e.notes ?? '',
      e.id,
    ]);
  }
  return toCsv(rows);
}

export function isNativeCsvHeader(header: string[]): boolean {
  const h = header.map((x) => x.trim().toLowerCase());
  return ['type', 'start', 'end', 'method', 'diaper', 'amount_ml'].every((k) => h.includes(k));
}

export interface NativeCsvResult {
  events: BabyEvent[];
  skipped: { line: number; reason: string }[];
  childNames: string[];
}

/** Round-trips the app's own CSV. `childFilter` limits rows to one child name; all rows go to `childId`. */
export function importNativeCsv(rows: string[][], childId: string, childFilter: string | null = null): NativeCsvResult {
  const header = rows[0].map((x) => x.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const get = (r: string[], name: string) => (col(name) >= 0 ? (r[col(name)] ?? '').trim() : '');
  const events: BabyEvent[] = [];
  const skipped: { line: number; reason: string }[] = [];
  const names = new Set<string>();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const child = get(r, 'child');
    if (child) names.add(child);
    if (childFilter && child !== childFilter) return;
    const type = get(r, 'type') as EventType;
    const start = Date.parse(get(r, 'start'));
    if (!EVENT_TYPES.includes(type) || Number.isNaN(start)) {
      skipped.push({ line, reason: 'bad type or start time' });
      return;
    }
    const endRaw = get(r, 'end');
    const end = endRaw ? Date.parse(endRaw) : null;
    const num = (name: string) => {
      const v = get(r, name);
      return v === '' || Number.isNaN(Number(v)) ? undefined : Number(v);
    };
    const ev: BabyEvent = { id: get(r, 'id') || uid(), childId, type, start, end: end != null && !Number.isNaN(end) ? end : null };
    const method = get(r, 'method');
    if (method === 'breast' || method === 'bottle') ev.method = method;
    const diaper = get(r, 'diaper');
    if (diaper === 'pee' || diaper === 'poo' || diaper === 'both' || diaper === 'dry') ev.diaper = diaper;
    const l = num('left_min');
    const rt = num('right_min');
    if (l != null) ev.leftMs = Math.round(l * 60000);
    if (rt != null) ev.rightMs = Math.round(rt * 60000);
    const amt = num('amount_ml');
    if (amt != null) ev.amountMl = amt;
    const content = get(r, 'content');
    if (content === 'breastmilk' || content === 'formula' || content === 'other') ev.content = content;
    const notes = get(r, 'notes').replace(/^'([=+\-@])/, '$1');
    if (notes) ev.notes = notes;
    events.push(ev);
  });
  return { events, skipped, childNames: [...names] };
}

/* ----------------------------- downloads ----------------------------- */

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadText(filename: string, text: string, mime: string): void {
  downloadBlob(filename, new Blob([text], { type: mime + ';charset=utf-8' }));
}
