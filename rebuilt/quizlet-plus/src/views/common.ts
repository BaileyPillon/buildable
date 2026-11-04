import { h } from '../dom';
import type { UrlBag } from '../images';
import { formatInterval } from '../fsrs';
import { State, type Card } from '../types';

/** A card side: its text and/or its image. */
export function sideContent(text: string, image: Blob | undefined, bag: UrlBag, cls = ''): HTMLElement {
  return h(
    'div',
    { class: 'side ' + cls },
    image ? h('img', { class: 'card-img', src: bag.url(image), alt: text ? '' : 'Card image' }) : null,
    text ? h('div', { class: 'side-text' }, text) : null,
  );
}

export function cardStatus(card: Card, now = Date.now()): { label: string; cls: string } {
  switch (card.state) {
    case State.New:
      return { label: 'New', cls: 'b-new' };
    case State.Learning:
      return { label: 'Learning', cls: 'b-learn' };
    case State.Relearning:
      return { label: 'Relearning', cls: 'b-learn' };
    default:
      return card.due <= now
        ? { label: 'Due', cls: 'b-due' }
        : { label: `in ${formatInterval(card.due - now)}`, cls: 'b-ok' };
  }
}

export function badge(label: string, cls: string): HTMLElement {
  return h('span', { class: 'badge ' + cls }, label);
}

export function emptyState(title: string, body: string, ...actions: (Node | null)[]): HTMLElement {
  return h('div', { class: 'panel empty' }, h('h2', null, title), h('p', { class: 'muted' }, body), h('div', { class: 'row' }, actions));
}

export function relTime(ts: number | undefined, now = Date.now()): string {
  if (!ts) return 'never';
  const days = Math.floor((now - ts) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export const SAMPLE_CARDS: [string, string][] = [
  ['Mitochondria', 'The organelle that makes most of the cell’s ATP'],
  ['Ribosome', 'Builds proteins by reading mRNA'],
  ['Nucleus', 'Holds the cell’s DNA'],
  ['Golgi apparatus', 'Sorts and packages proteins for delivery'],
  ['Lysosome', 'Breaks down waste with digestive enzymes'],
  ['Endoplasmic reticulum', 'Folds proteins (rough) and makes lipids (smooth)'],
  ['Chloroplast', 'Where photosynthesis happens in plant cells'],
  ['Cell membrane', 'Controls what enters and leaves the cell'],
  ['Cytoplasm', 'Gel-like fluid that fills the cell'],
  ['Vacuole', 'Stores water, nutrients and waste'],
];
