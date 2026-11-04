/**
 * FSRS-4.5 scheduler (Free Spaced Repetition Scheduler), implemented from the published
 * algorithm with the default 17 weights, plus short learning/relearning steps in minutes
 * (the same shape ts-fsrs and the Anki add-on use). No fuzzing, so results are deterministic.
 *
 * Memory model: each card has stability S (days for retrievability to fall to 90%) and
 * difficulty D (1..10). Retrievability R(t, S) = (1 + FACTOR * t / S) ^ DECAY.
 */
import { State, type Rating, type SchedFields } from './types';

export const DEFAULT_W: readonly number[] = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072,
  0.0793, 0.3246, 1.587, 0.2272, 2.8755,
];
export const DECAY = -0.5;
export const FACTOR = 19 / 81;
export const DAY_MS = 86_400_000;
export const MIN_MS = 60_000;

/** Minutes until the next try inside the learning phase. */
export const NEW_STEPS_MIN = { 1: 1, 2: 5, 3: 10 } as const; // first look at a new card: Again/Hard/Good
export const LEARN_AGAIN_MIN = 5;
export const LEARN_HARD_MIN = 10;
export const LAPSE_STEP_MIN = 5;

export interface FsrsParams {
  w: readonly number[];
  requestRetention: number;
  maximumInterval: number;
}

export function makeParams(over: Partial<FsrsParams> = {}): FsrsParams {
  return { w: DEFAULT_W, requestRetention: 0.9, maximumInterval: 36500, ...over };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function retrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0;
  return Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / stability, DECAY);
}

/** Days until retrievability decays to `retention`; whole days, at least 1. */
export function intervalFor(stability: number, retention: number, maxInterval: number): number {
  const raw = (stability / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
  return clamp(Math.round(raw), 1, maxInterval);
}

export function initStability(w: readonly number[], g: Rating): number {
  return Math.max(w[g - 1], 0.1);
}
export function initDifficulty(w: readonly number[], g: Rating): number {
  return clamp(w[4] - (g - 3) * w[5], 1, 10);
}
export function nextDifficulty(w: readonly number[], d: number, g: Rating): number {
  const next = d - w[6] * (g - 3);
  // mean reversion towards the difficulty of a "Good" first review
  return clamp(w[7] * w[4] + (1 - w[7]) * next, 1, 10);
}
export function nextRecallStability(w: readonly number[], d: number, s: number, r: number, g: Rating): number {
  const hardPenalty = g === 2 ? w[15] : 1;
  const easyBonus = g === 4 ? w[16] : 1;
  return (
    s *
    (1 +
      Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp((1 - r) * w[10]) - 1) * hardPenalty * easyBonus)
  );
}
export function nextForgetStability(w: readonly number[], d: number, s: number, r: number): number {
  const next = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]);
  return clamp(Math.min(next, s), 0.1, 36500);
}

/** Local midnight `days` days after the day containing `ts` (DST-safe). */
export function dayStartPlus(ts: number, days: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export interface ScheduleResult {
  card: SchedFields;
  elapsedDays: number;
  scheduledDays: number;
}

type Ladder = { 2: number; 3: number; 4: number };

/** Hard < Good < Easy interval ordering, as in the reference implementations. */
function ladder(stab: Ladder, p: FsrsParams): Ladder {
  const f = (s: number) => intervalFor(s, p.requestRetention, p.maximumInterval);
  let hard = f(stab[2]);
  let good = f(stab[3]);
  let easy = f(stab[4]);
  hard = Math.min(hard, good);
  good = Math.max(good, hard + 1);
  easy = Math.max(easy, good + 1);
  const max = Math.max(p.maximumInterval, 1);
  return { 2: Math.min(hard, max), 3: Math.min(good, max), 4: Math.min(easy, max) };
}

export function schedule(card: SchedFields, rating: Rating, now: number, params: FsrsParams = makeParams()): ScheduleResult {
  const w = params.w;
  const elapsed = card.lastReview == null ? 0 : Math.max(0, (now - card.lastReview) / DAY_MS);
  let s = card.stability;
  let d = card.difficulty;
  let lapses = card.lapses;
  let state: State = card.state;
  let due = now;
  let scheduledDays = 0;

  const graduate = (stab: Ladder) => {
    const iv = ladder(stab, params);
    const g = rating as 2 | 3 | 4;
    s = stab[g];
    scheduledDays = iv[g];
    state = State.Review;
    due = dayStartPlus(now, scheduledDays);
  };

  if (card.state === State.New) {
    d = initDifficulty(w, rating);
    s = initStability(w, rating);
    if (rating === 4) {
      graduate({ 2: initStability(w, 2), 3: initStability(w, 3), 4: initStability(w, 4) });
    } else {
      state = State.Learning;
      due = now + NEW_STEPS_MIN[rating as 1 | 2 | 3] * MIN_MS;
    }
  } else {
    const r = retrievability(elapsed, card.stability);
    const oldD = card.difficulty;
    const oldS = card.stability;
    d = nextDifficulty(w, oldD, rating);
    const recall = (g: Rating) => nextRecallStability(w, oldD, oldS, r, g);
    if (card.state === State.Review) {
      if (rating === 1) {
        s = nextForgetStability(w, oldD, oldS, r);
        lapses += 1;
        state = State.Relearning;
        due = now + LAPSE_STEP_MIN * MIN_MS;
      } else {
        graduate({ 2: recall(2), 3: recall(3), 4: recall(4) });
      }
    } else {
      // Learning or Relearning: short steps until Good/Easy graduates the card
      s = oldS;
      if (rating === 1) due = now + LEARN_AGAIN_MIN * MIN_MS;
      else if (rating === 2) due = now + LEARN_HARD_MIN * MIN_MS;
      else graduate({ 2: recall(2), 3: recall(3), 4: recall(4) });
    }
  }

  return {
    card: {
      state,
      due,
      stability: s,
      difficulty: d,
      reps: card.reps + 1,
      lapses,
      lastReview: now,
      scheduledDays,
    },
    elapsedDays: elapsed,
    scheduledDays,
  };
}

export interface RatingPreview {
  rating: Rating;
  due: number;
  intervalMs: number;
}

/** What each button would do right now (for the "10m / 3d" labels under the buttons). */
export function preview(card: SchedFields, now: number, params: FsrsParams = makeParams()): RatingPreview[] {
  return ([1, 2, 3, 4] as Rating[]).map((rating) => {
    const { card: next } = schedule(card, rating, now, params);
    return { rating, due: next.due, intervalMs: Math.max(0, next.due - now) };
  });
}

export function formatInterval(ms: number): string {
  const min = ms / MIN_MS;
  if (min < 1) return '<1m';
  if (min < 60) return `${Math.round(min)}m`;
  const hours = min / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${(days / 30.4).toFixed(1).replace(/\.0$/, '')}mo`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, '')}y`;
}
