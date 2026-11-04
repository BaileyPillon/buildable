import type { DateKey, EntryMap, Habit } from '../types';
import { addDays, dayNum, eachDay } from './dates';
import { dayOutcome, firstDate } from './streaks';

/*
 * Review aggregation (pure). Archived habits are excluded: the app does not record when a habit was
 * archived, so counting them would charge them for every day since.
 *  - Day-based habits: a day is "possible" when scheduled, not skipped, and (for today) already done.
 *  - Weekly (N per week) habits: possible = round(N * days in range / 7), at least 1; done = check-ins.
 */

export type EntriesFor = (habitId: string) => EntryMap;

export interface DaySummary {
  date: DateKey;
  possible: number;
  done: number;
  checkins: number; // every done entry that day, including weekly habits and unscheduled days
  rate: number | null;
}

export function summarizeDay(habits: Habit[], entriesFor: EntriesFor, date: DateKey, today: DateKey): DaySummary {
  let possible = 0, done = 0, checkins = 0;
  if (date <= today) {
    for (const h of habits) {
      if (h.archived) continue;
      const entries = entriesFor(h.id);
      if (entries[date]?.status === 'done') checkins++;
      if (h.schedule.type === 'weekly' || date < firstDate(h, entries)) continue;
      const o = dayOutcome(h, entries, date, today);
      if (o === 'done') {
        done++;
        possible++;
      } else if (o === 'missed') {
        possible++;
      }
    }
  }
  return { date, possible, done, checkins, rate: possible > 0 ? done / possible : null };
}

export interface HabitPeriod {
  habit: Habit;
  done: number;
  possible: number;
  skipped: number;
  rate: number | null;
}

export function summarizeHabitPeriod(habit: Habit, entries: EntryMap, from: DateKey, to: DateKey, today: DateKey): HabitPeriod {
  const start = firstDate(habit, entries);
  const a = from > start ? from : start;
  const b = to < today ? to : today;
  const out: HabitPeriod = { habit, done: 0, possible: 0, skipped: 0, rate: null };
  if (a > b) return out;
  if (habit.schedule.type === 'weekly') {
    const days = dayNum(b) - dayNum(a) + 1;
    for (const d of eachDay(a, b)) {
      const st = entries[d]?.status;
      if (st === 'done') out.done++;
      else if (st === 'skipped') out.skipped++;
    }
    out.possible = Math.max(1, Math.round((habit.schedule.times * days) / 7));
    out.rate = Math.min(1, out.done / out.possible);
    return out;
  }
  for (const d of eachDay(a, b)) {
    const o = dayOutcome(habit, entries, d, today);
    if (o === 'done') {
      out.done++;
      out.possible++;
    } else if (o === 'missed') out.possible++;
    else if (o === 'skipped') out.skipped++;
  }
  out.rate = out.possible > 0 ? out.done / out.possible : null;
  return out;
}

export interface PeriodReview {
  from: DateKey;
  to: DateKey;
  days: DaySummary[];
  habits: HabitPeriod[];
  checkins: number;
  done: number;
  possible: number;
  rate: number | null;
  perfectDays: number;
  bestDay?: DaySummary;
}

export function reviewPeriod(habits: Habit[], entriesFor: EntriesFor, from: DateKey, to: DateKey, today: DateKey): PeriodReview {
  const days = eachDay(from, to).map((d) => summarizeDay(habits, entriesFor, d, today));
  const active = habits.filter((h) => !h.archived);
  const per = active
    .map((h) => summarizeHabitPeriod(h, entriesFor(h.id), from, to, today))
    .filter((p) => p.possible > 0 || p.done > 0);
  const done = per.reduce((s, p) => s + p.done, 0);
  const possible = per.reduce((s, p) => s + p.possible, 0);
  const measured = days.filter((d) => d.rate !== null);
  const bestDay = measured.reduce<DaySummary | undefined>((best, d) => (!best || d.rate! > best.rate! ? d : best), undefined);
  return {
    from,
    to,
    days,
    habits: per.sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.habit.order - b.habit.order),
    checkins: days.reduce((s, d) => s + d.checkins, 0),
    done,
    possible,
    rate: possible > 0 ? Math.min(1, done / possible) : null,
    perfectDays: measured.filter((d) => d.rate === 1).length,
    bestDay,
  };
}

export const previousRange = (from: DateKey, to: DateKey): { from: DateKey; to: DateKey } => {
  const len = dayNum(to) - dayNum(from) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
};
