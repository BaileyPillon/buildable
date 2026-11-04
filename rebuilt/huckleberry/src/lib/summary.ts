import type { BabyEvent } from './types';
import { addDays, startOfDay } from './time';
import { isNightHour } from './predictor';

export interface DaySummary {
  dayStart: number;
  /** ms of sleep overlapping this calendar day (sleeps crossing midnight are split) */
  sleepMs: number;
  sleepCount: number;
  napCount: number;
  /** longest single sleep overlapping this day (full length, not clipped at midnight) */
  longestSleepMs: number;
  feeds: number;
  breastFeeds: number;
  bottleFeeds: number;
  breastMs: number;
  bottleMl: number;
  diapers: number;
  pee: number;
  poo: number;
  dry: number;
  pumps: number;
  pumpMl: number;
}

const endOf = (e: BabyEvent, now: number) => e.end ?? now;

export function eventDurationMs(e: BabyEvent, now: number): number {
  if (e.type === 'diaper') return 0;
  return Math.max(0, endOf(e, now) - e.start);
}

export function breastMs(e: BabyEvent, now: number): number {
  let left = e.leftMs ?? 0;
  let right = e.rightMs ?? 0;
  if (e.end == null && e.activeSide && e.sideSince != null) {
    const extra = Math.max(0, now - e.sideSince);
    if (e.activeSide === 'left') left += extra;
    else right += extra;
  }
  const sides = left + right;
  return sides > 0 ? sides : eventDurationMs(e, now);
}

export function summarizeDay(events: BabyEvent[], dayStart: number, now = Date.now()): DaySummary {
  const dayEnd = addDays(dayStart, 1);
  const s: DaySummary = {
    dayStart,
    sleepMs: 0,
    sleepCount: 0,
    napCount: 0,
    longestSleepMs: 0,
    feeds: 0,
    breastFeeds: 0,
    bottleFeeds: 0,
    breastMs: 0,
    bottleMl: 0,
    diapers: 0,
    pee: 0,
    poo: 0,
    dry: 0,
    pumps: 0,
    pumpMl: 0,
  };
  for (const e of events) {
    if (e.type === 'sleep') {
      const end = endOf(e, now);
      const from = Math.max(e.start, dayStart);
      const to = Math.min(end, dayEnd);
      if (to > from) {
        s.sleepMs += to - from;
        s.longestSleepMs = Math.max(s.longestSleepMs, end - e.start);
        // sleeps that overlap the day, so a night sleep counts on both of its days
        s.sleepCount += 1;
        if (!isNightHour(e.start)) s.napCount += 1;
      }
      continue;
    }
    if (e.start < dayStart || e.start >= dayEnd) continue;
    if (e.type === 'feed') {
      s.feeds += 1;
      if (e.method === 'bottle') {
        s.bottleFeeds += 1;
        s.bottleMl += e.amountMl ?? 0;
      } else {
        s.breastFeeds += 1;
        s.breastMs += breastMs(e, now);
      }
    } else if (e.type === 'diaper') {
      s.diapers += 1;
      if (e.diaper === 'pee' || e.diaper === 'both') s.pee += 1;
      if (e.diaper === 'poo' || e.diaper === 'both') s.poo += 1;
      if (e.diaper === 'dry') s.dry += 1;
    } else if (e.type === 'pump') {
      s.pumps += 1;
      s.pumpMl += e.amountMl ?? 0;
    }
  }
  return s;
}

export interface RangeSummary {
  days: DaySummary[];
  /** averages per day over days that have any data (or all days when none do) */
  avg: { sleepMs: number; longestSleepMs: number; feeds: number; diapers: number; napCount: number };
  totals: { sleepMs: number; feeds: number; diapers: number; bottleMl: number; pumpMl: number };
  longestSleepMs: number;
  daysWithData: number;
}

export function summarizeRange(events: BabyEvent[], firstDayStart: number, dayCount: number, now = Date.now()): RangeSummary {
  const days: DaySummary[] = [];
  for (let i = 0; i < dayCount; i++) days.push(summarizeDay(events, addDays(firstDayStart, i), now));
  const withData = days.filter((d) => d.sleepMs > 0 || d.feeds > 0 || d.diapers > 0 || d.pumps > 0);
  const denom = Math.max(1, withData.length);
  const sum = (f: (d: DaySummary) => number) => withData.reduce((a, d) => a + f(d), 0);
  return {
    days,
    daysWithData: withData.length,
    longestSleepMs: Math.max(0, ...days.map((d) => d.longestSleepMs)),
    avg: {
      sleepMs: sum((d) => d.sleepMs) / denom,
      longestSleepMs: sum((d) => d.longestSleepMs) / denom,
      feeds: sum((d) => d.feeds) / denom,
      diapers: sum((d) => d.diapers) / denom,
      napCount: sum((d) => d.napCount) / denom,
    },
    totals: {
      sleepMs: sum((d) => d.sleepMs),
      feeds: sum((d) => d.feeds),
      diapers: sum((d) => d.diapers),
      bottleMl: sum((d) => d.bottleMl),
      pumpMl: sum((d) => d.pumpMl),
    },
  };
}

/** events that start on `dayStart`'s calendar day, or sleeps that overlap it, oldest first */
export function eventsForDay(events: BabyEvent[], dayStart: number, now = Date.now()): BabyEvent[] {
  const dayEnd = addDays(dayStart, 1);
  return events
    .filter((e) => {
      if (e.type === 'sleep') return e.start < dayEnd && endOf(e, now) > dayStart;
      return e.start >= dayStart && e.start < dayEnd;
    })
    .sort((a, b) => a.start - b.start);
}

export function todayStart(now = Date.now()): number {
  return startOfDay(now);
}
