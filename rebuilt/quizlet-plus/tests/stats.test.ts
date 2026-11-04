import { describe, expect, it } from 'vitest';
import { buildHeatmap, computeRetention, computeStreak, countByDay, dayKey, heatLevel, summarize } from '../src/stats';
import { newSchedFields } from '../src/scheduler';
import { State, type Card, type ReviewLog } from '../src/types';

const NOW = new Date(2026, 5, 15, 14, 0, 0).getTime(); // Monday
const DAY = 86_400_000;
const at = (daysAgo: number, hour = 10) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
};

function log(ts: number, rating: 1 | 2 | 3 | 4 = 3, prevState: 0 | 1 | 2 | 3 = 2): ReviewLog {
  return {
    cardId: 'c',
    deckId: 'd',
    ts,
    rating,
    prevState,
    state: 2,
    elapsedDays: 1,
    scheduledDays: 1,
    mode: 'flip',
    durationMs: 1000,
  };
}

describe('streak', () => {
  it('counts consecutive days ending today', () => {
    const counts = countByDay([log(at(0)), log(at(1)), log(at(2)), log(at(4))]);
    expect(computeStreak(counts, NOW)).toEqual({ current: 3, longest: 3, studiedToday: true });
  });

  it('is still alive if you studied yesterday but not yet today', () => {
    const counts = countByDay([log(at(1)), log(at(2))]);
    const s = computeStreak(counts, NOW);
    expect(s.current).toBe(2);
    expect(s.studiedToday).toBe(false);
  });

  it('breaks after a missed day and tracks the longest run', () => {
    const counts = countByDay([log(at(2)), log(at(3)), log(at(4)), log(at(5)), log(at(0))]);
    const s = computeStreak(counts, NOW);
    expect(s.current).toBe(1);
    expect(s.longest).toBe(4);
  });

  it('is zero with no reviews or after two idle days', () => {
    expect(computeStreak(new Map(), NOW).current).toBe(0);
    expect(computeStreak(countByDay([log(at(2))]), NOW).current).toBe(0);
  });

  it('many reviews in a day still count as one day', () => {
    const counts = countByDay([log(at(0, 8)), log(at(0, 9)), log(at(0, 23))]);
    expect(counts.get(dayKey(NOW))).toBe(3);
    expect(computeStreak(counts, NOW).current).toBe(1);
  });
});

describe('retention', () => {
  it('is the share of review-state answers that were not Again', () => {
    const logs = [log(at(1), 3), log(at(1), 4), log(at(1), 1), log(at(1), 2)];
    const r = computeRetention(logs, NOW);
    expect(r).toEqual({ rate: 0.75, passed: 3, total: 4 });
  });

  it('ignores learning-step answers and new cards', () => {
    const logs = [log(at(1), 1, 0), log(at(1), 1, 1), log(at(1), 3, 3), log(at(1), 3, 2)];
    expect(computeRetention(logs, NOW)).toEqual({ rate: 1, passed: 1, total: 1 });
  });

  it('can be limited to a recent window and is null with no data', () => {
    const logs = [log(at(40), 1), log(at(2), 3)];
    expect(computeRetention(logs, NOW, 30).rate).toBe(1);
    expect(computeRetention(logs, NOW).rate).toBe(0.5);
    expect(computeRetention([], NOW).rate).toBeNull();
  });
});

describe('heatmap', () => {
  it('builds 53 week-columns of 7 days ending in the current week', () => {
    const grid = buildHeatmap(new Map(), NOW, 53);
    expect(grid).toHaveLength(53);
    expect(grid.every((col) => col.length === 7)).toBe(true);
    const last = grid[52];
    // 2026-06-15 is a Monday: Sunday 14th first, then today on row 1
    expect(last[0].key).toBe('2026-06-14');
    expect(last[1].key).toBe(dayKey(NOW));
    expect(last[1].inRange).toBe(true);
    expect(last[2].inRange).toBe(false);
  });

  it('assigns levels relative to the busiest day', () => {
    const counts = new Map<string, number>([
      [dayKey(at(0)), 40],
      [dayKey(at(1)), 12],
      [dayKey(at(2)), 1],
    ]);
    const cells = buildHeatmap(counts, NOW, 2).flat();
    const byKey = new Map(cells.map((c) => [c.key, c]));
    expect(byKey.get(dayKey(at(0)))!.level).toBe(4);
    expect(byKey.get(dayKey(at(1)))!.level).toBe(2);
    expect(byKey.get(dayKey(at(2)))!.level).toBe(1);
    expect(byKey.get(dayKey(at(3)))!.level).toBe(0);
  });

  it('heatLevel edge cases', () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(5, 0)).toBe(0);
    expect(heatLevel(10, 10)).toBe(4);
  });

  it('days are keyed by local date', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
    expect(dayKey(new Date(2026, 0, 6, 0, 1).getTime())).toBe('2026-01-06');
    expect(DAY).toBe(86_400_000);
  });
});

describe('summarize', () => {
  const mk = (over: Partial<Card>): Card => ({ id: 'x', deckId: 'd', front: 'f', back: 'b', createdAt: 0, updatedAt: 0, ...newSchedFields(0), ...over });
  it('buckets cards into new / learning / young / mature', () => {
    const s = summarize([
      mk({}),
      mk({ state: State.Learning }),
      mk({ state: State.Relearning }),
      mk({ state: State.Review, stability: 5 }),
      mk({ state: State.Review, stability: 40 }),
    ]);
    expect(s).toMatchObject({ total: 5, newCards: 1, learning: 2, young: 1, mature: 1 });
  });
});
