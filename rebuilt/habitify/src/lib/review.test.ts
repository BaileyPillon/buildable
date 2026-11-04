import { describe, expect, it } from 'vitest';
import type { EntryMap, Habit } from '../types';
import { reviewPeriod, summarizeDay, summarizeHabitPeriod } from './review';

const mk = (id: string, over: Partial<Habit> = {}): Habit => ({
  id, name: id, emoji: '', color: '#0f766e', schedule: { type: 'daily' }, timeOfDay: 'anytime', order: 0, archived: false, createdAt: '2026-10-26', ...over,
});
const em = (id: string, spec: Record<string, 'done' | 'skipped'>): EntryMap =>
  Object.fromEntries(Object.entries(spec).map(([d, status]) => [d, { key: `${id}|${d}`, habitId: id, date: d, status, updatedAt: 0 }]));

const TODAY = '2026-11-04'; // Wednesday

describe('review aggregation', () => {
  const a = mk('a');
  const b = mk('b', { order: 1, schedule: { type: 'weekdays', days: [1, 3, 5] } });
  const w = mk('w', { order: 2, schedule: { type: 'weekly', times: 2 } });
  const data: Record<string, EntryMap> = {
    a: em('a', { '2026-11-02': 'done', '2026-11-03': 'done', '2026-11-04': 'done', '2026-11-01': 'skipped' }),
    b: em('b', { '2026-11-02': 'done' }),
    w: em('w', { '2026-11-03': 'done' }),
  };
  const f = (id: string) => data[id] ?? {};

  it('summarises one day across day-based habits and counts every check-in', () => {
    // Mon 11-02: a done, b done (scheduled), w done? no
    expect(summarizeDay([a, b, w], f, '2026-11-02', TODAY)).toEqual({ date: '2026-11-02', possible: 2, done: 2, checkins: 2, rate: 1 });
    // Tue 11-03: a done, b not scheduled, w done (weekly: only a check-in)
    expect(summarizeDay([a, b, w], f, '2026-11-03', TODAY)).toMatchObject({ possible: 1, done: 1, checkins: 2 });
    // Wed 11-04 (today): a done, b pending (not counted yet)
    expect(summarizeDay([a, b, w], f, TODAY, TODAY)).toMatchObject({ possible: 1, done: 1, rate: 1 });
  });

  it('excludes skipped days, archived habits and future days', () => {
    expect(summarizeDay([a], f, '2026-11-01', TODAY)).toMatchObject({ possible: 0, rate: null });
    expect(summarizeDay([{ ...a, archived: true }], f, '2026-11-02', TODAY).possible).toBe(0);
    expect(summarizeDay([a], f, '2026-11-09', TODAY).possible).toBe(0);
  });

  it('prorates weekly habits over the period', () => {
    const p = summarizeHabitPeriod(w, f('w'), '2026-11-02', '2026-11-08', TODAY);
    // only 3 days of the week have happened: round(2*3/7) = 1
    expect(p).toMatchObject({ done: 1, possible: 1, rate: 1 });
  });

  it('reviews a week', () => {
    const r = reviewPeriod([a, b, w], f, '2026-11-02', '2026-11-08', TODAY);
    expect(r.days).toHaveLength(7);
    expect(r.checkins).toBe(5);
    expect(r.perfectDays).toBe(3);
    expect(r.habits.map((h) => h.habit.id)).toContain('w');
    expect(r.rate).toBeLessThanOrEqual(1);
    expect(r.rate).toBeGreaterThan(0.5);
  });
});
