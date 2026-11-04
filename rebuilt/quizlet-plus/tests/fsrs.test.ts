import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  DEFAULT_W,
  MIN_MS,
  dayStartPlus,
  formatInterval,
  initDifficulty,
  initStability,
  intervalFor,
  makeParams,
  nextDifficulty,
  nextForgetStability,
  nextRecallStability,
  preview,
  retrievability,
  schedule,
} from '../src/fsrs';
import { newSchedFields } from '../src/scheduler';
import { State, type Rating, type SchedFields } from '../src/types';

const T0 = new Date(2026, 0, 10, 9, 0, 0).getTime();

function review(card: SchedFields, rating: Rating, at: number): SchedFields {
  return schedule(card, rating, at).card;
}

describe('FSRS formulas', () => {
  it('retrievability is 1 at t=0 and exactly 0.9 when t equals stability', () => {
    expect(retrievability(0, 5)).toBe(1);
    expect(retrievability(5, 5)).toBeCloseTo(0.9, 10);
    expect(retrievability(50, 5)).toBeLessThan(retrievability(5, 5));
  });

  it('interval at 90% requested retention equals stability (rounded, min 1 day)', () => {
    expect(intervalFor(10, 0.9, 36500)).toBe(10);
    expect(intervalFor(0.2, 0.9, 36500)).toBe(1);
    expect(intervalFor(100000, 0.9, 365)).toBe(365);
  });

  it('a higher requested retention gives shorter intervals', () => {
    expect(intervalFor(30, 0.95, 36500)).toBeLessThan(intervalFor(30, 0.9, 36500));
    expect(intervalFor(30, 0.8, 36500)).toBeGreaterThan(intervalFor(30, 0.9, 36500));
  });

  it('initial stability and difficulty come from the weights', () => {
    expect(initStability(DEFAULT_W, 1)).toBeCloseTo(0.4872);
    expect(initStability(DEFAULT_W, 3)).toBeCloseTo(3.7145);
    expect(initStability(DEFAULT_W, 4)).toBeCloseTo(13.8206);
    expect(initDifficulty(DEFAULT_W, 3)).toBeCloseTo(5.1618);
    expect(initDifficulty(DEFAULT_W, 1)).toBeCloseTo(5.1618 + 2 * 1.2298);
    expect(initDifficulty(DEFAULT_W, 4)).toBeCloseTo(5.1618 - 1.2298);
  });

  it('difficulty moves up on Again, down on Easy, and stays within 1..10', () => {
    const d = 5;
    expect(nextDifficulty(DEFAULT_W, d, 1)).toBeGreaterThan(d);
    expect(nextDifficulty(DEFAULT_W, d, 4)).toBeLessThan(d);
    let hard = 9.9;
    for (let i = 0; i < 100; i++) hard = nextDifficulty(DEFAULT_W, hard, 1);
    expect(hard).toBeLessThanOrEqual(10);
    let easy = 1.1;
    for (let i = 0; i < 100; i++) easy = nextDifficulty(DEFAULT_W, easy, 4);
    expect(easy).toBeGreaterThanOrEqual(1);
  });

  it('successful recall grows stability; Hard grows less than Good, Good less than Easy', () => {
    const s = 10;
    const r = retrievability(10, s);
    const hard = nextRecallStability(DEFAULT_W, 5, s, r, 2);
    const good = nextRecallStability(DEFAULT_W, 5, s, r, 3);
    const easy = nextRecallStability(DEFAULT_W, 5, s, r, 4);
    expect(hard).toBeGreaterThan(s);
    expect(good).toBeGreaterThan(hard);
    expect(easy).toBeGreaterThan(good);
  });

  it('reviewing later (lower retrievability) grows stability more than reviewing early', () => {
    const early = nextRecallStability(DEFAULT_W, 5, 10, retrievability(2, 10), 3);
    const late = nextRecallStability(DEFAULT_W, 5, 10, retrievability(30, 10), 3);
    expect(late).toBeGreaterThan(early);
  });

  it('forgetting never raises stability and never drops below the floor', () => {
    const f = nextForgetStability(DEFAULT_W, 6, 20, retrievability(20, 20));
    expect(f).toBeLessThanOrEqual(20);
    expect(f).toBeGreaterThanOrEqual(0.1);
  });

  it('easier cards (lower difficulty) gain more stability', () => {
    const r = 0.9;
    expect(nextRecallStability(DEFAULT_W, 2, 10, r, 3)).toBeGreaterThan(nextRecallStability(DEFAULT_W, 9, 10, r, 3));
  });
});

describe('schedule(): new cards', () => {
  it('Again / Hard / Good put a new card into learning with 1m / 5m / 10m steps', () => {
    const base = newSchedFields(T0);
    const again = review(base, 1, T0);
    const hard = review(base, 2, T0);
    const good = review(base, 3, T0);
    for (const c of [again, hard, good]) expect(c.state).toBe(State.Learning);
    expect(again.due - T0).toBe(1 * MIN_MS);
    expect(hard.due - T0).toBe(5 * MIN_MS);
    expect(good.due - T0).toBe(10 * MIN_MS);
    expect(good.stability).toBeCloseTo(3.7145);
    expect(good.difficulty).toBeCloseTo(5.1618);
    expect(good.reps).toBe(1);
    expect(good.lastReview).toBe(T0);
  });

  it('Easy graduates a new card straight to Review with a multi-day interval', () => {
    const easy = review(newSchedFields(T0), 4, T0);
    expect(easy.state).toBe(State.Review);
    expect(easy.scheduledDays).toBeGreaterThanOrEqual(13);
    expect(easy.due).toBe(dayStartPlus(T0, easy.scheduledDays));
  });
});

describe('schedule(): learning and relearning', () => {
  it('Good after the first learning step graduates to Review (S=3.7 gives Hard 4d, so Good is bumped to 5d)', () => {
    const l = review(newSchedFields(T0), 3, T0);
    const g = review(l, 3, T0 + 10 * MIN_MS);
    expect(g.state).toBe(State.Review);
    expect(g.scheduledDays).toBe(5);
    expect(g.due).toBe(dayStartPlus(T0 + 10 * MIN_MS, 5));
  });

  it('Again inside learning repeats the step in 5 minutes and stays in learning', () => {
    const l = review(newSchedFields(T0), 2, T0);
    const a = review(l, 1, T0 + 5 * MIN_MS);
    expect(a.state).toBe(State.Learning);
    expect(a.due - (T0 + 5 * MIN_MS)).toBe(5 * MIN_MS);
  });

  it('lapse: Again on a review card sends it to relearning, counts a lapse and cuts stability', () => {
    const g = review(review(newSchedFields(T0), 3, T0), 3, T0 + 10 * MIN_MS);
    const dueAt = g.due;
    const lapsed = review(g, 1, dueAt);
    expect(lapsed.state).toBe(State.Relearning);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.stability).toBeLessThan(g.stability);
    expect(lapsed.due - dueAt).toBe(5 * MIN_MS);
    const back = review(lapsed, 3, dueAt + 5 * MIN_MS);
    expect(back.state).toBe(State.Review);
    expect(back.scheduledDays).toBeGreaterThanOrEqual(1);
  });
});

describe('schedule(): review cards', () => {
  const start = (): SchedFields => review(review(newSchedFields(T0), 3, T0), 3, T0 + 10 * MIN_MS);

  it('intervals are ordered Hard < Good < Easy and at least a day apart', () => {
    const c = start();
    const at = c.due;
    const [, hard, good, easy] = [0, 2, 3, 4].map((r) => (r ? review(c, r as Rating, at).scheduledDays : 0));
    expect(hard).toBeGreaterThanOrEqual(1);
    expect(good).toBeGreaterThan(hard);
    expect(easy).toBeGreaterThan(good);
  });

  it('repeated Good reviews on the due date make intervals grow', () => {
    let c = start();
    let now = c.due;
    const intervals: number[] = [];
    for (let i = 0; i < 8; i++) {
      c = review(c, 3, now);
      intervals.push(c.scheduledDays);
      now = c.due;
    }
    for (let i = 1; i < intervals.length; i++) expect(intervals[i]).toBeGreaterThan(intervals[i - 1]);
    expect(intervals[intervals.length - 1]).toBeGreaterThan(100);
  });

  it('a card reviewed on time with Good keeps stability growing and reps counted', () => {
    const c = start();
    const next = review(c, 3, c.due);
    expect(next.stability).toBeGreaterThan(c.stability);
    expect(next.reps).toBe(c.reps + 1);
    expect(next.lapses).toBe(0);
  });

  it('respects the maximum interval', () => {
    let c = start();
    let now = c.due;
    const p = makeParams({ maximumInterval: 30 });
    for (let i = 0; i < 12; i++) {
      c = schedule(c, 4, now, p).card;
      now = c.due;
    }
    expect(c.scheduledDays).toBeLessThanOrEqual(30);
  });

  it('is deterministic: same input, same output', () => {
    const c = start();
    expect(schedule(c, 3, c.due)).toEqual(schedule(c, 3, c.due));
  });

  it('does not mutate its input', () => {
    const c = start();
    const copy = { ...c };
    schedule(c, 1, c.due);
    expect(c).toEqual(copy);
  });

  it('due dates land on local midnight so a card is "due today" any time that day', () => {
    const c = start();
    const d = new Date(c.due);
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0]);
  });

  it('simulated learner: a fixed 90% requested retention yields about 90% recall when memory follows the model', () => {
    // Deterministic "expected value" simulation: recall probability at review time is R(t,S).
    let c = start();
    let now = c.due;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 10; i++) {
      const r = c.lastReview === null ? 1 : retrievability((now - c.lastReview) / DAY_MS, c.stability);
      sum += r;
      n++;
      c = review(c, 3, now);
      now = c.due;
    }
    expect(sum / n).toBeGreaterThan(0.85);
    expect(sum / n).toBeLessThan(0.97);
  });
});

describe('preview() and formatInterval()', () => {
  it('previews all four buttons without changing the card', () => {
    const c = newSchedFields(T0);
    const p = preview(c, T0);
    expect(p.map((x) => x.rating)).toEqual([1, 2, 3, 4]);
    expect(p[0].intervalMs).toBe(MIN_MS);
    expect(p[2].intervalMs).toBe(10 * MIN_MS);
    expect(p[3].intervalMs).toBeGreaterThan(DAY_MS);
    expect(c.state).toBe(State.New);
  });

  it('formats intervals compactly', () => {
    expect(formatInterval(30_000)).toBe('<1m');
    expect(formatInterval(10 * MIN_MS)).toBe('10m');
    expect(formatInterval(3 * 3_600_000)).toBe('3h');
    expect(formatInterval(4 * DAY_MS)).toBe('4d');
    expect(formatInterval(90 * DAY_MS)).toBe('3mo');
    expect(formatInterval(800 * DAY_MS)).toBe('2.2y');
  });
});
