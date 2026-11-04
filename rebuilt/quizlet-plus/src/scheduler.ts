/**
 * Daily queue and in-session card order. Pure functions: the DB layer feeds them cards and
 * the count of cards already introduced/reviewed today.
 */
import { dayStartPlus, DAY_MS } from './fsrs';
import { State, type Card, type SchedFields } from './types';

export const LEARN_AHEAD_MS = 20 * 60_000;

export function startOfDay(ts: number): number {
  return dayStartPlus(ts, 0);
}
/** First millisecond of tomorrow (local time). Cards due before this are "due today". */
export function endOfDay(ts: number): number {
  return dayStartPlus(ts, 1);
}

export function newSchedFields(now: number): SchedFields {
  return {
    state: State.New,
    due: now,
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    lastReview: null,
    scheduledDays: 0,
  };
}

export interface QueueOptions {
  now: number;
  /** new cards allowed per day for this deck */
  newPerDay: number;
  /** new cards already first-reviewed today */
  newDoneToday: number;
  /** review cards allowed per day for this deck */
  reviewsPerDay: number;
  /** review-state cards already reviewed today */
  reviewsDoneToday: number;
}

export interface DailyQueue {
  learning: Card[];
  review: Card[];
  newCards: Card[];
  /** total new cards waiting in the deck, ignoring the daily cap */
  newAvailable: number;
}

/** Which cards are up today: learning steps due soon, reviews due before midnight, then capped new cards. */
export function buildQueue(cards: Card[], opts: QueueOptions): DailyQueue {
  const eod = endOfDay(opts.now);
  const learning: Card[] = [];
  const review: Card[] = [];
  const fresh: Card[] = [];
  for (const c of cards) {
    if (c.state === State.New) fresh.push(c);
    else if (c.state === State.Learning || c.state === State.Relearning) {
      if (c.due <= opts.now + LEARN_AHEAD_MS || c.due < eod) learning.push(c);
    } else if (c.due < eod) review.push(c);
  }
  learning.sort((a, b) => a.due - b.due);
  review.sort((a, b) => a.due - b.due || a.createdAt - b.createdAt);
  fresh.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const newLeft = Math.max(0, opts.newPerDay - opts.newDoneToday);
  const reviewLeft = Math.max(0, opts.reviewsPerDay - opts.reviewsDoneToday);
  return {
    learning,
    review: review.slice(0, reviewLeft),
    newCards: fresh.slice(0, newLeft),
    newAvailable: fresh.length,
  };
}

export function queueTotal(q: DailyQueue): number {
  return q.learning.length + q.review.length + q.newCards.length;
}

/**
 * In-session ordering. Learning cards whose step has elapsed come first; then reviews and new
 * cards; when only learning cards remain they are shown early rather than making you wait.
 */
export class Session {
  learning: Card[];
  main: Card[];

  constructor(q: DailyQueue) {
    this.learning = [...q.learning];
    this.main = [...q.review, ...q.newCards];
  }

  static fromCards(cards: Card[]): Session {
    const s = new Session({ learning: [], review: [], newCards: [], newAvailable: 0 });
    s.main = [...cards];
    return s;
  }

  get remaining(): number {
    return this.learning.length + this.main.length;
  }

  pick(now: number): Card | null {
    this.learning.sort((a, b) => a.due - b.due);
    if (this.learning.length && this.learning[0].due <= now) return this.learning.shift()!;
    if (this.main.length) return this.main.shift()!;
    if (this.learning.length) return this.learning.shift()!;
    return null;
  }

  /** After a rating: cards still in a learning step come back later this session. */
  requeue(updated: Card, now: number): void {
    if ((updated.state === State.Learning || updated.state === State.Relearning) && updated.due < endOfDay(now)) {
      this.learning.push(updated);
    }
  }

  /** Put a card back at the front (undo). */
  unshift(card: Card): void {
    this.learning = this.learning.filter((c) => c.id !== card.id);
    this.main = this.main.filter((c) => c.id !== card.id);
    this.main.unshift(card);
  }
}

export function daysBetween(a: number, b: number): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
}

/** Cards due on each of the next `days` local days (index 0 = today, includes overdue). */
export function forecast(cards: Card[], now: number, days: number): number[] {
  const out = new Array<number>(days).fill(0);
  const today = startOfDay(now);
  for (const c of cards) {
    if (c.state === State.New) continue;
    const idx = Math.max(0, Math.floor((startOfDay(c.due) - today) / DAY_MS + 0.5));
    if (idx < days) out[idx] += 1;
  }
  return out;
}
