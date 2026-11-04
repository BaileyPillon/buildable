import type { WakeBand } from './types';
import { DAY, MIN, ageInWeeks } from './time';

/**
 * Age-based wake-window defaults (minutes awake between sleeps). These are common
 * pediatric-sleep-guidance ranges, not medical advice; every band is editable per child.
 */
export const DEFAULT_BANDS: WakeBand[] = [
  { fromWeeks: 0, toWeeks: 6, minMin: 35, maxMin: 60 },
  { fromWeeks: 6, toWeeks: 12, minMin: 60, maxMin: 90 },
  { fromWeeks: 12, toWeeks: 17, minMin: 75, maxMin: 120 },
  { fromWeeks: 17, toWeeks: 22, minMin: 90, maxMin: 150 },
  { fromWeeks: 22, toWeeks: 26, minMin: 105, maxMin: 165 },
  { fromWeeks: 26, toWeeks: 35, minMin: 120, maxMin: 180 },
  { fromWeeks: 35, toWeeks: 44, minMin: 150, maxMin: 210 },
  { fromWeeks: 44, toWeeks: 52, minMin: 165, maxMin: 210 },
  { fromWeeks: 52, toWeeks: 65, minMin: 180, maxMin: 240 },
  { fromWeeks: 65, toWeeks: 78, minMin: 210, maxMin: 300 },
  { fromWeeks: 78, toWeeks: 104, minMin: 300, maxMin: 360 },
  { fromWeeks: 104, toWeeks: 1000, minMin: 300, maxMin: 390 },
];

export const LEARN_DAYS = 10;
/** fewer clean observations than this and we stay with the age-based range */
export const MIN_OBSERVATIONS = 3;
/** weight = n / (n + WEIGHT_K), capped at MAX_WEIGHT, so the data takes over gradually */
export const WEIGHT_K = 6;
export const MAX_WEIGHT = 0.85;
export const MIN_RANGE_WIDTH = 15;
/** sleeps closer together than this are treated as one sleep (a brief stir, not a wake window) */
export const MERGE_GAP_MIN = 10;
export const MAX_WINDOW_MIN = 12 * 60;
export const NIGHT_START_HOUR = 19;
export const NIGHT_END_HOUR = 6;

export interface SleepLike {
  start: number;
  end: number | null;
}
export interface Range {
  min: number;
  max: number;
}
export interface ObservedWindow {
  /** when the baby woke up */
  wakeAt: number;
  minutes: number;
  /** the following sleep started at night (so this was a bedtime window) */
  bedtime: boolean;
}
export interface LearnedStats {
  n: number;
  q1: number;
  median: number;
  q3: number;
}
export interface Blend {
  range: Range;
  /** 0 = pure age-based prior, 1 = pure learned */
  weight: number;
  learned: LearnedStats | null;
}
export interface Prediction {
  status: 'awake' | 'asleep' | 'no-data';
  ageWeeks: number;
  band: WakeBand;
  prior: Range;
  range: Range;
  weight: number;
  learned: LearnedStats | null;
  source: 'age' | 'blend';
  /** awake: when the last sleep ended */
  wakeAt?: number;
  windowStart?: number;
  windowEnd?: number;
  /** is the predicted window a bedtime window */
  bedtime?: boolean;
  timing?: 'early' | 'now' | 'overdue';
  /** asleep: when the running sleep started and a guess for when it ends */
  asleepSince?: number;
  expectedWake?: number;
}

export interface PredictorOptions {
  nightStartHour?: number;
  nightEndHour?: number;
}

export function isNightHour(ms: number, nightStart = NIGHT_START_HOUR, nightEnd = NIGHT_END_HOUR): boolean {
  const h = new Date(ms).getHours();
  return h >= nightStart || h < nightEnd;
}

export function bandFor(bands: WakeBand[], ageWeeks: number): WakeBand {
  const sorted = [...bands].sort((a, b) => a.fromWeeks - b.fromWeeks);
  const hit = sorted.find((b) => ageWeeks >= b.fromWeeks && ageWeeks < b.toWeeks);
  if (hit) return hit;
  return ageWeeks < sorted[0].fromWeeks ? sorted[0] : sorted[sorted.length - 1];
}

export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

/** completed sleeps, merged across tiny gaps, oldest first */
export function mergeSleeps(sleeps: SleepLike[], now: number): { start: number; end: number }[] {
  const done = sleeps
    .filter((s): s is { start: number; end: number } => s.end != null && s.end > s.start && s.end <= now)
    .map((s) => ({ start: s.start, end: s.end }))
    .sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const s of done) {
    const last = out[out.length - 1];
    if (last && s.start - last.end < MERGE_GAP_MIN * MIN) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/**
 * Wake windows from the last LEARN_DAYS days: the awake gap between one sleep ending and the
 * next starting. Night wakings (waking in the night hours) are ignored. Windows that end in
 * the night sleep are flagged as bedtime windows.
 */
export function observedWindows(sleeps: SleepLike[], now: number, opts: PredictorOptions = {}): ObservedWindow[] {
  const ns = opts.nightStartHour ?? NIGHT_START_HOUR;
  const ne = opts.nightEndHour ?? NIGHT_END_HOUR;
  const cutoff = now - LEARN_DAYS * DAY;
  const merged = mergeSleeps(sleeps, now);
  const out: ObservedWindow[] = [];
  for (let i = 0; i + 1 < merged.length; i++) {
    const wakeAt = merged[i].end;
    const next = merged[i + 1].start;
    const minutes = (next - wakeAt) / MIN;
    if (wakeAt < cutoff) continue;
    if (minutes <= 0 || minutes > MAX_WINDOW_MIN) continue;
    if (isNightHour(wakeAt, ns, ne)) continue;
    out.push({ wakeAt, minutes, bedtime: isNightHour(next, ns, ne) });
  }
  return out;
}

/** Blend an age-based prior with observed window lengths (minutes). Narrows as data accumulates. */
export function blendRange(prior: Range, observed: number[]): Blend {
  const clean = observed.filter((m) => m >= prior.min * 0.5 && m <= prior.max * 1.6).sort((a, b) => a - b);
  const n = clean.length;
  if (n < MIN_OBSERVATIONS) return { range: { ...prior }, weight: 0, learned: null };

  const q1 = percentile(clean, 0.25);
  const median = percentile(clean, 0.5);
  const q3 = percentile(clean, 0.75);
  let lLo = q1;
  let lHi = q3;
  if (lHi - lLo < MIN_RANGE_WIDTH) {
    lLo = median - MIN_RANGE_WIDTH / 2;
    lHi = median + MIN_RANGE_WIDTH / 2;
  }
  const weight = Math.min(MAX_WEIGHT, n / (n + WEIGHT_K));
  let lo = prior.min + weight * (lLo - prior.min);
  let hi = prior.max + weight * (lHi - prior.max);
  lo = Math.max(lo, prior.min * 0.75);
  hi = Math.min(hi, prior.max * 1.25);
  // "narrowing": never wider than the age-based range
  const cap = prior.max - prior.min;
  if (hi - lo > cap) {
    const c = (lo + hi) / 2;
    lo = c - cap / 2;
    hi = c + cap / 2;
  }
  return {
    range: { min: Math.round(lo), max: Math.round(Math.max(hi, lo)) },
    weight,
    learned: { n, q1, median, q3 },
  };
}

export interface PredictInput {
  sleeps: SleepLike[];
  birthdate: string;
  bands?: WakeBand[];
  now: number;
  options?: PredictorOptions;
}

export function predictNextSleep(input: PredictInput): Prediction {
  const { sleeps, birthdate, now } = input;
  const bands = input.bands && input.bands.length ? input.bands : DEFAULT_BANDS;
  const ageWeeks = ageInWeeks(birthdate, now);
  const band = bandFor(bands, ageWeeks);
  const prior = { min: band.minMin, max: band.maxMin };
  const ns = input.options?.nightStartHour ?? NIGHT_START_HOUR;
  const ne = input.options?.nightEndHour ?? NIGHT_END_HOUR;

  const windows = observedWindows(sleeps, now, input.options).filter((w) => !w.bedtime);
  const blend = blendRange(prior, windows.map((w) => w.minutes));
  const base: Prediction = {
    status: 'no-data',
    ageWeeks,
    band,
    prior,
    range: blend.range,
    weight: blend.weight,
    learned: blend.learned,
    source: blend.learned ? 'blend' : 'age',
  };

  const running = sleeps.filter((s) => s.end == null && s.start <= now).sort((a, b) => b.start - a.start)[0];
  if (running) {
    const cutoff = now - LEARN_DAYS * DAY;
    const naps = mergeSleeps(sleeps, now)
      .filter((s) => s.start >= cutoff && !isNightHour(s.start, ns, ne))
      .map((s) => (s.end - s.start) / MIN)
      .sort((a, b) => a - b);
    const typical = naps.length >= MIN_OBSERVATIONS ? percentile(naps, 0.5) : null;
    return {
      ...base,
      status: 'asleep',
      asleepSince: running.start,
      expectedWake: typical != null && !isNightHour(running.start, ns, ne) ? running.start + typical * MIN : undefined,
    };
  }

  const finished = mergeSleeps(sleeps, now);
  if (finished.length === 0) return base;
  const wakeAt = finished[finished.length - 1].end;
  const windowStart = wakeAt + blend.range.min * MIN;
  const windowEnd = wakeAt + blend.range.max * MIN;
  return {
    ...base,
    status: 'awake',
    wakeAt,
    windowStart,
    windowEnd,
    // "bedtime" only for evening windows; a window landing at 3 am is just the next sleep
    bedtime: new Date(windowStart).getHours() >= ns || new Date(windowEnd).getHours() >= ns,
    timing: now < windowStart ? 'early' : now <= windowEnd ? 'now' : 'overdue',
  };
}

/** Validate user-edited bands; returns an error message or null. */
export function validateBands(bands: WakeBand[]): string | null {
  for (const b of bands) {
    if (!Number.isFinite(b.minMin) || !Number.isFinite(b.maxMin)) return 'Enter whole minutes for every band.';
    if (b.minMin < 10) return 'Minimum wake window should be at least 10 minutes.';
    if (b.maxMin < b.minMin) return 'Each maximum must be at least its minimum.';
    if (b.maxMin > 12 * 60) return 'Maximum wake window is capped at 12 hours.';
  }
  return null;
}

export function bandLabel(b: WakeBand): string {
  const w = (n: number) => {
    if (n >= 104) return `${Math.round(n / 52)} yr`;
    if (n >= 13) return `${Math.round(n / 4.345)} mo`;
    return `${n} wk`;
  };
  if (b.toWeeks >= 1000) return `${w(b.fromWeeks)}+`;
  return `${w(b.fromWeeks)} to ${w(b.toWeeks)}`;
}
