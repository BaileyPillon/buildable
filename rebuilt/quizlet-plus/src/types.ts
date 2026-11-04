/** 1 Again, 2 Hard, 3 Good, 4 Easy */
export type Rating = 1 | 2 | 3 | 4;
/** 0 New, 1 Learning, 2 Review, 3 Relearning */
export type State = 0 | 1 | 2 | 3;

export const State = { New: 0, Learning: 1, Review: 2, Relearning: 3 } as const;
export const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 } as const;

/** The scheduling part of a card (what FSRS reads and writes). Times are ms since epoch. */
export interface SchedFields {
  state: State;
  due: number;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  lastReview: number | null;
  scheduledDays: number;
}

export interface Card extends SchedFields {
  id: string;
  deckId: string;
  front: string;
  back: string;
  frontImage?: Blob;
  backImage?: Blob;
  createdAt: number;
  updatedAt: number;
}

export interface Deck {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  newPerDay: number;
  reviewsPerDay: number;
}

export type StudyMode = 'flip' | 'type' | 'choice' | 'match';

export interface ReviewLog {
  id?: number;
  cardId: string;
  deckId: string;
  ts: number;
  rating: Rating;
  prevState: State;
  state: State;
  elapsedDays: number;
  scheduledDays: number;
  mode: StudyMode;
  durationMs: number;
}

export interface Settings {
  requestRetention: number;
  defaultNewPerDay: number;
  defaultReviewsPerDay: number;
  theme: 'auto' | 'light' | 'dark';
}

export const DEFAULT_SETTINGS: Settings = {
  requestRetention: 0.9,
  defaultNewPerDay: 20,
  defaultReviewsPerDay: 200,
  theme: 'auto',
};
