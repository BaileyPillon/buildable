/** Answer checking for "type the answer" and distractor choice for multiple choice. */
import type { Card, Rating } from './types';

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export type Verdict = 'correct' | 'close' | 'wrong';

/** A back like "big; large" or "big / large" accepts either alternative. */
export function acceptableAnswers(expected: string): string[] {
  const whole = normalize(expected);
  const parts = expected
    .split(/\s*(?:;|\/|\n)\s*/)
    .map(normalize)
    .filter(Boolean);
  return Array.from(new Set([whole, ...parts])).filter(Boolean);
}

export function checkAnswer(typed: string, expected: string): Verdict {
  const t = normalize(typed);
  if (!t) return 'wrong';
  const options = acceptableAnswers(expected);
  if (options.includes(t)) return 'correct';
  for (const o of options) {
    const allowed = o.length >= 12 ? 2 : o.length >= 5 ? 1 : 0;
    if (allowed && levenshtein(t, o) <= allowed) return 'close';
  }
  return 'wrong';
}

export function suggestedRating(v: Verdict): Rating {
  return v === 'correct' ? 3 : v === 'close' ? 2 : 1;
}

export function shuffle<T>(arr: readonly T[], rand: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface ChoiceOption {
  cardId: string;
  text: string;
  image?: Blob;
  correct: boolean;
}

/**
 * Multiple choice built from the other cards in the deck. `side` is the side shown as answer.
 * Returns null when there are not enough distinct wrong answers (caller falls back to flip).
 */
export function buildChoices(
  card: Card,
  deck: readonly Card[],
  side: 'front' | 'back',
  count = 4,
  rand: () => number = Math.random,
): ChoiceOption[] | null {
  const textOf = (c: Card) => (side === 'front' ? c.front : c.back);
  const imgOf = (c: Card) => (side === 'front' ? c.frontImage : c.backImage);
  const answerKey = normalize(textOf(card));
  const seen = new Set<string>([answerKey]);
  const pool: Card[] = [];
  for (const c of shuffle(deck, rand)) {
    if (c.id === card.id) continue;
    const text = textOf(c);
    const key = normalize(text) || `img:${c.id}`;
    if (!text.trim() && !imgOf(c)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    pool.push(c);
  }
  if (pool.length < 1) return null;
  const wrong = pool.slice(0, count - 1).map<ChoiceOption>((c) => ({
    cardId: c.id,
    text: textOf(c),
    image: imgOf(c),
    correct: false,
  }));
  const right: ChoiceOption = { cardId: card.id, text: textOf(card), image: imgOf(card), correct: true };
  return shuffle([right, ...wrong], rand);
}
