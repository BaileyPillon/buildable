import type { DateKey, EntryMap, Habit } from '../types';
import { addDays, eachDay, startOfWeek } from './dates';
import { isScheduledOn } from './schedule';

/*
 * Streak rules (documented because they are the product's core promise):
 *
 * Day-based habits (daily / specific weekdays)
 *   - Only days the habit is scheduled count. Unscheduled days are transparent.
 *   - A completed scheduled day extends the streak.
 *   - A skipped day is neutral: it neither extends nor breaks the streak.
 *   - A scheduled day in the past with no check-in breaks the streak.
 *   - Today without a check-in is still "pending": it never breaks the streak.
 *
 * "N times per week" habits
 *   - The unit is a week (starting on the user's week start).
 *   - A week with >= N completions extends the streak.
 *   - A week where completions + skips >= N (but completions < N) is excused: neutral.
 *   - The current week and the week the habit was created in are neutral until met,
 *     because they are in progress / partial. Any other short week breaks the streak.
 *
 * Both kinds: history starts at the earliest of createdAt and the first check-in.
 */

type HabitLike = Pick<Habit, 'schedule' | 'createdAt'>;
type WeekStart = 0 | 1;

export type DayOutcome = 'done' | 'skipped' | 'missed' | 'pending' | 'off';

export function firstDate(habit: HabitLike, entries: EntryMap): DateKey {
  let min = habit.createdAt;
  for (const k in entries) {
    const e = entries[k]!;
    if (e.status !== 'none' && k < min) min = k;
  }
  return min;
}

/** Outcome of a single scheduled-day habit on `date` (date must be within [start, today]). */
export function dayOutcome(habit: HabitLike, entries: EntryMap, date: DateKey, today: DateKey): DayOutcome {
  if (!isScheduledOn(habit.schedule, date)) return 'off';
  const st = entries[date]?.status;
  if (st === 'done') return 'done';
  if (st === 'skipped') return 'skipped';
  return date === today ? 'pending' : 'missed';
}

export interface StreakResult {
  current: number;
  best: number;
  unit: 'day' | 'week';
}

export interface WeekCount {
  weekStart: DateKey;
  done: number;
  skipped: number;
}

export function weekCount(entries: EntryMap, weekStartKey: DateKey, today: DateKey): WeekCount {
  let done = 0, skipped = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStartKey, i);
    if (d > today) break;
    const st = entries[d]?.status;
    if (st === 'done') done++;
    else if (st === 'skipped') skipped++;
  }
  return { weekStart: weekStartKey, done, skipped };
}

export function computeStreaks(habit: HabitLike, entries: EntryMap, today: DateKey, weekStart: WeekStart): StreakResult {
  const start = firstDate(habit, entries);
  if (start > today) return { current: 0, best: 0, unit: habit.schedule.type === 'weekly' ? 'week' : 'day' };

  if (habit.schedule.type === 'weekly') {
    const n = habit.schedule.times;
    const firstWeek = startOfWeek(start, weekStart);
    const lastWeek = startOfWeek(today, weekStart);
    let run = 0, best = 0;
    for (let w = firstWeek; w <= lastWeek; w = addDays(w, 7)) {
      const c = weekCount(entries, w, today);
      if (c.done >= n) {
        run++;
        if (run > best) best = run;
      } else if (c.done + c.skipped >= n) {
        // excused week: neutral
      } else if (w === lastWeek || w === firstWeek) {
        // in progress or partial first week: neutral
      } else {
        run = 0;
      }
    }
    return { current: run, best, unit: 'week' };
  }

  let run = 0, best = 0;
  for (const d of eachDay(start, today)) {
    const o = dayOutcome(habit, entries, d, today);
    if (o === 'done') {
      run++;
      if (run > best) best = run;
    } else if (o === 'missed') {
      run = 0;
    }
  }
  return { current: run, best, unit: 'day' };
}

export interface RateResult {
  done: number;
  possible: number;
  rate: number | null; // 0..1, null when there is nothing to measure yet
}

/**
 * Completion rate over `from`..today (from = null for all time).
 * Day-based: done scheduled days / (scheduled days - skipped days); today only counts once done.
 * Weekly: sum(min(done, N)) / (N * weeks), excluding excused, in-progress and partial-first weeks
 * unless they were met. Weeks are whole weeks that overlap `from`.
 */
export function completionRate(
  habit: HabitLike,
  entries: EntryMap,
  today: DateKey,
  weekStart: WeekStart,
  from: DateKey | null,
): RateResult {
  const first = firstDate(habit, entries);
  const start = from && from > first ? from : first;
  if (start > today) return { done: 0, possible: 0, rate: null };

  let done = 0, possible = 0;
  if (habit.schedule.type === 'weekly') {
    const n = habit.schedule.times;
    const firstWeek = startOfWeek(first, weekStart);
    const lastWeek = startOfWeek(today, weekStart);
    for (let w = startOfWeek(start, weekStart); w <= lastWeek; w = addDays(w, 7)) {
      const c = weekCount(entries, w, today);
      if (c.done >= n) {
        done += n;
        possible += n;
      } else if (c.done + c.skipped >= n) {
        continue;
      } else if (w === lastWeek || w === firstWeek) {
        continue;
      } else {
        done += c.done;
        possible += n;
      }
    }
  } else {
    for (const d of eachDay(start, today)) {
      const o = dayOutcome(habit, entries, d, today);
      if (o === 'done') {
        done++;
        possible++;
      } else if (o === 'missed') {
        possible++;
      }
    }
  }
  return { done, possible, rate: possible > 0 ? done / possible : null };
}

export function totalDone(entries: EntryMap): number {
  let n = 0;
  for (const k in entries) if (entries[k]!.status === 'done') n++;
  return n;
}

export interface WeekProgress {
  done: number;
  target: number;
  skipped: number;
}

/** Progress of a weekly habit in the week containing `date`. */
export function weekProgress(habit: HabitLike, entries: EntryMap, date: DateKey, today: DateKey, weekStart: WeekStart): WeekProgress {
  const target = habit.schedule.type === 'weekly' ? habit.schedule.times : 0;
  const w = startOfWeek(date, weekStart);
  const end = addDays(w, 6);
  const c = weekCount(entries, w, today < end ? today : end);
  return { done: c.done, skipped: c.skipped, target };
}

export type CellState = 'done' | 'partial' | 'skipped' | 'missed' | 'pending' | 'off' | 'future';

export interface CellInfo {
  state: CellState;
  ratio?: number; // for partial goal progress
}

/** What to draw for one day in the heatmap. */
export function cellInfo(habit: Pick<Habit, 'schedule' | 'createdAt' | 'goal'>, entries: EntryMap, date: DateKey, today: DateKey): CellInfo {
  if (date > today) return { state: 'future' };
  const e = entries[date];
  if (e?.status === 'done') return { state: 'done' };
  if (e?.status === 'skipped') return { state: 'skipped' };
  if (habit.goal && e?.value && e.value > 0) return { state: 'partial', ratio: Math.min(1, e.value / habit.goal.target) };
  if (habit.schedule.type === 'weekly') return { state: 'off' };
  if (date < firstDate(habit, entries)) return { state: 'off' };
  const o = dayOutcome(habit, entries, date, today);
  return { state: o === 'missed' ? 'missed' : o === 'pending' ? 'pending' : 'off' };
}
