import { h, toast, type Screen } from '../dom';
import * as db from '../db';
import { buildQueue } from '../scheduler';
import { getSettings } from '../settings';
import { setScreenKeys } from '../keys';
import { newSchedFields } from '../scheduler';
import type { Card, Deck } from '../types';
import { emptyState, relTime, SAMPLE_CARDS } from './common';

interface DeckRow {
  deck: Deck;
  total: number;
  learning: number;
  due: number;
  fresh: number;
}

export async function decksScreen(): Promise<Screen> {
  const now = Date.now();
  const [decks, cards, lastBackup] = await Promise.all([db.listDecks(), db.listCards(), db.getMeta<number>('lastBackup')]);
  const byDeck = new Map<string, Card[]>();
  for (const c of cards) {
    const l = byDeck.get(c.deckId) ?? [];
    l.push(c);
    byDeck.set(c.deckId, l);
  }
  const rows: DeckRow[] = await Promise.all(
    decks.map(async (deck) => {
      const list = byDeck.get(deck.id) ?? [];
      const today = await db.todayCounts(deck.id, now);
      const q = buildQueue(list, {
        now,
        newPerDay: deck.newPerDay,
        newDoneToday: today.newDone,
        reviewsPerDay: deck.reviewsPerDay,
        reviewsDoneToday: today.reviewsDone,
      });
      return { deck, total: list.length, learning: q.learning.length, due: q.review.length, fresh: q.newCards.length };
    }),
  );

  const el = h('section', { class: 'screen' });

  const nameInput = h('input', { type: 'text', placeholder: 'New deck name', 'aria-label': 'New deck name', maxLength: 120 });
  const create = async () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    const deck = await db.createDeck(name, getSettings());
    location.hash = `#/deck/${deck.id}`;
  };
  const form = h(
    'form',
    { class: 'row new-deck', onsubmit: (e: Event) => { e.preventDefault(); void create(); } },
    nameInput,
    h('button', { class: 'btn primary', type: 'submit' }, 'Create deck'),
  );

  el.append(h('div', { class: 'page-head' }, h('h1', null, 'Your decks'), form));

  const needsBackup = cards.length > 0 && (!lastBackup || now - lastBackup > 14 * 86_400_000);
  if (needsBackup) {
    el.append(
      h(
        'div',
        { class: 'banner' },
        h('span', null, `Your decks live only in this browser. Last backup: ${relTime(lastBackup, now)}.`),
        h('a', { class: 'btn small', href: '#/settings' }, 'Back up now'),
      ),
    );
  }

  if (!rows.length) {
    el.append(
      emptyState(
        'No decks yet',
        'Create a deck above, paste a Quizlet export, or try a small sample deck to see how studying works.',
        h('a', { class: 'btn primary', href: '#/import' }, 'Import from Quizlet'),
        h(
          'button',
          {
            class: 'btn',
            onclick: async () => {
              const deck = await db.createDeck('Cell biology (sample)', getSettings());
              const t = Date.now();
              await db.putCards(
                SAMPLE_CARDS.map(([front, back], i) => ({
                  id: db.uid(),
                  deckId: deck.id,
                  front,
                  back,
                  createdAt: t + i,
                  updatedAt: t,
                  ...newSchedFields(t),
                })),
              );
              toast('Sample deck added.');
              location.hash = `#/deck/${deck.id}`;
            },
          },
          'Add a sample deck',
        ),
      ),
    );
  } else {
    const list = h('ul', { class: 'deck-list' });
    for (const r of rows) {
      const total = r.fresh + r.learning + r.due;
      list.append(
        h(
          'li',
          { class: 'deck' },
          h(
            'a',
            { class: 'deck-main', href: `#/deck/${r.deck.id}` },
            h('span', { class: 'deck-name' }, r.deck.name),
            h('span', { class: 'muted' }, `${r.total} card${r.total === 1 ? '' : 's'}`),
          ),
          h(
            'div',
            { class: 'counts', 'aria-label': `${r.fresh} new, ${r.learning} learning, ${r.due} due` },
            h('span', { class: 'cnt c-new', title: 'New cards today' }, String(r.fresh)),
            h('span', { class: 'cnt c-learn', title: 'In learning' }, String(r.learning)),
            h('span', { class: 'cnt c-due', title: 'Reviews due' }, String(r.due)),
          ),
          h(
            'a',
            { class: 'btn ' + (total ? 'primary' : ''), href: `#/study/${r.deck.id}/flip` },
            total ? `Study ${total}` : 'Practice',
          ),
        ),
      );
    }
    el.append(list, h('p', { class: 'muted legend' }, h('span', { class: 'cnt c-new' }, 'new'), ' ', h('span', { class: 'cnt c-learn' }, 'learning'), ' ', h('span', { class: 'cnt c-due' }, 'due')));
  }

  setScreenKeys((e) => {
    if (e.key === 'n' && !e.repeat) {
      nameInput.focus();
      return true;
    }
    return false;
  });
  return { el };
}
