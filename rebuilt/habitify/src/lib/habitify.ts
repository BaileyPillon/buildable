/*
 * Habitify CSV importer.
 *
 * What Habitify offers (Settings > Import / Export, per its help center): a CSV check-in log and a
 * full .sqlite backup. Its CSV has the columns
 *     Habit, Date, Total log, Unit, Status, Habit ID
 * with Status one of Completed / Skipped / Failed. The date format is not documented, so the importer
 * detects it, shows a preview, and lets the user confirm or override the column mapping, date order and
 * status mapping before anything is written. Habitify's CSV carries no schedule, so imported habits are
 * created as daily unless the user changes them (a weekly suggestion is made for sparse histories).
 */
import type { DateKey, Entry, Habit, Schedule } from '../types';
import { dayNum, isValidKey, pad, startOfWeek } from './dates';
import { entryKey } from './checkin';
import { PALETTE, newId } from './palette';

export interface HabitifyMapping {
  name: string;
  date: string;
  value: string;
  unit: string;
  status: string;
  id: string;
}

export const HABITIFY_FIELDS: { key: keyof HabitifyMapping; label: string; expected: string; required: boolean }[] = [
  { key: 'name', label: 'Habit name', expected: 'Habit', required: true },
  { key: 'date', label: 'Date', expected: 'Date', required: true },
  { key: 'status', label: 'Status', expected: 'Status', required: true },
  { key: 'value', label: 'Logged value', expected: 'Total log', required: false },
  { key: 'unit', label: 'Unit', expected: 'Unit', required: false },
  { key: 'id', label: 'Habit ID', expected: 'Habit ID', required: false },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function guessMapping(headers: string[]): HabitifyMapping {
  const find = (...alts: string[]) => headers.find((h) => alts.includes(norm(h))) ?? '';
  return {
    name: find('habit', 'habitname', 'name'),
    date: find('date', 'day', 'logdate'),
    value: find('totallog', 'log', 'value', 'amount', 'total'),
    unit: find('unit', 'units'),
    status: find('status', 'state', 'result'),
    id: find('habitid', 'id', 'uuid'),
  };
}

/* ----------------------------------------------------------------- dates */

export type DateOrder = 'ymd' | 'dmy' | 'mdy';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function build(y: number, m: number, d: number): DateKey | null {
  if (y < 1970 || y > 2100) return null;
  const k = `${y}-${pad(m)}-${pad(d)}`;
  return isValidKey(k) ? k : null;
}

/** Splits "27/10/2025", "2025-10-27 08:30", "10.27.25" ... into numeric parts. */
function numericParts(s: string): number[] | null {
  const m = /^\s*(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})(?:[T\s,].*)?$/.exec(s);
  return m ? [+m[1]!, +m[2]!, +m[3]!] : null;
}

/** Returns the unambiguous order, or "ambiguous" when day and month could both be swapped. */
export function detectDateOrder(samples: string[]): DateOrder | 'ambiguous' {
  let sawDmy = false, sawMdy = false;
  for (const s of samples) {
    const p = numericParts(s);
    if (!p) continue;
    const raw = /^\s*(\d{1,4})/.exec(s)![1]!;
    if (raw.length === 4) return 'ymd';
    if (p[0]! > 12) sawDmy = true;
    else if (p[1]! > 12) sawMdy = true;
  }
  if (sawDmy && !sawMdy) return 'dmy';
  if (sawMdy && !sawDmy) return 'mdy';
  return 'ambiguous';
}

/** Parses a loose date string to YYYY-MM-DD (the date as written, no timezone conversion). */
export function parseLooseDate(input: string, order: DateOrder): DateKey | null {
  const s = input.trim();
  if (!s) return null;
  const p = numericParts(s);
  if (p) {
    const first = /^\s*(\d{1,4})/.exec(s)![1]!;
    if (first.length === 4) return build(p[0]!, p[1]!, p[2]!);
    let y = p[2]!;
    if (y < 100) y += 2000;
    return order === 'dmy' ? build(y, p[1]!, p[0]!) : build(y, p[0]!, p[1]!);
  }
  // "Oct 27, 2025", "27 October 2025", "October 27 2025"
  const named = /^(?:[A-Za-z]{3,9},?\s+)?(?:(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9}),?\s+(\d{4})|([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4}))/.exec(s);
  if (named) {
    const monthName = (named[2] ?? named[4])!.slice(0, 3).toLowerCase();
    const mi = MONTHS.indexOf(monthName);
    if (mi < 0) return null;
    return build(+(named[3] ?? named[6])!, mi + 1, +(named[1] ?? named[5])!);
  }
  return null;
}

/* --------------------------------------------------------------- numbers */

export function parseNumber(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  let u = t;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) u = t.replace(/,/g, ''); // "1,250" is thousands
  else if (/^-?\d+([.,]\d+)?$/.test(t)) u = t.replace(',', '.'); // "2,5" is a decimal comma
  else return null;
  const n = Number(u);
  return Number.isFinite(n) ? n : null;
}

/* --------------------------------------------------------------- statuses */

export type StatusAction = 'done' | 'skipped' | 'ignore';

export function defaultStatusAction(value: string): StatusAction {
  const v = value.trim().toLowerCase();
  if (['completed', 'complete', 'done', 'success', 'checked', 'yes'].includes(v)) return 'done';
  if (['skipped', 'skip'].includes(v)) return 'skipped';
  return 'ignore'; // Failed / missed / empty: a miss is simply the absence of a check-in
}

export function distinctStatuses(records: Record<string, string>[], statusCol: string): string[] {
  const set = new Set<string>();
  for (const r of records) set.add((r[statusCol] ?? '').trim());
  return [...set].sort();
}

/* ------------------------------------------------------------------ rows */

export interface ParseOptions {
  mapping: HabitifyMapping;
  dateOrder: DateOrder;
  statusMap: Record<string, StatusAction>;
}

export interface ParsedRow {
  groupKey: string; // external id when present, else the lower-cased name
  name: string;
  externalId?: string;
  unit: string;
  date: DateKey;
  action: StatusAction;
  value?: number;
}

export interface ParseResult {
  rows: ParsedRow[];
  badDates: number;
  missingNames: number;
}

export function parseHabitifyRows(records: Record<string, string>[], opts: ParseOptions): ParseResult {
  const { mapping: m } = opts;
  const rows: ParsedRow[] = [];
  let badDates = 0, missingNames = 0;
  for (const r of records) {
    const name = (r[m.name] ?? '').trim();
    if (!name) {
      missingNames++;
      continue;
    }
    const date = parseLooseDate(r[m.date] ?? '', opts.dateOrder);
    if (!date) {
      badDates++;
      continue;
    }
    const externalId = m.id ? (r[m.id] ?? '').trim() : '';
    const rawStatus = (r[m.status] ?? '').trim();
    const action = opts.statusMap[rawStatus] ?? defaultStatusAction(rawStatus);
    const value = m.value ? parseNumber(r[m.value] ?? '') : null;
    rows.push({
      groupKey: externalId || name.toLowerCase(),
      name,
      externalId: externalId || undefined,
      unit: m.unit ? (r[m.unit] ?? '').trim() : '',
      date,
      action,
      value: value !== null && value > 0 ? value : undefined,
    });
  }
  return { rows, badDates, missingNames };
}

/* ---------------------------------------------------------------- habits */

export interface HabitPreview {
  groupKey: string;
  name: string;
  externalId?: string;
  unit: string;
  goalTarget?: number;
  rows: number;
  done: number;
  skipped: number;
  ignored: number;
  first: DateKey;
  last: DateKey;
  suggested: Schedule;
  matchedHabitId?: string; // already in this app (same external id or name)
}

function mode(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0]!, bestN = 0;
  for (const [v, n] of counts) if (n > bestN || (n === bestN && v < best)) { best = v; bestN = n; }
  return best;
}

/** Suggest weekly when nothing was ever marked failed and check-ins are sparse; else daily. */
export function suggestSchedule(doneDates: DateKey[], hadFailures: boolean, weekStart: 0 | 1 = 1): Schedule {
  if (doneDates.length < 6 || hadFailures) return { type: 'daily' };
  const sorted = [...doneDates].sort();
  const span = dayNum(sorted[sorted.length - 1]!) - dayNum(sorted[0]!) + 1;
  if (span < 21 || doneDates.length / span >= 0.55) return { type: 'daily' };
  const weeks = new Set(sorted.map((d) => startOfWeek(d, weekStart))).size;
  const perWeek = Math.round(doneDates.length / Math.max(1, weeks));
  return { type: 'weekly', times: Math.min(7, Math.max(1, perWeek)) };
}

export function summarizeHabits(rows: ParsedRow[], existing: Habit[] = []): HabitPreview[] {
  const groups = new Map<string, ParsedRow[]>();
  for (const r of rows) {
    const g = groups.get(r.groupKey);
    if (g) g.push(r);
    else groups.set(r.groupKey, [r]);
  }
  const out: HabitPreview[] = [];
  for (const [groupKey, list] of groups) {
    const first = list[0]!;
    const dates = list.map((r) => r.date).sort();
    const doneRows = list.filter((r) => r.action === 'done');
    const unit = list.find((r) => r.unit)?.unit ?? '';
    const values = doneRows.map((r) => r.value).filter((v): v is number => v !== undefined);
    const hadFailures = list.some((r) => r.action === 'ignore');
    const match = existing.find((h) => (first.externalId && h.externalId === first.externalId) || h.name.toLowerCase() === first.name.toLowerCase());
    out.push({
      groupKey,
      name: first.name,
      externalId: first.externalId,
      unit,
      goalTarget: unit && values.length > 0 ? mode(values) : undefined,
      rows: list.length,
      done: new Set(doneRows.map((r) => r.date)).size,
      skipped: list.filter((r) => r.action === 'skipped').length,
      ignored: list.filter((r) => r.action === 'ignore').length,
      first: dates[0]!,
      last: dates[dates.length - 1]!,
      suggested: suggestSchedule([...new Set(doneRows.map((r) => r.date))], hadFailures),
      matchedHabitId: match?.id,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface HabitSelection {
  include: boolean;
  schedule: Schedule;
  goalTarget?: number;
}

export interface ImportPlan {
  newHabits: Habit[];
  entries: Entry[];
}

const RANK: Record<StatusAction, number> = { ignore: 0, skipped: 1, done: 2 };

export function buildHabitifyImport(
  rows: ParsedRow[],
  previews: HabitPreview[],
  selections: Record<string, HabitSelection>,
  existing: Habit[],
  now: number = Date.now(),
): ImportPlan {
  const newHabits: Habit[] = [];
  const idByGroup = new Map<string, string>();
  let order = existing.reduce((m, h) => Math.max(m, h.order), -1) + 1;
  for (const p of previews) {
    const sel = selections[p.groupKey];
    if (!sel?.include) continue;
    if (p.matchedHabitId) {
      idByGroup.set(p.groupKey, p.matchedHabitId);
      continue;
    }
    const h: Habit = {
      id: newId(),
      name: p.name,
      emoji: '',
      color: PALETTE[newHabits.length % PALETTE.length]!,
      schedule: sel.schedule,
      timeOfDay: 'anytime',
      order: order++,
      archived: false,
      createdAt: p.first,
    };
    if (sel.goalTarget && sel.goalTarget > 0) h.goal = { target: sel.goalTarget, unit: p.unit };
    if (p.externalId) h.externalId = p.externalId;
    newHabits.push(h);
    idByGroup.set(p.groupKey, h.id);
  }

  // one entry per habit per day; the strongest status wins (done > skipped > ignored)
  const best = new Map<string, ParsedRow>();
  for (const r of rows) {
    const habitId = idByGroup.get(r.groupKey);
    if (!habitId || r.action === 'ignore') continue;
    const key = entryKey(habitId, r.date);
    const prev = best.get(key);
    if (!prev || RANK[r.action] > RANK[prev.action] || (RANK[r.action] === RANK[prev.action] && (r.value ?? 0) > (prev.value ?? 0))) {
      best.set(key, r);
    }
  }
  const goals = new Map(newHabits.map((h) => [h.id, h.goal]));
  const entries: Entry[] = [];
  for (const [key, r] of best) {
    const habitId = idByGroup.get(r.groupKey)!;
    const e: Entry = { key, habitId, date: r.date, status: r.action === 'done' ? 'done' : 'skipped', updatedAt: now };
    if (r.action === 'done' && r.value !== undefined && (goals.get(habitId) || existing.find((h) => h.id === habitId)?.goal)) e.value = r.value;
    entries.push(e);
  }
  return { newHabits, entries };
}

