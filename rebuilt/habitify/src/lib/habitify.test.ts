import { describe, expect, it } from 'vitest';
import { parseCSVRecords } from './csv';
import {
  buildHabitifyImport, defaultStatusAction, detectDateOrder, distinctStatuses, guessMapping, parseHabitifyRows, parseLooseDate,
  parseNumber, summarizeHabits, suggestSchedule, type HabitSelection,
} from './habitify';

const CSV = [
  'Habit,Date,Total log,Unit,Status,Habit ID',
  'Drink water,2026-10-01,8,glasses,Completed,A1',
  'Drink water,2026-10-02,8,glasses,Completed,A1',
  'Drink water,2026-10-03,5,glasses,Failed,A1',
  'Drink water,2026-10-04,9,glasses,Completed,A1',
  'Meditate,2026-10-01,,,Completed,B2',
  'Meditate,2026-10-02,,,Skipped,B2',
  'Meditate,2026-10-03,,,Failed,B2',
  '"Read, a lot",2026-10-02,,,Completed,C3',
].join('\n');

describe('Habitify column mapping', () => {
  it('maps the documented export headers', () => {
    const { headers } = parseCSVRecords(CSV);
    expect(guessMapping(headers)).toEqual({ name: 'Habit', date: 'Date', value: 'Total log', unit: 'Unit', status: 'Status', id: 'Habit ID' });
  });
  it('is tolerant of renamed columns', () => {
    expect(guessMapping(['habit name', 'DAY', 'state', 'ID']).name).toBe('habit name');
    expect(guessMapping(['habit name', 'DAY', 'state', 'ID']).date).toBe('DAY');
  });
});

describe('date parsing', () => {
  it('reads ISO dates with or without time and zone as written', () => {
    expect(parseLooseDate('2026-10-27', 'mdy')).toBe('2026-10-27');
    expect(parseLooseDate('2026-10-27 08:30:00', 'mdy')).toBe('2026-10-27');
    expect(parseLooseDate('2026-10-27T23:59:00Z', 'mdy')).toBe('2026-10-27');
  });
  it('uses the chosen order for slash dates', () => {
    expect(parseLooseDate('03/04/2026', 'mdy')).toBe('2026-03-04');
    expect(parseLooseDate('03/04/2026', 'dmy')).toBe('2026-04-03');
    expect(parseLooseDate('27.10.2026', 'dmy')).toBe('2026-10-27');
    expect(parseLooseDate('10/27/26', 'mdy')).toBe('2026-10-27');
  });
  it('reads month names', () => {
    expect(parseLooseDate('Oct 27, 2026', 'mdy')).toBe('2026-10-27');
    expect(parseLooseDate('27 October 2026', 'mdy')).toBe('2026-10-27');
    expect(parseLooseDate('Tue, Oct 27 2026', 'mdy')).toBe('2026-10-27');
  });
  it('rejects nonsense', () => {
    expect(parseLooseDate('', 'ymd')).toBeNull();
    expect(parseLooseDate('2026-02-30', 'ymd')).toBeNull();
    expect(parseLooseDate('13/13/2026', 'dmy')).toBeNull();
    expect(parseLooseDate('soon', 'ymd')).toBeNull();
  });
  it('detects order and flags ambiguity', () => {
    expect(detectDateOrder(['2026-10-27'])).toBe('ymd');
    expect(detectDateOrder(['27/10/2026', '01/02/2026'])).toBe('dmy');
    expect(detectDateOrder(['10/27/2026', '01/02/2026'])).toBe('mdy');
    expect(detectDateOrder(['01/02/2026', '03/04/2026'])).toBe('ambiguous');
  });
  it('parses numbers with decimal commas and thousands separators', () => {
    expect(parseNumber('8')).toBe(8);
    expect(parseNumber('2,5')).toBe(2.5);
    expect(parseNumber('1,250')).toBe(1250);
    expect(parseNumber('n/a')).toBeNull();
  });
});

describe('Habitify import plan', () => {
  const { records, headers } = parseCSVRecords(CSV);
  const mapping = guessMapping(headers);
  const statusMap = Object.fromEntries(distinctStatuses(records, mapping.status).map((s) => [s, defaultStatusAction(s)]));
  const parsed = parseHabitifyRows(records, { mapping, dateOrder: 'ymd', statusMap });

  it('maps Completed/Skipped to done/skipped and Failed to ignore', () => {
    expect(statusMap).toEqual({ Completed: 'done', Failed: 'ignore', Skipped: 'skipped' });
    expect(parsed.rows).toHaveLength(8);
    expect(parsed.badDates).toBe(0);
  });

  it('summarises habits and infers a numeric goal from completed rows', () => {
    const previews = summarizeHabits(parsed.rows);
    const water = previews.find((p) => p.name === 'Drink water')!;
    expect(water).toMatchObject({ unit: 'glasses', goalTarget: 8, done: 3, ignored: 1, first: '2026-10-01', last: '2026-10-04', externalId: 'A1' });
    expect(previews.find((p) => p.name === 'Meditate')).toMatchObject({ done: 1, skipped: 1, goalTarget: undefined });
    expect(previews.find((p) => p.name === 'Read, a lot')).toBeDefined();
  });

  it('builds habits and entries for the selected habits only', () => {
    const previews = summarizeHabits(parsed.rows);
    const sel: Record<string, HabitSelection> = {};
    for (const p of previews) sel[p.groupKey] = { include: p.name !== 'Read, a lot', schedule: p.suggested, goalTarget: p.goalTarget };
    const plan = buildHabitifyImport(parsed.rows, previews, sel, [], 123);
    expect(plan.newHabits.map((h) => h.name).sort()).toEqual(['Drink water', 'Meditate']);
    const water = plan.newHabits.find((h) => h.name === 'Drink water')!;
    expect(water.goal).toEqual({ target: 8, unit: 'glasses' });
    expect(water.externalId).toBe('A1');
    expect(water.createdAt).toBe('2026-10-01');
    const waterEntries = plan.entries.filter((e) => e.habitId === water.id).sort((a, b) => a.date.localeCompare(b.date));
    expect(waterEntries.map((e) => [e.date, e.status, e.value])).toEqual([
      ['2026-10-01', 'done', 8], ['2026-10-02', 'done', 8], ['2026-10-04', 'done', 9],
    ]);
    const med = plan.newHabits.find((h) => h.name === 'Meditate')!;
    expect(plan.entries.filter((e) => e.habitId === med.id).map((e) => e.status).sort()).toEqual(['done', 'skipped']);
  });

  it('merges into an existing habit on re-import instead of duplicating it', () => {
    const previews = summarizeHabits(parsed.rows);
    const first = buildHabitifyImport(parsed.rows, previews, Object.fromEntries(previews.map((p) => [p.groupKey, { include: true, schedule: p.suggested, goalTarget: p.goalTarget }])), []);
    const again = summarizeHabits(parsed.rows, first.newHabits);
    expect(again.every((p) => p.matchedHabitId)).toBe(true);
    const plan = buildHabitifyImport(parsed.rows, again, Object.fromEntries(again.map((p) => [p.groupKey, { include: true, schedule: p.suggested }])), first.newHabits);
    expect(plan.newHabits).toHaveLength(0);
    expect(new Set(plan.entries.map((e) => e.key))).toEqual(new Set(first.entries.map((e) => e.key)));
  });

  it('counts unparseable dates instead of failing', () => {
    const bad = parseHabitifyRows([{ Habit: 'X', Date: 'whenever', Status: 'Completed' }], { mapping, dateOrder: 'ymd', statusMap });
    expect(bad).toEqual({ rows: [], badDates: 1, missingNames: 0 });
  });
});

describe('schedule suggestion', () => {
  it('keeps daily when failures exist or the history is dense', () => {
    expect(suggestSchedule(['2026-10-01'], false)).toEqual({ type: 'daily' });
    const dense = Array.from({ length: 30 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
    expect(suggestSchedule(dense, false)).toEqual({ type: 'daily' });
    expect(suggestSchedule(['2026-10-01', '2026-10-09', '2026-10-17', '2026-10-25', '2026-11-02', '2026-11-10'], true)).toEqual({ type: 'daily' });
  });
  it('suggests N per week for sparse histories with no recorded failures', () => {
    // Mon+Thu each week for 5 weeks
    const dates = ['10-05', '10-08', '10-12', '10-15', '10-19', '10-22', '10-26', '10-29', '11-02', '11-05'].map((d) => `2026-${d}`);
    expect(suggestSchedule(dates, false)).toEqual({ type: 'weekly', times: 2 });
  });
});
