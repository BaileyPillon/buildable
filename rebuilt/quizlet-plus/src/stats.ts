/** Streak, retention and heatmap, computed from the review log. Pure functions. */
import { DAY_MS } from './fsrs';
import { startOfDay } from './scheduler';
import type { Card, ReviewLog } from './types';
import { State } from './types';

/** Local calendar day key, e.g. 2026-11-03. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function countByDay(reviews: readonly ReviewLog[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of reviews) {
    const k = dayKey(r.ts);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return map;
}

export interface Streak {
  current: number;
  longest: number;
  /** true when today already has a review */
  studiedToday: boolean;
}

/** Consecutive days with at least one review. A streak is still alive if you have not studied yet today. */
export function computeStreak(counts: Map<string, number>, now: number): Streak {
  const studiedToday = (counts.get(dayKey(now)) ?? 0) > 0;
  let current = 0;
  let t = startOfDay(now);
  if (!studiedToday) t = shiftDay(t, -1);
  while ((counts.get(dayKey(t)) ?? 0) > 0) {
    current += 1;
    t = shiftDay(t, -1);
  }
  const days = Array.from(counts.keys()).sort();
  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const k of days) {
    const [y, m, d] = k.split('-').map(Number);
    const ts = new Date(y, m - 1, d).getTime();
    run = prev !== null && Math.round((ts - prev) / DAY_MS) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = ts;
  }
  return { current, longest, studiedToday };
}

function shiftDay(dayStart: number, delta: number): number {
  const d = new Date(dayStart);
  d.setDate(d.getDate() + delta);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface Retention {
  /** share of review-state answers that were not "Again" */
  rate: number | null;
  passed: number;
  total: number;
}

/**
 * True retention: of the reviews of cards that were already in the Review state, how many were
 * remembered (Hard/Good/Easy). Learning-step answers are excluded, as FSRS does.
 */
export function computeRetention(reviews: readonly ReviewLog[], now: number, windowDays?: number): Retention {
  const since = windowDays === undefined ? -Infinity : now - windowDays * DAY_MS;
  let total = 0;
  let passed = 0;
  for (const r of reviews) {
    if (r.prevState !== State.Review || r.ts < since) continue;
    total += 1;
    if (r.rating > 1) passed += 1;
  }
  return { rate: total ? passed / total : null, passed, total };
}

export interface HeatCell {
  key: string;
  count: number;
  /** 0 = none .. 4 = most */
  level: 0 | 1 | 2 | 3 | 4;
  /** false for padding cells before the first or after the last day */
  inRange: boolean;
}

export function heatLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  const f = count / max;
  return f > 0.75 ? 4 : f > 0.5 ? 3 : f > 0.25 ? 2 : 1;
}

/**
 * Columns are weeks (Sunday first), rows are weekdays. Ends with the week containing `now`.
 */
export function buildHeatmap(counts: Map<string, number>, now: number, weeks = 53): HeatCell[][] {
  const today = startOfDay(now);
  const dow = new Date(today).getDay();
  const lastWeekStart = shiftDay(today, -dow);
  const firstStart = shiftDay(lastWeekStart, -(weeks - 1) * 7);
  let max = 0;
  for (const v of counts.values()) max = Math.max(max, v);
  const out: HeatCell[][] = [];
  let cursor = firstStart;
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = [];
    for (let i = 0; i < 7; i++) {
      const key = dayKey(cursor);
      const count = counts.get(key) ?? 0;
      col.push({ key, count, level: heatLevel(count, max), inRange: cursor <= today });
      cursor = shiftDay(cursor, 1);
    }
    out.push(col);
  }
  return out;
}

export interface Summary {
  total: number;
  newCards: number;
  learning: number;
  young: number;
  mature: number;
}

/** Mature = stability of 21 days or more, the Anki convention. */
export function summarize(cards: readonly Card[]): Summary {
  const s: Summary = { total: cards.length, newCards: 0, learning: 0, young: 0, mature: 0 };
  for (const c of cards) {
    if (c.state === State.New) s.newCards++;
    else if (c.state === State.Learning || c.state === State.Relearning) s.learning++;
    else if (c.stability >= 21) s.mature++;
    else s.young++;
  }
  return s;
}
