import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BANDS,
  MAX_WEIGHT,
  MIN_OBSERVATIONS,
  bandFor,
  blendRange,
  mergeSleeps,
  observedWindows,
  predictNextSleep,
  validateBands,
  type SleepLike,
} from '../src/lib/predictor';
import { MIN, DAY, toDateInput } from '../src/lib/time';

// Local-time helpers so the tests do not depend on the machine's timezone.
const at = (day: number, h: number, m = 0) => new Date(2026, 6, day, h, m).getTime();
const NOW = at(15, 14, 0);
/** a baby who is 22.5 weeks old at NOW (age band 22 to 26 weeks: 105 to 165 min) */
const BIRTH = toDateInput(NOW - 22.5 * 7 * DAY);

/** Regular days: wake 07:00, naps 09-10, 12-13:30, 15:30-16:15, bed 19:30. Wake windows are 120 min. */
function schedule(firstDay: number, lastDay: number): SleepLike[] {
  const out: SleepLike[] = [];
  for (let d = firstDay; d <= lastDay; d++) {
    out.push({ start: at(d, 9), end: at(d, 10) });
    out.push({ start: at(d, 12), end: at(d, 13, 30) });
    if (d < 15) {
      out.push({ start: at(d, 15, 30), end: at(d, 16, 15) });
      out.push({ start: at(d, 19, 30), end: at(d + 1, 7) });
    }
  }
  return out;
}

describe('age bands', () => {
  it('picks the band for the age, with half-open boundaries', () => {
    expect(bandFor(DEFAULT_BANDS, 0)).toMatchObject({ minMin: 35, maxMin: 60 });
    expect(bandFor(DEFAULT_BANDS, 5.9)).toMatchObject({ minMin: 35, maxMin: 60 });
    expect(bandFor(DEFAULT_BANDS, 6)).toMatchObject({ minMin: 60, maxMin: 90 });
    expect(bandFor(DEFAULT_BANDS, 22.5)).toMatchObject({ minMin: 105, maxMin: 165 });
    expect(bandFor(DEFAULT_BANDS, 52)).toMatchObject({ minMin: 180, maxMin: 240 });
  });
  it('clamps ages outside the table to the first or last band', () => {
    expect(bandFor(DEFAULT_BANDS, -3).fromWeeks).toBe(0);
    expect(bandFor(DEFAULT_BANDS, 5000).fromWeeks).toBe(104);
  });
  it('default bands are contiguous and well formed', () => {
    for (let i = 1; i < DEFAULT_BANDS.length; i++) expect(DEFAULT_BANDS[i].fromWeeks).toBe(DEFAULT_BANDS[i - 1].toWeeks);
    expect(validateBands(DEFAULT_BANDS)).toBeNull();
  });
  it('validates edited bands', () => {
    expect(validateBands([{ fromWeeks: 0, toWeeks: 10, minMin: 90, maxMin: 60 }])).toMatch(/at least its minimum/);
    expect(validateBands([{ fromWeeks: 0, toWeeks: 10, minMin: 5, maxMin: 60 }])).toMatch(/at least 10/);
    expect(validateBands([{ fromWeeks: 0, toWeeks: 10, minMin: NaN, maxMin: 60 }])).toMatch(/whole minutes/);
  });
});

describe('blendRange (learning from the last observations)', () => {
  const prior = { min: 105, max: 165 };
  const same = (n: number, v = 120) => Array.from({ length: n }, () => v);

  it('stays on the age-based range until there are enough observations', () => {
    const b = blendRange(prior, same(MIN_OBSERVATIONS - 1));
    expect(b.range).toEqual(prior);
    expect(b.weight).toBe(0);
    expect(b.learned).toBeNull();
  });

  it('narrows around what the baby actually does', () => {
    const b = blendRange(prior, same(12, 120));
    expect(b.range.min).toBeGreaterThan(prior.min);
    expect(b.range.max).toBeLessThan(prior.max);
    expect(b.range.max - b.range.min).toBeLessThan(prior.max - prior.min);
    expect(b.range.min).toBeLessThanOrEqual(120);
    expect(b.range.max).toBeGreaterThanOrEqual(120);
    expect(b.learned?.median).toBe(120);
  });

  it('narrows further as more data arrives, and never reaches full weight', () => {
    const w = (n: number) => blendRange(prior, same(n));
    const widths = [3, 6, 12, 30, 200].map((n) => w(n).range.max - w(n).range.min);
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeLessThanOrEqual(widths[i - 1]);
    expect(widths[widths.length - 1]).toBeLessThan(widths[0]);
    expect(w(1000).weight).toBe(MAX_WEIGHT);
  });

  it('follows the baby when they differ from the age band (shifts the range)', () => {
    const long = blendRange(prior, same(20, 150));
    const short = blendRange(prior, same(20, 110));
    expect(long.range.min).toBeGreaterThan(short.range.min);
    expect(long.range.max).toBeGreaterThan(short.range.max);
  });

  it('ignores implausible outliers (a missed log, a long gap)', () => {
    const b = blendRange(prior, [120, 120, 120, 400, 5]);
    expect(b.learned?.n).toBe(3);
    expect(b.range.max).toBeLessThan(prior.max);
  });

  it('never gets wider than the age range, even for erratic data', () => {
    const erratic = [90, 100, 120, 140, 160, 180, 200, 220, 240, 255, 95, 130, 175, 215, 250];
    const b = blendRange(prior, erratic);
    expect(b.range.max - b.range.min).toBeLessThanOrEqual(prior.max - prior.min);
    expect(b.range.min).toBeGreaterThanOrEqual(prior.min * 0.75 - 1);
  });

  it('respects a user-edited prior', () => {
    const edited = { min: 150, max: 210 };
    expect(blendRange(edited, []).range).toEqual(edited);
    const b = blendRange(edited, same(15, 170));
    expect(b.range.min).toBeGreaterThan(150);
    expect(b.range.max).toBeLessThan(210);
  });
});

describe('observedWindows', () => {
  it('measures the awake gap between sleeps, flags bedtime windows and skips the night', () => {
    const w = observedWindows(schedule(13, 14), NOW);
    const day = w.filter((x) => x.wakeAt >= at(14, 0) && x.wakeAt < at(15, 0));
    // wake 07:00 -> 09:00, 10:00 -> 12:00, 13:30 -> 15:30, 16:15 -> 19:30 (bedtime)
    expect(day.map((x) => x.minutes)).toEqual([120, 120, 120, 195]);
    expect(day.map((x) => x.bedtime)).toEqual([false, false, false, true]);
  });

  it('uses only the last 10 days', () => {
    const old: SleepLike[] = [
      { start: at(1, 9), end: at(1, 10) },
      { start: at(1, 14), end: at(1, 15) }, // 240 min window on day 1, outside 10 days
    ];
    expect(observedWindows([...old, ...schedule(10, 14)], NOW).some((x) => x.wakeAt < NOW - 10 * DAY)).toBe(false);
  });

  it('ignores night wakings but keeps the morning window', () => {
    const s: SleepLike[] = [
      { start: at(13, 19, 30), end: at(13, 23, 0) },
      { start: at(13, 23, 40), end: at(14, 6, 30) },
      { start: at(14, 9), end: at(14, 10) },
    ];
    const w = observedWindows(s, NOW);
    expect(w).toHaveLength(1);
    expect(w[0].minutes).toBe(150);
  });

  it('treats sleeps separated by a few minutes as one sleep', () => {
    const s: SleepLike[] = [
      { start: at(14, 9), end: at(14, 9, 40) },
      { start: at(14, 9, 45), end: at(14, 10, 20) },
      { start: at(14, 12, 20), end: at(14, 13) },
    ];
    expect(mergeSleeps(s, NOW)).toHaveLength(2);
    expect(observedWindows(s, NOW).map((x) => x.minutes)).toEqual([120]);
  });

  it('skips unfinished sleeps and absurd gaps', () => {
    const s: SleepLike[] = [
      { start: at(14, 6, 30), end: at(14, 7) },
      { start: at(14, 9), end: null },
    ];
    expect(observedWindows(s, NOW)).toEqual([]);
  });
});

describe('predictNextSleep', () => {
  const sleeps = schedule(5, 15);

  it('uses the age range alone when nothing is logged', () => {
    const p = predictNextSleep({ sleeps: [], birthdate: BIRTH, now: NOW });
    expect(p.status).toBe('no-data');
    expect(p.range).toEqual({ min: 105, max: 165 });
    expect(p.source).toBe('age');
    expect(p.windowStart).toBeUndefined();
  });

  it('predicts the next window from the last wake-up, using the learned range', () => {
    const p = predictNextSleep({ sleeps, birthdate: BIRTH, now: NOW });
    expect(p.status).toBe('awake');
    expect(p.wakeAt).toBe(at(15, 13, 30));
    expect(p.source).toBe('blend');
    expect(p.range.min).toBeGreaterThan(105);
    expect(p.range.max).toBeLessThan(165);
    expect(p.windowStart).toBe(at(15, 13, 30) + p.range.min * MIN);
    expect(p.windowEnd).toBe(at(15, 13, 30) + p.range.max * MIN);
    // the learned window brackets the 120 minutes this baby really does
    expect(p.windowStart! - p.wakeAt!).toBeLessThanOrEqual(120 * MIN);
    expect(p.windowEnd! - p.wakeAt!).toBeGreaterThanOrEqual(120 * MIN);
    expect(p.learned!.n).toBeGreaterThanOrEqual(20);
  });

  it('only the last ten days count', () => {
    // 10 days of 200 minute windows long ago, then regular 120 minute days recently
    const old: SleepLike[] = [];
    for (let d = 1; d <= 3; d++) {
      old.push({ start: at(d, 9), end: at(d, 10) });
      old.push({ start: at(d, 13, 20), end: at(d, 14, 20) });
      old.push({ start: at(d, 17, 40), end: at(d, 18, 20) });
    }
    const withOld = predictNextSleep({ sleeps: [...old, ...sleeps], birthdate: BIRTH, now: NOW });
    const without = predictNextSleep({ sleeps, birthdate: BIRTH, now: NOW });
    expect(withOld.range).toEqual(without.range);
  });

  it('reports a running sleep and guesses the wake time from typical naps', () => {
    const asleep = [...sleeps, { start: NOW - 30 * MIN, end: null }];
    const p = predictNextSleep({ sleeps: asleep, birthdate: BIRTH, now: NOW });
    expect(p.status).toBe('asleep');
    expect(p.asleepSince).toBe(NOW - 30 * MIN);
    expect(p.expectedWake).toBeGreaterThan(NOW - 30 * MIN);
    expect(p.windowStart).toBeUndefined();
  });

  it('marks early, in-window and overdue', () => {
    const one = (minAgo: number) => [{ start: NOW - minAgo * MIN - 60 * MIN, end: NOW - minAgo * MIN }];
    expect(predictNextSleep({ sleeps: one(30), birthdate: BIRTH, now: NOW }).timing).toBe('early');
    expect(predictNextSleep({ sleeps: one(120), birthdate: BIRTH, now: NOW }).timing).toBe('now');
    expect(predictNextSleep({ sleeps: one(300), birthdate: BIRTH, now: NOW }).timing).toBe('overdue');
  });

  it('uses edited wake windows as the starting point', () => {
    const bands = DEFAULT_BANDS.map((b) => (b.fromWeeks === 22 ? { ...b, minMin: 60, maxMin: 80 } : b));
    const one = [{ start: NOW - 3 * 60 * MIN, end: NOW - 2 * 60 * MIN }];
    const edited = predictNextSleep({ sleeps: one, birthdate: BIRTH, bands, now: NOW });
    const dflt = predictNextSleep({ sleeps: one, birthdate: BIRTH, now: NOW });
    expect(edited.range).toEqual({ min: 60, max: 80 });
    expect(dflt.range).toEqual({ min: 105, max: 165 });
    expect(edited.windowStart).toBe(NOW - 120 * MIN + 60 * MIN);
  });

  it('moves to the next age band as the baby grows', () => {
    const young = predictNextSleep({ sleeps: [], birthdate: toDateInput(NOW - 3 * 7 * DAY), now: NOW });
    const older = predictNextSleep({ sleeps: [], birthdate: toDateInput(NOW - 40 * 7 * DAY), now: NOW });
    expect(young.range.max).toBeLessThan(older.range.min);
  });

  it('calls a window that lands after 19:00 a bedtime window', () => {
    const evening = at(15, 17, 30);
    const p = predictNextSleep({ sleeps: [{ start: evening - 60 * MIN, end: evening }], birthdate: BIRTH, now: evening + 10 * MIN });
    expect(p.bedtime).toBe(true);
  });
});
