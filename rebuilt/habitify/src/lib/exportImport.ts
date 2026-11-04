import type { Entry, EntryStatus, ExportFile, Habit, Schedule, Settings, TimeOfDay } from '../types';
import { DEFAULT_SETTINGS, TIMES_OF_DAY } from '../types';
import { guardCell, parseCSVRecords, toCSV, unguardCell } from './csv';
import { isValidKey, parseTime, todayKey } from './dates';
import { entryKey, isEmptyEntry } from './checkin';
import { PALETTE, isColor, newId } from './palette';

export interface AppData {
  habits: Habit[];
  entries: Entry[];
  settings?: Settings;
}

/* ---------------------------------------------------------------- export */

export function buildExportFile(data: Required<AppData>, now: Date = new Date()): ExportFile {
  return {
    app: 'habit-tracker',
    version: 1,
    exportedAt: now.toISOString(),
    settings: data.settings,
    habits: data.habits,
    entries: data.entries,
  };
}

export const HABITS_CSV_HEADERS = [
  'id', 'name', 'emoji', 'color', 'schedule', 'days', 'times_per_week', 'goal_target', 'goal_unit',
  'time_of_day', 'order', 'archived', 'created_at', 'reminder_time', 'external_id',
];

export function habitsToCSV(habits: Habit[]): string {
  return toCSV(
    HABITS_CSV_HEADERS,
    habits.map((h) => [
      h.id,
      guardCell(h.name),
      h.emoji,
      h.color,
      h.schedule.type,
      h.schedule.type === 'weekdays' ? h.schedule.days.join(' ') : '',
      h.schedule.type === 'weekly' ? h.schedule.times : '',
      h.goal?.target,
      h.goal ? guardCell(h.goal.unit) : '',
      h.timeOfDay,
      h.order,
      h.archived ? 'true' : 'false',
      h.createdAt,
      h.reminder?.enabled ? h.reminder.time : '',
      h.externalId,
    ]),
  );
}

export const ENTRIES_CSV_HEADERS = ['habit_id', 'habit_name', 'date', 'status', 'value', 'note'];

export function entriesToCSV(habits: Habit[], entries: Entry[]): string {
  const names = new Map(habits.map((h) => [h.id, h.name]));
  const sorted = [...entries].sort((a, b) => (a.date === b.date ? a.habitId.localeCompare(b.habitId) : a.date < b.date ? -1 : 1));
  return toCSV(
    ENTRIES_CSV_HEADERS,
    sorted.map((e) => [e.habitId, guardCell(names.get(e.habitId) ?? ''), e.date, e.status, e.value, e.note ? guardCell(e.note) : '']),
  );
}

/* ------------------------------------------------------------ validation */

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function normalizeSchedule(raw: unknown): Schedule {
  if (isObj(raw)) {
    if (raw.type === 'weekdays' && Array.isArray(raw.days)) {
      const days = [...new Set(raw.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
      if (days.length > 0 && days.length < 7) return { type: 'weekdays', days };
    }
    if (raw.type === 'weekly' && typeof raw.times === 'number') {
      const times = Math.round(raw.times);
      if (times >= 1 && times <= 7) return { type: 'weekly', times };
    }
  }
  return { type: 'daily' };
}

export function normalizeHabit(raw: unknown, fallbackOrder = 0): Habit | null {
  if (!isObj(raw)) return null;
  const name = str(raw.name, 80).trim();
  if (!name) return null;
  const h: Habit = {
    id: str(raw.id, 64) || newId(),
    name,
    emoji: str(raw.emoji, 8),
    color: isColor(raw.color) ? raw.color.toLowerCase() : PALETTE[0]!,
    schedule: normalizeSchedule(raw.schedule),
    timeOfDay: TIMES_OF_DAY.includes(raw.timeOfDay as TimeOfDay) ? (raw.timeOfDay as TimeOfDay) : 'anytime',
    order: typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : fallbackOrder,
    archived: raw.archived === true,
    createdAt: isValidKey(raw.createdAt) ? raw.createdAt : todayKey(),
  };
  if (isObj(raw.goal) && typeof raw.goal.target === 'number' && raw.goal.target > 0 && Number.isFinite(raw.goal.target)) {
    h.goal = { target: raw.goal.target, unit: str(raw.goal.unit, 24).trim() };
  }
  if (isObj(raw.reminder) && typeof raw.reminder.time === 'string' && parseTime(raw.reminder.time) !== null) {
    h.reminder = { enabled: raw.reminder.enabled === true, time: raw.reminder.time };
  }
  const ext = str(raw.externalId, 100);
  if (ext) h.externalId = ext;
  return h;
}

export function normalizeEntry(raw: unknown): Entry | null {
  if (!isObj(raw)) return null;
  const habitId = str(raw.habitId, 64);
  if (!habitId || !isValidKey(raw.date)) return null;
  const status: EntryStatus = raw.status === 'done' || raw.status === 'skipped' ? raw.status : 'none';
  const e: Entry = {
    key: entryKey(habitId, raw.date),
    habitId,
    date: raw.date,
    status,
    updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
  };
  if (typeof raw.value === 'number' && Number.isFinite(raw.value) && raw.value > 0) e.value = raw.value;
  const note = str(raw.note, 1000);
  if (note) e.note = note;
  return isEmptyEntry(e) ? null : e;
}

export function normalizeSettings(raw: unknown): Settings {
  const s = { ...DEFAULT_SETTINGS };
  if (isObj(raw)) {
    if (raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'system') s.theme = raw.theme;
    if (raw.weekStart === 0 || raw.weekStart === 1) s.weekStart = raw.weekStart;
  }
  return s;
}

/* --------------------------------------------------------------- parsing */

export type ImportKind = 'json' | 'habits-csv' | 'entries-csv' | 'habitify-csv' | 'unknown';

export function detectKind(text: string, filename = ''): ImportKind {
  const t = text.replace(/^﻿/, '').trimStart();
  if (t.startsWith('{') || filename.toLowerCase().endsWith('.json')) return 'json';
  const { headers } = parseCSVRecords(t.slice(0, 4000).split(/\r?\n/).slice(0, 1).join('\n'));
  const h = headers.map((x) => x.toLowerCase());
  if (h.includes('habit_id') && h.includes('date') && h.includes('status')) return 'entries-csv';
  if (h.includes('id') && h.includes('name') && h.includes('schedule')) return 'habits-csv';
  if (h.includes('habit') && h.includes('date') && h.includes('status')) return 'habitify-csv';
  return 'unknown';
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseJsonImport(text: string): Parsed<AppData> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' };
  }
  if (!isObj(raw) || raw.app !== 'habit-tracker' || !Array.isArray(raw.habits) || !Array.isArray(raw.entries)) {
    return { ok: false, error: 'This JSON is not a Habit Tracker export.' };
  }
  const habits: Habit[] = [];
  const seen = new Set<string>();
  raw.habits.forEach((h, i) => {
    const n = normalizeHabit(h, i);
    if (n && !seen.has(n.id)) {
      seen.add(n.id);
      habits.push(n);
    }
  });
  const entries = new Map<string, Entry>();
  for (const e of raw.entries) {
    const n = normalizeEntry(e);
    if (n && seen.has(n.habitId)) entries.set(n.key, n);
  }
  return { ok: true, value: { habits, entries: [...entries.values()], settings: normalizeSettings(raw.settings) } };
}

const truthy = (s: string | undefined) => /^(true|1|yes)$/i.test((s ?? '').trim());

export function parseHabitsCSV(text: string): Parsed<Habit[]> {
  const { headers, records } = parseCSVRecords(text);
  if (!headers.includes('name')) return { ok: false, error: 'No "name" column found in the habits CSV.' };
  const habits: Habit[] = [];
  records.forEach((r, i) => {
    const type = (r.schedule ?? '').trim().toLowerCase();
    const schedule: unknown =
      type === 'weekdays'
        ? { type, days: (r.days ?? '').split(/[\s,;|]+/).filter(Boolean).map(Number) }
        : type === 'weekly'
          ? { type, times: Number(r.times_per_week) }
          : { type: 'daily' };
    const target = Number(r.goal_target);
    const h = normalizeHabit(
      {
        id: r.id?.trim() || undefined,
        name: unguardCell(r.name ?? ''),
        emoji: r.emoji,
        color: r.color,
        schedule,
        goal: target > 0 ? { target, unit: unguardCell(r.goal_unit ?? '') } : undefined,
        timeOfDay: (r.time_of_day ?? '').trim().toLowerCase(),
        order: r.order !== undefined && r.order !== '' ? Number(r.order) : i,
        archived: truthy(r.archived),
        createdAt: (r.created_at ?? '').trim(),
        reminder: r.reminder_time ? { enabled: true, time: r.reminder_time.trim() } : undefined,
        externalId: r.external_id,
      },
      i,
    );
    if (h) habits.push(h);
  });
  return { ok: true, value: habits };
}

export interface EntriesCSVResult {
  entries: Entry[];
  newHabits: Habit[];
  skippedRows: number;
}

/** Entries CSV. Habits are matched by id, then by name; unknown names become new daily habits. */
export function parseEntriesCSV(text: string, known: Habit[], baseOrder = 0): Parsed<EntriesCSVResult> {
  const { headers, records } = parseCSVRecords(text);
  if (!headers.includes('date') || !headers.includes('status')) {
    return { ok: false, error: 'The check-ins CSV needs "date" and "status" columns.' };
  }
  const byId = new Map(known.map((h) => [h.id, h]));
  const byName = new Map(known.map((h) => [h.name.toLowerCase(), h]));
  const newHabits: Habit[] = [];
  const entries = new Map<string, Entry>();
  let skippedRows = 0;
  for (const r of records) {
    const date = (r.date ?? '').trim();
    const name = unguardCell(r.habit_name ?? '').trim();
    let habit = (r.habit_id && byId.get(r.habit_id.trim())) || (name ? byName.get(name.toLowerCase()) : undefined);
    if (!habit && name && isValidKey(date)) {
      habit = normalizeHabit({ id: r.habit_id?.trim() || undefined, name, order: baseOrder + newHabits.length, createdAt: date }, baseOrder + newHabits.length)!;
      newHabits.push(habit);
      byId.set(habit.id, habit);
      byName.set(name.toLowerCase(), habit);
    }
    if (!habit || !isValidKey(date)) {
      skippedRows++;
      continue;
    }
    const status = (r.status ?? '').trim().toLowerCase();
    const e = normalizeEntry({
      habitId: habit.id,
      date,
      status: status === 'done' || status === 'skipped' ? status : 'none',
      value: r.value === '' || r.value === undefined ? undefined : Number(r.value),
      note: unguardCell(r.note ?? ''),
      updatedAt: Date.now(),
    });
    if (e) entries.set(e.key, e);
    else skippedRows++;
  }
  // a habit created from entries should start no later than its earliest entry
  for (const h of newHabits) {
    for (const e of entries.values()) if (e.habitId === h.id && e.date < h.createdAt) h.createdAt = e.date;
  }
  return { ok: true, value: { entries: [...entries.values()], newHabits, skippedRows } };
}

/* ----------------------------------------------------------------- merge */

export function mergeData(existing: Required<AppData>, incoming: AppData, mode: 'merge' | 'replace'): Required<AppData> {
  if (mode === 'replace') {
    return { habits: incoming.habits, entries: incoming.entries, settings: incoming.settings ?? existing.settings };
  }
  const habits = new Map(existing.habits.map((h) => [h.id, h]));
  let order = existing.habits.reduce((m, h) => Math.max(m, h.order), -1) + 1;
  for (const h of incoming.habits) {
    const prev = habits.get(h.id);
    habits.set(h.id, prev ? { ...h, order: prev.order } : { ...h, order: order++ });
  }
  const entries = new Map(existing.entries.map((e) => [e.key, e]));
  for (const e of incoming.entries) entries.set(e.key, e);
  return { habits: [...habits.values()], entries: [...entries.values()], settings: existing.settings };
}

export function downloadText(filename: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

