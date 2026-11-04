import { describe, expect, it } from 'vitest';
import type { EntryMap, EntryStatus, Habit } from '../types';
import { addDays, eachDay } from './dates';
import { cellInfo, completionRate, computeStreaks, totalDone, weekProgress } from './streaks';

// 2026-11-04 is a Wednesday.
const TODAY = '2026-11-04';

const habit = (schedule: Habit['schedule'], createdAt = '2026-10-01'): Pick<Habit, 'schedule' | 'createdAt'> => ({ schedule, createdAt });

function entries(spec: Record<string, EntryStatus>): EntryMap {
  const m: EntryMap = {};
  for (const [date, status] of Object.entries(spec)) {
    m[date] = { key: `h|${date}`, habitId: 'h', date, status, updatedAt: 0 };
  }
  return m;
}

const doneRange = (from: string, to: string, status: EntryStatus = 'done') =>
  Object.fromEntries(eachDay(from, to).map((d) => [d, status]));

describe('daily streaks', () => {
  const daily = habit({ type: 'daily' });

  it('counts consecutive completed days ending today', () => {
    const e = entries(doneRange('2026-11-01', '2026-11-04'));
    expect(computeStreaks(daily, e, TODAY, 1)).toEqual({ current: 4, best: 4, unit: 'day' });
  });

  it('does not break the streak when today is still pending', () => {
    const e = entries(doneRange('2026-11-01', '2026-11-03'));
    expect(computeStreaks(daily, e, TODAY, 1).current).toBe(3);
  });

  it('breaks on a missed past day and keeps the best run', () => {
    const e = entries({ ...doneRange('2026-10-20', '2026-10-26'), ...doneRange('2026-11-02', '2026-11-04') });
    // missed 10-27 .. 11-01
    expect(computeStreaks(daily, e, TODAY, 1)).toEqual({ current: 3, best: 7, unit: 'day' });
  });

  it('resets to zero when yesterday was missed and today is pending', () => {
    const e = entries(doneRange('2026-10-20', '2026-11-02'));
    expect(computeStreaks(daily, e, TODAY, 1).current).toBe(0);
  });

  it('treats a skipped day as neutral (does not break, does not add)', () => {
    const e = entries({ ...doneRange('2026-11-01', '2026-11-01'), '2026-11-02': 'skipped', ...doneRange('2026-11-03', '2026-11-04') });
    expect(computeStreaks(daily, e, TODAY, 1)).toEqual({ current: 3, best: 3, unit: 'day' });
  });

  it('ignores days before the habit existed', () => {
    const young = habit({ type: 'daily' }, '2026-11-03');
    const e = entries(doneRange('2026-11-03', '2026-11-04'));
    expect(computeStreaks(young, e, TODAY, 1).current).toBe(2);
  });

  it('extends history back to an imported check-in older than createdAt', () => {
    const young = habit({ type: 'daily' }, '2026-11-04');
    const e = entries(doneRange('2026-11-01', '2026-11-04'));
    expect(computeStreaks(young, e, TODAY, 1).current).toBe(4);
  });

  it('is zero for a brand new habit with nothing done', () => {
    expect(computeStreaks(habit({ type: 'daily' }, TODAY), {}, TODAY, 1)).toEqual({ current: 0, best: 0, unit: 'day' });
  });

  it('handles a habit created in the future', () => {
    expect(computeStreaks(habit({ type: 'daily' }, '2026-12-01'), {}, TODAY, 1).current).toBe(0);
  });

  it('works across a year boundary and leap day', () => {
    const e = entries(doneRange('2023-12-30', '2024-03-02'));
    const h = habit({ type: 'daily' }, '2023-12-01');
    expect(computeStreaks(h, e, '2024-03-02', 1).current).toBe(64);
  });
});

describe('weekday schedules', () => {
  // Mon, Wed, Fri
  const mwf = habit({ type: 'weekdays', days: [1, 3, 5] });

  it('only counts scheduled days and ignores the gaps between them', () => {
    // 2026-11-02 Mon, 11-04 Wed done; 10-30 Fri, 10-28 Wed done
    const e = entries({ '2026-10-28': 'done', '2026-10-30': 'done', '2026-11-02': 'done', '2026-11-04': 'done' });
    expect(computeStreaks(mwf, e, TODAY, 1)).toEqual({ current: 4, best: 4, unit: 'day' });
  });

  it('breaks when a scheduled day is missed, not when an unscheduled day is empty', () => {
    const e = entries({ '2026-10-28': 'done', '2026-11-02': 'done', '2026-11-04': 'done' }); // missed Fri 10-30
    expect(computeStreaks(mwf, e, TODAY, 1)).toEqual({ current: 2, best: 2, unit: 'day' });
  });

  it('does not credit completions on unscheduled days toward the streak', () => {
    const e = entries({ '2026-11-03': 'done', '2026-11-04': 'done' }); // Tue is unscheduled
    expect(computeStreaks(habit({ type: 'weekdays', days: [1, 3, 5] }, '2026-11-02'), e, TODAY, 1).current).toBe(1);
  });
});

describe('N-times-per-week streaks', () => {
  const x3 = habit({ type: 'weekly', times: 3 }, '2026-10-05');
  // weeks (Mon start): 10-05, 10-12, 10-19, 10-26, 11-02 (current; today Wed 11-04)

  it('counts consecutive weeks that hit the target', () => {
    const e = entries({
      '2026-10-12': 'done', '2026-10-14': 'done', '2026-10-16': 'done',
      '2026-10-19': 'done', '2026-10-21': 'done', '2026-10-23': 'done',
      '2026-10-26': 'done', '2026-10-27': 'done', '2026-10-28': 'done',
    });
    // first week (10-05) is partial/neutral and empty; 3 met weeks after it
    expect(computeStreaks(x3, e, TODAY, 1)).toEqual({ current: 3, best: 3, unit: 'week' });
  });

  it('keeps the streak while the current week is still in progress', () => {
    const e = entries({ '2026-10-26': 'done', '2026-10-27': 'done', '2026-10-28': 'done', '2026-11-02': 'done' });
    expect(computeStreaks(x3, e, TODAY, 1).current).toBe(1);
  });

  it('adds the current week as soon as it is met', () => {
    const e = entries({
      '2026-10-26': 'done', '2026-10-27': 'done', '2026-10-28': 'done',
      '2026-11-02': 'done', '2026-11-03': 'done', '2026-11-04': 'done',
    });
    expect(computeStreaks(x3, e, TODAY, 1).current).toBe(2);
  });

  it('breaks on a short, non-excused week', () => {
    const e = entries({
      '2026-10-12': 'done', '2026-10-13': 'done', '2026-10-14': 'done',
      '2026-10-19': 'done', // short week
      '2026-10-26': 'done', '2026-10-27': 'done', '2026-10-28': 'done',
    });
    expect(computeStreaks(x3, e, TODAY, 1)).toEqual({ current: 1, best: 1, unit: 'week' });
  });

  it('excuses a short week when skips make up the difference', () => {
    const e = entries({
      '2026-10-12': 'done', '2026-10-13': 'done', '2026-10-14': 'done',
      '2026-10-19': 'done', '2026-10-20': 'skipped', '2026-10-21': 'skipped',
      '2026-10-26': 'done', '2026-10-27': 'done', '2026-10-28': 'done',
    });
    expect(computeStreaks(x3, e, TODAY, 1)).toEqual({ current: 2, best: 2, unit: 'week' });
  });

  it('respects Sunday as the first day of the week', () => {
    // Sunday-start weeks: 11-01..11-07 is current, 10-25..10-31 is the previous week
    const e = entries({ '2026-10-25': 'done', '2026-10-26': 'done', '2026-10-27': 'done' });
    expect(computeStreaks(habit({ type: 'weekly', times: 3 }, '2026-10-18'), e, TODAY, 0).current).toBe(1);
  });
});

describe('completion rate', () => {
  const daily = habit({ type: 'daily' }, '2026-10-26');

  it('is done / scheduled days, excluding skips and a pending today', () => {
    // 10-26 .. 11-03 = 9 days: 6 done, 1 skipped, 2 missed; today pending
    const e = entries({
      ...doneRange('2026-10-26', '2026-10-30'), '2026-10-31': 'skipped', '2026-11-02': 'done',
    });
    const r = completionRate(daily, e, TODAY, 1, null);
    expect(r.done).toBe(6);
    expect(r.possible).toBe(8);
    expect(r.rate).toBeCloseTo(0.75);
  });

  it('counts today once it is done', () => {
    const e = entries({ '2026-11-04': 'done' });
    expect(completionRate(habit({ type: 'daily' }, TODAY), e, TODAY, 1, null)).toEqual({ done: 1, possible: 1, rate: 1 });
  });

  it('returns null when there is nothing to measure', () => {
    expect(completionRate(habit({ type: 'daily' }, TODAY), {}, TODAY, 1, null).rate).toBeNull();
  });

  it('limits the window with `from`', () => {
    const e = entries(doneRange('2026-11-01', '2026-11-03'));
    const r = completionRate(habit({ type: 'daily' }, '2026-10-01'), e, TODAY, 1, '2026-11-01');
    expect(r).toEqual({ done: 3, possible: 3, rate: 1 });
  });

  it('measures weekly habits against N per week', () => {
    const x2 = habit({ type: 'weekly', times: 2 }, '2026-10-05');
    const e = entries({ '2026-10-12': 'done', '2026-10-14': 'done', '2026-10-19': 'done', '2026-10-26': 'done', '2026-10-27': 'done', '2026-10-28': 'done' });
    // counted weeks: 10-12 (met 2/2), 10-19 (1/2), 10-26 (met, capped 2/2); first + current weeks excluded unless met
    const r = completionRate(x2, e, TODAY, 1, null);
    expect(r).toEqual({ done: 5, possible: 6, rate: 5 / 6 });
  });
});

describe('helpers', () => {
  it('totalDone counts only done entries', () => {
    expect(totalDone(entries({ '2026-11-01': 'done', '2026-11-02': 'skipped', '2026-11-03': 'done' }))).toBe(2);
  });

  it('weekProgress reports this week toward N', () => {
    const e = entries({ '2026-11-02': 'done', '2026-11-04': 'done', '2026-11-01': 'done' });
    expect(weekProgress(habit({ type: 'weekly', times: 3 }), e, TODAY, TODAY, 1)).toEqual({ done: 2, skipped: 0, target: 3 });
  });

  it('cellInfo distinguishes done, skipped, partial, missed, pending, off and future', () => {
    const h = { ...habit({ type: 'daily' }, '2026-10-30'), goal: { target: 8, unit: 'glasses' } };
    const e = entries({ '2026-10-30': 'done', '2026-10-31': 'skipped' });
    e['2026-11-02'] = { key: 'h|2026-11-02', habitId: 'h', date: '2026-11-02', status: 'none', value: 4, updatedAt: 0 };
    expect(cellInfo(h, e, '2026-10-30', TODAY).state).toBe('done');
    expect(cellInfo(h, e, '2026-10-31', TODAY).state).toBe('skipped');
    expect(cellInfo(h, e, '2026-11-01', TODAY).state).toBe('missed');
    expect(cellInfo(h, e, '2026-11-02', TODAY)).toEqual({ state: 'partial', ratio: 0.5 });
    expect(cellInfo(h, e, TODAY, TODAY).state).toBe('pending');
    expect(cellInfo(h, e, addDays(TODAY, 1), TODAY).state).toBe('future');
    expect(cellInfo(h, e, '2026-10-01', TODAY).state).toBe('off');
  });
});
