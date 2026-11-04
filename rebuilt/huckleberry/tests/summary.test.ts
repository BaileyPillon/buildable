import { describe, expect, it } from 'vitest';
import type { BabyEvent } from '../src/lib/types';
import { eventsForDay, summarizeDay, summarizeRange } from '../src/lib/summary';
import { buildShareModel, buildShareText, formatAmount, mlToUnits, unitsToMl } from '../src/lib/share';
import { MIN, HOUR, addDays, formatDuration, formatTimer, fromLocalInput, startOfDay, toLocalInput } from '../src/lib/time';
import { finishEvent } from '../src/lib/store';

const at = (day: number, h: number, m = 0) => new Date(2026, 6, day, h, m).getTime();
let n = 0;
const ev = (p: Partial<BabyEvent> & Pick<BabyEvent, 'type' | 'start'>): BabyEvent => ({ id: 'e' + n++, childId: 'c1', end: p.start, ...p });
const NOW = at(10, 20);

const events: BabyEvent[] = [
  ev({ type: 'sleep', start: at(8, 20), end: at(9, 6) }), // night across midnight (10h)
  ev({ type: 'sleep', start: at(9, 9), end: at(9, 10, 30) }),
  ev({ type: 'sleep', start: at(9, 13), end: at(9, 14) }),
  ev({ type: 'feed', method: 'breast', start: at(9, 7), end: at(9, 7, 20), leftMs: 12 * MIN, rightMs: 8 * MIN }),
  ev({ type: 'feed', method: 'bottle', start: at(9, 11), end: at(9, 11, 10), amountMl: 120 }),
  ev({ type: 'feed', method: 'bottle', start: at(9, 15), end: at(9, 15, 10), amountMl: 90 }),
  ev({ type: 'diaper', start: at(9, 8), diaper: 'pee' }),
  ev({ type: 'diaper', start: at(9, 12), diaper: 'poo' }),
  ev({ type: 'diaper', start: at(9, 16), diaper: 'both' }),
  ev({ type: 'pump', start: at(9, 18), end: at(9, 18, 25), amountMl: 100 }),
  ev({ type: 'sleep', start: at(10, 9), end: at(10, 10) }),
];

describe('summarizeDay', () => {
  const d = summarizeDay(events, startOfDay(at(9, 12)), NOW);
  it('totals sleep, splitting sleeps that cross midnight', () => {
    // 00:00-06:00 (6h) + 1.5h + 1h
    expect(d.sleepMs).toBe(6 * HOUR + 90 * MIN + 60 * MIN);
    expect(formatDuration(d.sleepMs)).toBe('8h 30m');
  });
  it('longest stretch is the full length of the longest sleep touching the day', () => {
    expect(d.longestSleepMs).toBe(10 * HOUR);
  });
  it('counts sleeps overlapping that day and naps separately from night sleep', () => {
    expect(d.sleepCount).toBe(3);
    expect(d.napCount).toBe(2);
  });
  it('counts feeds by type with durations and amounts', () => {
    expect(d.feeds).toBe(3);
    expect(d.breastFeeds).toBe(1);
    expect(d.breastMs).toBe(20 * MIN);
    expect(d.bottleFeeds).toBe(2);
    expect(d.bottleMl).toBe(210);
  });
  it('counts diapers by kind', () => {
    expect(d.diapers).toBe(3);
    expect(d.pee).toBe(2); // pee + both
    expect(d.poo).toBe(2); // poo + both
  });
  it('totals pumping', () => {
    expect(d.pumps).toBe(1);
    expect(d.pumpMl).toBe(100);
  });
  it('counts the rest of a running sleep up to now', () => {
    const run = [ev({ type: 'sleep', start: NOW - 2 * HOUR, end: null })];
    expect(summarizeDay(run, startOfDay(NOW), NOW).sleepMs).toBe(2 * HOUR);
  });
  it('an empty day is all zeros', () => {
    const e = summarizeDay(events, startOfDay(at(1, 12)), NOW);
    expect(e.sleepMs + e.feeds + e.diapers + e.longestSleepMs).toBe(0);
  });
});

describe('summarizeRange (weekly)', () => {
  const w = summarizeRange(events, addDays(startOfDay(at(10, 12)), -6), 7, NOW);
  it('has one summary per day', () => {
    expect(w.days).toHaveLength(7);
  });
  it('averages over days that have data only', () => {
    expect(w.daysWithData).toBe(3); // 8th, 9th, 10th
    expect(w.totals.feeds).toBe(3);
    expect(w.avg.feeds).toBeCloseTo(1, 5);
    expect(w.longestSleepMs).toBe(10 * HOUR);
  });
  it('is zero-safe with no data at all', () => {
    const z = summarizeRange([], startOfDay(NOW), 7, NOW);
    expect(z.avg.sleepMs).toBe(0);
    expect(z.longestSleepMs).toBe(0);
  });
});

describe('eventsForDay', () => {
  it('includes sleeps that overlap the day and orders by start', () => {
    const list = eventsForDay(events, startOfDay(at(9, 12)), NOW);
    expect(list[0].start).toBe(at(8, 20));
    expect(list.some((e) => e.start === at(10, 9))).toBe(false);
  });
});

describe('breast timer bookkeeping', () => {
  it('finishEvent banks the open side and clears it', () => {
    const run = ev({ type: 'feed', method: 'breast', start: at(9, 7), end: null, leftMs: 5 * MIN, activeSide: 'right', sideSince: at(9, 7, 5) });
    const done = finishEvent(run, at(9, 7, 15));
    expect(done.end).toBe(at(9, 7, 15));
    expect(done.leftMs).toBe(5 * MIN);
    expect(done.rightMs).toBe(10 * MIN);
    expect(done.activeSide).toBeNull();
  });
  it('never ends before it started (backdated clocks)', () => {
    const run = ev({ type: 'sleep', start: at(9, 7), end: null });
    expect(finishEvent(run, at(9, 6)).end).toBe(at(9, 7));
  });
});

describe('formatting and units', () => {
  it('formats durations and timers', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(45 * MIN)).toBe('45m');
    expect(formatDuration(2 * HOUR)).toBe('2h');
    expect(formatDuration(90 * MIN)).toBe('1h 30m');
    expect(formatTimer(65_000)).toBe('1:05');
    expect(formatTimer(3_725_000)).toBe('1:02:05');
  });
  it('round-trips datetime-local values', () => {
    const t = at(9, 13, 5);
    expect(fromLocalInput(toLocalInput(t))).toBe(t);
    expect(fromLocalInput('nope')).toBeNull();
  });
  it('converts ml and oz', () => {
    expect(formatAmount(120, 'ml')).toBe('120 ml');
    expect(formatAmount(120, 'oz')).toBe('4.1 oz');
    expect(Math.round(unitsToMl(mlToUnits(150, 'oz'), 'oz'))).toBe(150);
    expect(formatAmount(undefined, 'ml')).toBe('');
  });
});

describe('share summary text', () => {
  const child = { id: 'c1', name: 'Juniper', birthdate: '2026-03-01', createdAt: 0 };
  it('describes a single day for a pediatrician', () => {
    const m = buildShareModel(child, events, startOfDay(at(9, 12)), 1, 'ml', NOW);
    const t = buildShareText(m);
    expect(t).toContain('Juniper');
    expect(t).toContain('Sleep: 8h 30m total');
    expect(t).toContain('longest stretch 10h');
    expect(t).toContain('Feeds: 3');
    expect(t).toContain('2 bottle (210 ml)');
    expect(t).toContain('Diapers: 3 (2 wet, 2 dirty)');
    expect(m.daySleepSegments.length).toBe(3);
  });
  it('describes a week with daily averages and a day by day list', () => {
    const m = buildShareModel(child, events, addDays(startOfDay(at(10, 12)), -6), 7, 'oz', NOW);
    const t = buildShareText(m);
    expect(t).toContain('Daily average');
    expect(t).toContain('Day by day');
    expect(t.split('\n').filter((l) => /sleep .*longest/.test(l)).length).toBe(7);
  });
  it('ignores other children', () => {
    const other = [ev({ type: 'diaper', start: at(9, 9), diaper: 'poo', childId: 'c2' })];
    const m = buildShareModel(child, other, startOfDay(at(9, 12)), 1, 'ml', NOW);
    expect(m.summary.days[0].diapers).toBe(0);
  });
});
