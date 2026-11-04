import { describe, expect, it } from 'vitest';
import { MIN_MS, schedule } from '../src/fsrs';
import { Session, buildQueue, endOfDay, forecast, newSchedFields, queueTotal, startOfDay } from '../src/scheduler';
import { State, type Card } from '../src/types';

const NOW = new Date(2026, 0, 10, 12, 0, 0).getTime();
const DAY = 86_400_000;

let seq = 0;
function mk(over: Partial<Card> = {}): Card {
  seq += 1;
  return {
    id: `c${String(seq).padStart(3, '0')}`,
    deckId: 'd',
    front: `f${seq}`,
    back: `b${seq}`,
    createdAt: seq,
    updatedAt: seq,
    ...newSchedFields(NOW),
    ...over,
  };
}
const opts = { now: NOW, newPerDay: 20, newDoneToday: 0, reviewsPerDay: 200, reviewsDoneToday: 0 };

describe('buildQueue', () => {
  it('caps new cards at the daily limit, in creation order', () => {
    const cards = Array.from({ length: 30 }, () => mk());
    const q = buildQueue(cards, { ...opts, newPerDay: 5 });
    expect(q.newCards).toHaveLength(5);
    expect(q.newCards.map((c) => c.id)).toEqual(cards.slice(0, 5).map((c) => c.id));
    expect(q.newAvailable).toBe(30);
  });

  it('subtracts new cards already introduced today', () => {
    const cards = Array.from({ length: 10 }, () => mk());
    expect(buildQueue(cards, { ...opts, newPerDay: 5, newDoneToday: 3 }).newCards).toHaveLength(2);
    expect(buildQueue(cards, { ...opts, newPerDay: 5, newDoneToday: 9 }).newCards).toHaveLength(0);
  });

  it('a limit of zero means no new cards', () => {
    expect(buildQueue([mk(), mk()], { ...opts, newPerDay: 0 }).newCards).toHaveLength(0);
  });

  it('includes reviews due before midnight tonight and excludes ones due tomorrow', () => {
    const overdue = mk({ state: State.Review, due: startOfDay(NOW) - 3 * DAY, stability: 5, difficulty: 5 });
    const today = mk({ state: State.Review, due: startOfDay(NOW), stability: 5, difficulty: 5 });
    const tomorrow = mk({ state: State.Review, due: endOfDay(NOW), stability: 5, difficulty: 5 });
    const q = buildQueue([tomorrow, today, overdue], opts);
    expect(q.review.map((c) => c.id)).toEqual([overdue.id, today.id]);
  });

  it('caps reviews per day', () => {
    const cards = Array.from({ length: 10 }, (_, i) => mk({ state: State.Review, due: NOW - i * DAY - DAY, stability: 5, difficulty: 5 }));
    const q = buildQueue(cards, { ...opts, reviewsPerDay: 4, reviewsDoneToday: 1 });
    expect(q.review).toHaveLength(3);
  });

  it('learning cards due within the learn-ahead window are queued; far-future ones are not', () => {
    const soon = mk({ state: State.Learning, due: NOW + 5 * MIN_MS });
    const later = mk({ state: State.Learning, due: endOfDay(NOW) + 2 * DAY });
    const q = buildQueue([later, soon], opts);
    expect(q.learning.map((c) => c.id)).toEqual([soon.id]);
    expect(queueTotal(q)).toBe(1);
  });
});

describe('Session', () => {
  it('serves due learning cards first, then reviews, then new cards', () => {
    const learning = mk({ state: State.Learning, due: NOW - MIN_MS });
    const review = mk({ state: State.Review, due: NOW - DAY, stability: 5, difficulty: 5 });
    const fresh = mk();
    const s = new Session(buildQueue([fresh, review, learning], opts));
    expect(s.pick(NOW)?.id).toBe(learning.id);
    expect(s.pick(NOW)?.id).toBe(review.id);
    expect(s.pick(NOW)?.id).toBe(fresh.id);
    expect(s.pick(NOW)).toBeNull();
  });

  it('a card rated Again returns later in the session instead of vanishing', () => {
    const fresh = mk();
    const other = mk();
    const s = new Session(buildQueue([fresh, other], opts));
    const first = s.pick(NOW)!;
    const updated: Card = { ...first, ...schedule(first, 1, NOW).card };
    s.requeue(updated, NOW);
    expect(s.pick(NOW)?.id).toBe(other.id);
    // only the learning card is left: shown early rather than blocking the session
    expect(s.pick(NOW)?.id).toBe(first.id);
    expect(s.pick(NOW)).toBeNull();
  });

  it('a graduated card is not requeued', () => {
    const fresh = mk();
    const s = new Session(buildQueue([fresh], opts));
    const c = s.pick(NOW)!;
    const updated: Card = { ...c, ...schedule(c, 4, NOW).card };
    s.requeue(updated, NOW);
    expect(s.pick(NOW)).toBeNull();
  });

  it('undo puts a card back at the front without duplicating it', () => {
    const a = mk();
    const b = mk();
    const s = new Session(buildQueue([a, b], opts));
    const first = s.pick(NOW)!;
    s.unshift(first);
    expect(s.remaining).toBe(2);
    expect(s.pick(NOW)?.id).toBe(first.id);
  });
});

describe('forecast', () => {
  it('buckets cards by due day and ignores new cards; overdue counts as today', () => {
    const cards = [
      mk({ state: State.Review, due: startOfDay(NOW) - 2 * DAY }),
      mk({ state: State.Review, due: startOfDay(NOW) + DAY }),
      mk({ state: State.Review, due: startOfDay(NOW) + DAY }),
      mk({ state: State.Review, due: startOfDay(NOW) + 20 * DAY }),
      mk(),
    ];
    expect(forecast(cards, NOW, 7)).toEqual([1, 2, 0, 0, 0, 0, 0]);
  });
});
