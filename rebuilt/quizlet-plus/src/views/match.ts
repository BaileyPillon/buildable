import { h, clear, type Screen } from '../dom';
import * as db from '../db';
import { shuffle } from '../answers';
import { UrlBag } from '../images';
import { setScreenKeys } from '../keys';
import type { Card } from '../types';

const LABELS = '1234567890abcdef';

interface Tile {
  key: string;
  pairId: string;
  text: string;
  image?: Blob;
  side: 'front' | 'back';
}

const fmt = (ms: number) => {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};

export async function matchScreen(deckId: string, query: URLSearchParams): Promise<Screen> {
  const deck = await db.getDeck(deckId);
  if (!deck) return { el: h('div', { class: 'panel error' }, h('h2', null, 'Deck not found'), h('a', { class: 'btn', href: '#/' }, 'Back to decks')) };
  const cards = (await db.listCards(deckId)).filter((c) => (c.front || c.frontImage) && (c.back || c.backImage));
  const bag = new UrlBag();
  const el = h('section', { class: 'screen match' });
  let pairs = Number(query.get('pairs')) || 6;
  let timer = 0;
  let keyHandler: ((k: string) => void) | null = null;

  const stop = () => window.clearInterval(timer);

  async function best(n: number): Promise<number | undefined> {
    return db.getMeta<number>(`best:${deckId}:${n}`);
  }

  async function start() {
    stop();
    bag.dispose();
    clear(el);
    el.append(h('a', { class: 'back', href: `#/deck/${deckId}` }, `← ${deck!.name}`), h('h1', null, 'Matching game'));
    if (cards.length < 3) {
      el.append(h('div', { class: 'panel' }, h('p', null, 'You need at least 3 cards in the deck to play.'), h('a', { class: 'btn', href: `#/deck/${deckId}` }, 'Back to deck')));
      return;
    }
    pairs = Math.min(pairs, cards.length, 8);
    const picks: Card[] = shuffle(cards).slice(0, pairs);
    const tiles: Tile[] = shuffle(
      picks.flatMap<Tile>((c) => [
        { key: c.id + 'f', pairId: c.id, text: c.front, image: c.frontImage, side: 'front' },
        { key: c.id + 'b', pairId: c.id, text: c.back, image: c.backImage, side: 'back' },
      ]),
    );
    const bestTime = await best(pairs);

    const clock = h('div', { class: 'clock', 'aria-live': 'off' }, '0:00.0');
    const misses = h('div', { class: 'muted' }, 'Misses: 0');
    const picker = h('select', { 'aria-label': 'Number of pairs' }, [4, 6, 8].filter((n) => n <= Math.max(4, cards.length)).map((n) => h('option', { value: String(n), selected: n === pairs || undefined }, `${n} pairs`)));
    picker.addEventListener('change', () => {
      pairs = Number(picker.value);
      void start();
    });
    el.append(
      h('div', { class: 'match-head' }, clock, misses, picker, h('button', { class: 'btn small', onclick: () => void start() }, 'Restart'), bestTime ? h('span', { class: 'muted' }, `Best: ${fmt(bestTime)}`) : null),
      h('p', { class: 'muted' }, 'Match each front with its back as fast as you can. The clock starts on your first pick.'),
    );

    const grid = h('div', { class: 'tiles', style: `--cols:${tiles.length > 12 ? 4 : tiles.length > 8 ? 4 : 3}` });
    el.append(grid);

    let first: { tile: Tile; btn: HTMLButtonElement } | null = null;
    let matched = 0;
    let wrong = 0;
    let started = 0;
    let lock = false;
    const buttons = new Map<string, HTMLButtonElement>();

    tiles.forEach((t, i) => {
      const btn = h(
        'button',
        { class: 'tile', 'aria-label': t.text || 'image tile' },
        h('kbd', null, LABELS[i] ?? ''),
        t.image ? h('img', { src: bag.url(t.image), alt: '' }) : null,
        t.text ? h('span', null, t.text) : null,
      );
      btn.addEventListener('click', () => pick(t, btn));
      buttons.set(t.key, btn);
      grid.append(btn);
    });

    function pick(t: Tile, btn: HTMLButtonElement) {
      if (lock || btn.classList.contains('matched')) return;
      if (!started) {
        started = performance.now();
        timer = window.setInterval(() => (clock.textContent = fmt(performance.now() - started)), 100);
      }
      if (first && first.btn === btn) {
        btn.classList.remove('selected');
        first = null;
        return;
      }
      if (!first) {
        first = { tile: t, btn };
        btn.classList.add('selected');
        return;
      }
      const a = first;
      first = null;
      if (a.tile.pairId === t.pairId && a.tile.side !== t.side) {
        for (const b of [a.btn, btn]) {
          b.classList.remove('selected');
          b.classList.add('matched');
          b.disabled = true;
        }
        matched += 1;
        if (matched === pairs) void win();
      } else {
        wrong += 1;
        misses.textContent = `Misses: ${wrong}`;
        lock = true;
        btn.classList.add('wrong');
        a.btn.classList.add('wrong');
        window.setTimeout(() => {
          for (const b of [a.btn, btn]) b.classList.remove('wrong', 'selected');
          lock = false;
        }, 600);
      }
    }

    async function win() {
      stop();
      const ms = performance.now() - started;
      clock.textContent = fmt(ms);
      const prev = await best(pairs);
      const record = !prev || ms < prev;
      if (record) await db.setMeta(`best:${deckId}:${pairs}`, Math.round(ms));
      el.append(
        h(
          'div',
          { class: 'panel done' },
          h('h2', null, record ? 'New best time!' : 'Cleared'),
          h('p', null, `${fmt(ms)} with ${wrong} miss${wrong === 1 ? '' : 'es'}.`),
          h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => void start() }, 'Play again'), h('a', { class: 'btn', href: `#/deck/${deckId}` }, 'Back to deck')),
        ),
      );
    }

    keyHandler = (k) => {
      const i = LABELS.indexOf(k);
      if (i < 0 || i >= tiles.length) return;
      const t = tiles[i];
      const b = buttons.get(t.key);
      if (b) pick(t, b);
    };
  }

  setScreenKeys((e) => {
    if (e.key === 'Escape') {
      location.hash = `#/deck/${deckId}`;
      return true;
    }
    if (e.key === 'r') {
      void start();
      return true;
    }
    if (keyHandler && e.key.length === 1 && LABELS.includes(e.key)) {
      keyHandler(e.key);
      return true;
    }
    return false;
  });

  await start();
  return { el, destroy: () => { stop(); bag.dispose(); } };
}
