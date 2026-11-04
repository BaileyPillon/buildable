import { describe, expect, it } from 'vitest';
import { cardsToCsv, parseCsv, parseCsvCards, parseJsonImport, parseQuizlet } from '../src/io';
import { acceptableAnswers, buildChoices, checkAnswer, normalize, suggestedRating } from '../src/answers';
import { newSchedFields } from '../src/scheduler';
import type { Card } from '../src/types';

describe('Quizlet paste import', () => {
  it('splits on a tab between term and definition and a newline between cards', () => {
    const r = parseQuizletFixture();
    expect(r.cards).toEqual([
      { front: 'hello', back: 'bonjour' },
      { front: 'thank you', back: 'merci' },
      { front: 'a, b', back: 'c: d' },
    ]);
    expect(r.skipped).toHaveLength(0);
  });

  function parseQuizletFixture() {
    return parseQuizlet('hello\tbonjour\nthank you\tmerci\r\na, b\tc: d\n');
  }

  it('keeps extra tabs inside the definition and trims spaces', () => {
    const r = parseQuizlet('  term  \t  one\ttwo  ');
    expect(r.cards).toEqual([{ front: 'term', back: 'one\ttwo' }]);
  });

  it('skips blank lines silently and reports bad lines', () => {
    const r = parseQuizlet('a\tb\n\n   \nno separator here\nonly term\t\n\tonly def\nc\td');
    expect(r.cards.map((c) => c.front)).toEqual(['a', 'c']);
    expect(r.skipped.map((s) => s.line)).toEqual([4, 5, 6]);
  });

  it('supports custom term and row separators (Quizlet lets you pick them)', () => {
    const r = parseQuizlet('cat - chat;;dog - chien;;house - maison', ' - ', ';;');
    expect(r.cards).toEqual([
      { front: 'cat', back: 'chat' },
      { front: 'dog', back: 'chien' },
      { front: 'house', back: 'maison' },
    ]);
  });

  it('handles a leading BOM and keeps unicode', () => {
    const r = parseQuizlet('﻿日本語\tJapanese');
    expect(r.cards).toEqual([{ front: '日本語', back: 'Japanese' }]);
  });

  it('with a custom row separator, newlines inside a card become spaces', () => {
    const r = parseQuizlet('a\tline1\nline2;;b\tc', '\t', ';;');
    expect(r.cards).toEqual([
      { front: 'a', back: 'line1 line2' },
      { front: 'b', back: 'c' },
    ]);
  });
});

describe('CSV', () => {
  it('parses quotes, escaped quotes, commas and newlines inside fields', () => {
    const t = parseCsv('front,back\r\n"a, b","say ""hi"""\r\n"multi\nline",x\r\n');
    expect(t).toEqual([
      ['front', 'back'],
      ['a, b', 'say "hi"'],
      ['multi\nline', 'x'],
    ]);
  });

  it('detects semicolon and tab delimiters', () => {
    expect(parseCsv('a;b\nc;d')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseCsv('a\tb\nc\td')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('reads cards with or without a header, and a deck column', () => {
    expect(parseCsvCards('front,back\nq1,a1\nq2,a2').rows).toHaveLength(2);
    const noHeader = parseCsvCards('q1,a1\nq2,a2');
    expect(noHeader.hadHeader).toBe(false);
    expect(noHeader.rows).toHaveLength(2);
    const decks = parseCsvCards('deck,front,back\nFrench,chat,cat\nSpanish,gato,cat');
    expect(decks.rows.map((r) => r.deck)).toEqual(['French', 'Spanish']);
    expect(parseCsvCards('Term,Definition\nx,y').rows).toEqual([{ front: 'x', back: 'y' }]);
  });

  it('reports rows missing a side', () => {
    const r = parseCsvCards('a,b\nonly\n,x\nc,d');
    expect(r.rows).toHaveLength(2); // "a,b" has no header so it is a card
    expect(r.skipped).toHaveLength(2);
  });

  it('round-trips through export', () => {
    const cards = [
      { front: 'a, b', back: 'say "hi"' },
      { front: 'multi\nline', back: 'plain' },
    ];
    const csv = cardsToCsv(cards);
    expect(parseCsvCards(csv).rows).toEqual(cards);
    const withDeck = cardsToCsv(cards, 'My deck');
    expect(parseCsvCards(withDeck).rows.map((r) => r.deck)).toEqual(['My deck', 'My deck']);
  });
});

describe('JSON import', () => {
  it('accepts a bare array of front/back or term/definition objects', () => {
    const b = parseJsonImport('[{"front":"a","back":"b"},{"term":"c","definition":"d"},{"bad":1}]', 'Mine');
    expect(b.decks).toHaveLength(1);
    expect(b.decks[0].name).toBe('Mine');
    expect(b.decks[0].cards).toEqual([
      { front: 'a', back: 'b' },
      { front: 'c', back: 'd' },
    ]);
    expect(b.isBackup).toBe(false);
  });

  it('accepts a single deck object and a {decks:[]} object', () => {
    expect(parseJsonImport('{"name":"X","cards":[{"front":"a","back":"b"}]}').decks[0].name).toBe('X');
    expect(parseJsonImport('{"decks":[{"name":"A","cards":[{"front":"a","back":"b"}]},{"cards":[{"front":"c","back":"d"}]}]}').decks.map((d) => d.name)).toEqual(['A', 'Imported deck 2']);
  });

  it('keeps scheduling, ids and review history from a full backup', () => {
    const backup = {
      app: 'flashcards-plus',
      version: 1,
      decks: [
        {
          id: 'd1',
          name: 'Bio',
          newPerDay: 7,
          cards: [
            {
              id: 'c1',
              front: 'a',
              back: 'b',
              sched: { state: 2, due: 1000, stability: 4, difficulty: 5, reps: 3, lapses: 1, lastReview: 500, scheduledDays: 4 },
            },
            { id: 'c2', front: 'x', back: 'y', sched: { state: 9 } },
          ],
        },
      ],
      reviews: [
        { cardId: 'c1', deckId: 'd1', ts: 1, rating: 3, prevState: 2, state: 2, elapsedDays: 1, scheduledDays: 4, mode: 'flip', durationMs: 900 },
        { cardId: 'c1', deckId: 'd1', ts: 2, rating: 7, prevState: 2, state: 2 },
      ],
      settings: { requestRetention: 0.85 },
    };
    const b = parseJsonImport(JSON.stringify(backup));
    expect(b.isBackup).toBe(true);
    expect(b.decks[0].id).toBe('d1');
    expect(b.decks[0].newPerDay).toBe(7);
    expect(b.decks[0].cards[0].sched?.stability).toBe(4);
    expect(b.decks[0].cards[1].sched).toBeUndefined();
    expect(b.reviews).toHaveLength(1);
    expect(b.settings?.requestRetention).toBe(0.85);
  });

  it('keeps data: image URLs and drops other image strings', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const b = parseJsonImport(JSON.stringify([{ front: 'a', back: 'b', frontImage: png, backImage: 'http://evil.example/x.png' }]));
    expect(b.decks[0].cards[0].frontImage).toBe(png);
    expect(b.decks[0].cards[0].backImage).toBeUndefined();
  });

  it('allows an image-only side', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const b = parseJsonImport(JSON.stringify([{ front: '', frontImage: png, back: 'cell' }]));
    expect(b.decks[0].cards).toHaveLength(1);
  });

  it('gives friendly errors', () => {
    expect(() => parseJsonImport('not json')).toThrow(/valid JSON/);
    expect(() => parseJsonImport('[]')).toThrow(/No cards/);
    expect(() => parseJsonImport('{"hello":1}')).toThrow(/No decks/);
    expect(() => parseJsonImport('3')).toThrow(/Unrecognised/);
  });
});

describe('typed answers', () => {
  it('normalises case, accents, punctuation and spacing', () => {
    expect(normalize('  Café,  AU  lait! ')).toBe('cafe au lait');
  });

  it('marks exact, near and wrong answers', () => {
    expect(checkAnswer('Mitochondria', 'mitochondria')).toBe('correct');
    expect(checkAnswer('mitochondra', 'mitochondria')).toBe('close');
    expect(checkAnswer('ribosome', 'mitochondria')).toBe('wrong');
    expect(checkAnswer('', 'x')).toBe('wrong');
    expect(checkAnswer('cat', 'cut')).toBe('wrong'); // short words get no typo allowance
  });

  it('accepts any alternative separated by ; or /', () => {
    expect(acceptableAnswers('big; large / huge')).toContain('large');
    expect(checkAnswer('large', 'big; large / huge')).toBe('correct');
  });

  it('maps verdicts to suggested ratings', () => {
    expect([suggestedRating('correct'), suggestedRating('close'), suggestedRating('wrong')]).toEqual([3, 2, 1]);
  });
});

describe('multiple choice from other cards in the deck', () => {
  const card = (n: number, back = `answer ${n}`): Card => ({
    id: `c${n}`,
    deckId: 'd',
    front: `q${n}`,
    back,
    createdAt: n,
    updatedAt: n,
    ...newSchedFields(0),
  });
  const deck = Array.from({ length: 8 }, (_, i) => card(i + 1));

  it('returns four options with exactly one correct answer, all distinct', () => {
    const opts = buildChoices(deck[0], deck, 'back')!;
    expect(opts).toHaveLength(4);
    expect(opts.filter((o) => o.correct)).toHaveLength(1);
    expect(opts.find((o) => o.correct)!.text).toBe('answer 1');
    expect(new Set(opts.map((o) => o.text)).size).toBe(4);
  });

  it('never uses the card itself as a distractor and skips duplicate answers', () => {
    const dup = [card(1, 'same'), card(2, 'same'), card(3, 'Same'), card(4, 'other')];
    const opts = buildChoices(dup[0], dup, 'back')!;
    expect(opts.map((o) => o.text).sort()).toEqual(['other', 'same']);
  });

  it('uses fewer options in small decks and gives up when there are no alternatives', () => {
    expect(buildChoices(deck[0], deck.slice(0, 3), 'back')).toHaveLength(3);
    expect(buildChoices(deck[0], [deck[0]], 'back')).toBeNull();
  });

  it('can build choices from the front side for reversed study', () => {
    const opts = buildChoices(deck[2], deck, 'front')!;
    expect(opts.find((o) => o.correct)!.text).toBe('q3');
  });
});
