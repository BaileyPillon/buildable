import { describe, expect, it } from 'vitest';
import type { Entry, Habit } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { increment, setNote, setValue, toggleDone, toggleSkip } from './checkin';
import { guardCell, parseCSV, parseCSVRecords, toCSV, unguardCell } from './csv';
import { addDays, addMonths, daysBetween, endOfMonth, startOfWeek, weekday } from './dates';
import {
  buildExportFile, detectKind, entriesToCSV, habitsToCSV, mergeData, parseEntriesCSV, parseHabitsCSV, parseJsonImport,
} from './exportImport';
import { dueReminders } from './reminders';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1', name: 'Drink water', emoji: '💧', color: '#2563eb', schedule: { type: 'daily' }, timeOfDay: 'morning',
  order: 0, archived: false, createdAt: '2026-10-01', goal: { target: 8, unit: 'glasses' }, ...over,
});
const entry = (over: Partial<Entry> = {}): Entry => ({
  key: 'h1|2026-11-01', habitId: 'h1', date: '2026-11-01', status: 'done', value: 8, updatedAt: 1, ...over,
});

describe('dates', () => {
  it('does day math without DST drift', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(364);
  });
  it('finds weeks and months', () => {
    expect(weekday('2026-11-04')).toBe(3);
    expect(startOfWeek('2026-11-04', 1)).toBe('2026-11-02');
    expect(startOfWeek('2026-11-04', 0)).toBe('2026-11-01');
    expect(startOfWeek('2026-11-01', 1)).toBe('2026-10-26');
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-01');
  });
});

describe('check-in transitions', () => {
  const water = habit();
  const plain = { goal: undefined };

  it('toggles a plain habit done and back', () => {
    const d = toggleDone(plain);
    expect(d).toEqual({ status: 'done' });
    expect(toggleDone(plain, d)).toEqual({ status: 'none' });
  });
  it('jumps a goal habit to its target and clears it again', () => {
    const d = toggleDone(water);
    expect(d).toEqual({ status: 'done', value: 8 });
    expect(toggleDone(water, d)).toEqual({ status: 'none' });
  });
  it('marks done when progress reaches the goal and undone when it drops', () => {
    let d = increment(water, 3);
    expect(d).toEqual({ status: 'none', value: 3 });
    d = setValue(water, 8, d);
    expect(d.status).toBe('done');
    d = increment(water, -1, d);
    expect(d).toEqual({ status: 'none', value: 7 });
  });
  it('skip toggles and progress cancels a skip', () => {
    const s = toggleSkip();
    expect(s.status).toBe('skipped');
    expect(toggleSkip(s).status).toBe('none');
    expect(increment(water, 1, s).status).toBe('none');
  });
  it('keeps notes through status changes and drops empty ones', () => {
    const n = setNote(' felt great ', toggleDone(plain));
    expect(n).toEqual({ status: 'done', note: 'felt great' });
    expect(setNote('', n)).toEqual({ status: 'done' });
  });
});

describe('csv', () => {
  it('round-trips quotes, commas, newlines and unicode', () => {
    const rows = [['a,b', 'say "hi"', 'line1\nline2', 'café ☕']];
    const text = toCSV(['x', 'y', 'z', 'w'], rows);
    expect(parseCSV(text)).toEqual([['x', 'y', 'z', 'w'], ...rows]);
  });
  it('handles BOM, CRLF, semicolons and blank trailing lines', () => {
    const rows = parseCSV('﻿Habit;Date\r\nRun;2026-01-02\r\n\r\n');
    expect(rows).toEqual([['Habit', 'Date'], ['Run', '2026-01-02']]);
  });
  it('guards spreadsheet formulas and restores them', () => {
    expect(guardCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(guardCell('-5 reps')).toBe("'-5 reps");
    expect(guardCell('plain')).toBe('plain');
    expect(unguardCell("'=SUM(A1)")).toBe('=SUM(A1)');
    expect(unguardCell("'quoted")).toBe("'quoted");
  });
  it('parses records by header', () => {
    expect(parseCSVRecords('a,b\n1,2\n3').records).toEqual([{ a: '1', b: '2' }, { a: '3', b: '' }]);
  });
});

describe('export / import', () => {
  const habits = [habit(), habit({ id: 'h2', name: '=evil()', goal: undefined, schedule: { type: 'weekdays', days: [1, 3, 5] }, archived: true, order: 1, reminder: { enabled: true, time: '07:30' } })];
  const entries = [entry(), entry({ key: 'h2|2026-11-02', habitId: 'h2', date: '2026-11-02', status: 'skipped', value: undefined, note: 'sick, "again"' })];

  it('round-trips JSON', () => {
    const file = buildExportFile({ habits, entries, settings: DEFAULT_SETTINGS }, new Date('2026-11-03T00:00:00Z'));
    const parsed = parseJsonImport(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.habits).toEqual(habits);
      expect(parsed.value.entries).toEqual(entries);
    }
  });
  it('rejects foreign or broken JSON', () => {
    expect(parseJsonImport('not json').ok).toBe(false);
    expect(parseJsonImport('{"habits":[]}').ok).toBe(false);
  });
  it('sanitises hostile fields from imported JSON', () => {
    const p = parseJsonImport(JSON.stringify({
      app: 'habit-tracker', habits: [{ id: 'x', name: 'A'.repeat(500), color: 'url(javascript:1)', schedule: { type: 'weekly', times: 99 }, timeOfDay: 'noon', createdAt: 'yesterday' }, { name: '' }],
      entries: [{ habitId: 'x', date: '2026-02-30', status: 'done' }, { habitId: 'nope', date: '2026-01-01', status: 'done' }, { habitId: 'x', date: '2026-01-01', status: 'done', value: -5 }],
    }));
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.value.habits).toHaveLength(1);
      const h = p.value.habits[0]!;
      expect(h.name).toHaveLength(80);
      expect(h.color).toBe('#0f766e');
      expect(h.schedule).toEqual({ type: 'daily' });
      expect(h.timeOfDay).toBe('anytime');
      expect(p.value.entries).toHaveLength(1);
      expect(p.value.entries[0]!.value).toBeUndefined();
    }
  });
  it('round-trips habits and check-ins through CSV', () => {
    const h = parseHabitsCSV(habitsToCSV(habits));
    expect(h.ok && h.value).toEqual(habits);
    const e = parseEntriesCSV(entriesToCSV(habits, entries), habits);
    expect(e.ok).toBe(true);
    if (e.ok) {
      expect(e.value.newHabits).toHaveLength(0);
      expect(e.value.entries.map((x) => ({ ...x, updatedAt: 1 })).sort((a, b) => a.key.localeCompare(b.key))).toEqual(entries);
    }
  });
  it('creates habits from an entries-only CSV and matches by name', () => {
    const csv = 'habit_name,date,status,value,note\nRead,2026-11-01,done,,\nRead,2026-11-02,skipped,,\nnot a date row,xx,done,,\n';
    const r = parseEntriesCSV(csv, []);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.newHabits).toHaveLength(1);
      expect(r.value.newHabits[0]!.createdAt).toBe('2026-11-01');
      expect(r.value.entries).toHaveLength(2);
      expect(r.value.skippedRows).toBe(1);
    }
  });
  it('detects file kinds', () => {
    expect(detectKind('{"app":"habit-tracker"}', 'a.json')).toBe('json');
    expect(detectKind(habitsToCSV(habits))).toBe('habits-csv');
    expect(detectKind(entriesToCSV(habits, entries))).toBe('entries-csv');
    expect(detectKind('Habit,Date,Total log,Unit,Status,Habit ID\n')).toBe('habitify-csv');
    expect(detectKind('foo,bar\n1,2')).toBe('unknown');
  });
  it('merges without losing existing data, and replaces on request', () => {
    const existing = { habits: [habit({ order: 3 })], entries: [entry()], settings: DEFAULT_SETTINGS };
    const incoming = { habits: [habit({ id: 'h9', name: 'New', order: 0 })], entries: [entry({ key: 'h9|2026-11-01', habitId: 'h9' })] };
    const merged = mergeData(existing, incoming, 'merge');
    expect(merged.habits.map((h) => h.id).sort()).toEqual(['h1', 'h9']);
    expect(merged.habits.find((h) => h.id === 'h9')!.order).toBe(4);
    expect(merged.entries).toHaveLength(2);
    expect(mergeData(existing, incoming, 'replace').habits.map((h) => h.id)).toEqual(['h9']);
  });
});

describe('reminders', () => {
  const at = (h: number, m: number) => new Date(2026, 10, 4, h, m);
  const h = habit({ goal: undefined, reminder: { enabled: true, time: '08:00' } });
  const none = () => ({});

  it('is due once the time passes, until done or fired', () => {
    expect(dueReminders([h], none, at(7, 59), '2026-11-04', 1, new Set())).toHaveLength(0);
    expect(dueReminders([h], none, at(8, 0), '2026-11-04', 1, new Set())).toHaveLength(1);
    expect(dueReminders([h], none, at(8, 5), '2026-11-04', 1, new Set(['h1']))).toHaveLength(0);
    const done = () => ({ '2026-11-04': entry({ date: '2026-11-04', status: 'done' }) });
    expect(dueReminders([h], done, at(9, 0), '2026-11-04', 1, new Set())).toHaveLength(0);
  });
  it('respects the lookback window, weekday schedule and archive', () => {
    expect(dueReminders([h], none, at(12, 0), '2026-11-04', 1, new Set(), 60)).toHaveLength(0);
    const tue = { ...h, schedule: { type: 'weekdays' as const, days: [2] } };
    expect(dueReminders([tue], none, at(9, 0), '2026-11-04', 1, new Set())).toHaveLength(0); // Wednesday
    expect(dueReminders([{ ...h, archived: true }], none, at(9, 0), '2026-11-04', 1, new Set())).toHaveLength(0);
  });
  it('skips weekly habits whose target is already met this week', () => {
    const w = habit({ goal: undefined, schedule: { type: 'weekly', times: 2 }, reminder: { enabled: true, time: '08:00' } });
    const met = () => ({
      '2026-11-02': entry({ date: '2026-11-02', key: 'h1|2026-11-02' }),
      '2026-11-03': entry({ date: '2026-11-03', key: 'h1|2026-11-03' }),
    });
    expect(dueReminders([w], met, at(9, 0), '2026-11-04', 1, new Set())).toHaveLength(0);
    expect(dueReminders([w], none, at(9, 0), '2026-11-04', 1, new Set())).toHaveLength(1);
  });
});
