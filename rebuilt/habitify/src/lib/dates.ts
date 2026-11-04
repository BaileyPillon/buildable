import type { DateKey } from '../types';

// All date math is done on integer day numbers derived from UTC midnight, so
// DST changes never shift a calendar day. Keys are *local* calendar dates.
const DAY_MS = 86_400_000;

export const pad = (n: number) => String(n).padStart(2, '0');

export function toKey(d: Date): DateKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayKey(now: Date = new Date()): DateKey {
  return toKey(now);
}

export function parseKey(key: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const y = +m[1]!, mo = +m[2]!, d = +m[3]!;
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

export const isValidKey = (key: unknown): key is DateKey => typeof key === 'string' && parseKey(key) !== null;

export function dayNum(key: DateKey): number {
  const p = parseKey(key);
  if (!p) throw new Error(`Invalid date key: ${key}`);
  return Math.round(Date.UTC(p.y, p.m - 1, p.d) / DAY_MS);
}

export function fromDayNum(n: number): DateKey {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export const addDays = (key: DateKey, n: number): DateKey => fromDayNum(dayNum(key) + n);

/** 0 = Sunday .. 6 = Saturday */
export const weekday = (key: DateKey): number => new Date(dayNum(key) * DAY_MS).getUTCDay();

export function startOfWeek(key: DateKey, weekStart: 0 | 1): DateKey {
  return addDays(key, -((weekday(key) - weekStart + 7) % 7));
}

export const daysBetween = (a: DateKey, b: DateKey): number => dayNum(b) - dayNum(a);

export const startOfMonth = (key: DateKey): DateKey => key.slice(0, 8) + '01';

export function endOfMonth(key: DateKey): DateKey {
  const y = +key.slice(0, 4), m = +key.slice(5, 7);
  return fromDayNum(Math.round(Date.UTC(y, m, 1) / DAY_MS) - 1);
}

/** First day of the month that is `n` months from the month of `key`. */
export function addMonths(key: DateKey, n: number): DateKey {
  const y = +key.slice(0, 4), m = +key.slice(5, 7);
  const t = m - 1 + n;
  const yy = y + Math.floor(t / 12);
  const mm = ((t % 12) + 12) % 12;
  return `${yy}-${pad(mm + 1)}-01`;
}

export function eachDay(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];
  for (let n = dayNum(from), end = dayNum(to); n <= end; n++) out.push(fromDayNum(n));
  return out;
}

export function formatDate(key: DateKey, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: 'UTC' }).format(new Date(dayNum(key) * DAY_MS));
}

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
export function parseTime(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = +m[1]!, mi = +m[2]!;
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}
