import { h, type Screen } from '../dom';
import * as db from '../db';
import { forecast } from '../scheduler';
import { buildHeatmap, computeRetention, computeStreak, countByDay, summarize } from '../stats';

const pct = (r: number | null) => (r === null ? 'n/a' : `${Math.round(r * 100)}%`);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export async function statsScreen(deckId: string): Promise<Screen> {
  const now = Date.now();
  const decks = await db.listDecks();
  if (deckId && !decks.some((d) => d.id === deckId)) deckId = '';
  const [cards, reviews] = await Promise.all([db.listCards(deckId || undefined), db.listReviews(undefined, deckId || undefined)]);

  const counts = countByDay(reviews);
  const streak = computeStreak(counts, now);
  const r30 = computeRetention(reviews, now, 30);
  const rAll = computeRetention(reviews, now);
  const sum = summarize(cards);
  const todayKey = new Date(now);
  const today = reviews.filter((r) => new Date(r.ts).toDateString() === todayKey.toDateString()).length;
  const grid = buildHeatmap(counts, now, 53);
  const f = forecast(cards, now, 14);
  const fmax = Math.max(1, ...f);

  const select = h(
    'select',
    { 'aria-label': 'Deck filter' },
    h('option', { value: '' }, 'All decks'),
    decks.map((d) => h('option', { value: d.id, selected: d.id === deckId || undefined }, d.name)),
  );
  select.addEventListener('change', () => (location.hash = `#/stats${select.value ? `?deck=${select.value}` : ''}`));

  const monthRow = h('div', { class: 'months' });
  let lastMonth = -1;
  grid.forEach((col, i) => {
    const first = col.find((c) => c.inRange) ?? col[0];
    const m = Number(first.key.slice(5, 7)) - 1;
    if (m !== lastMonth && i < grid.length - 1) {
      monthRow.append(h('span', { style: `grid-column:${i + 1}` }, MONTHS[m]));
      lastMonth = m;
    }
  });

  const heat = h(
    'div',
    { class: 'heatmap', role: 'img', 'aria-label': `Review heatmap: ${reviews.length} reviews over the last year` },
    grid.map((col) =>
      h(
        'div',
        { class: 'hcol' },
        col.map((c) => h('i', { class: c.inRange ? `l${c.level}` : 'out', title: c.inRange ? `${c.key}: ${c.count} review${c.count === 1 ? '' : 's'}` : '' })),
      ),
    ),
  );

  const el = h(
    'section',
    { class: 'screen' },
    h('div', { class: 'page-head' }, h('h1', null, 'Stats'), h('label', { class: 'inline' }, 'Show ', select)),
    h(
      'div',
      { class: 'summary' },
      h('div', { class: 'tile' }, h('b', null, `${streak.current}`), h('span', null, `day streak${streak.current && !streak.studiedToday ? ' (study today to keep it)' : ''}`)),
      h('div', { class: 'tile' }, h('b', null, `${streak.longest}`), h('span', null, 'longest streak')),
      h('div', { class: 'tile' }, h('b', null, pct(r30.rate)), h('span', null, `retention, last 30 days (${r30.total} reviews)`)),
      h('div', { class: 'tile' }, h('b', null, pct(rAll.rate)), h('span', null, `retention, all time (${rAll.total})`)),
      h('div', { class: 'tile' }, h('b', null, String(today)), h('span', null, 'reviews today')),
      h('div', { class: 'tile' }, h('b', null, String(reviews.length)), h('span', null, 'reviews in total')),
    ),
    h('p', { class: 'muted' }, 'Retention counts answers on cards that were already in the review phase: anything but Again is a success. Aim for 85 to 95%.'),
    h('div', { class: 'panel' }, h('h2', null, 'Reviews per day, last 12 months'), h('div', { class: 'heat-wrap' }, monthRow, heat), h('div', { class: 'legend-heat' }, 'Less ', ...[0, 1, 2, 3, 4].map((l) => h('i', { class: `l${l}` })), ' More')),
    h(
      'div',
      { class: 'panel' },
      h('h2', null, 'Cards'),
      h(
        'div',
        { class: 'stack' },
        ...(
          [
            ['New', sum.newCards, 'c-new'],
            ['Learning', sum.learning, 'c-learn'],
            ['Young', sum.young, 'c-young'],
            ['Mature', sum.mature, 'c-mature'],
          ] as [string, number, string][]
        ).map(([label, n, cls]) => h('div', { class: `seg ${cls}`, style: `flex:${Math.max(n, 0.0001)}`, title: `${label}: ${n}` }, n ? `${label} ${n}` : '')),
      ),
      h('p', { class: 'muted' }, `${sum.total} cards. Mature means the memory is estimated to last 21 days or more.`),
    ),
    h(
      'div',
      { class: 'panel' },
      h('h2', null, 'Due in the next 14 days'),
      h('div', { class: 'bars' }, f.map((n, i) => h('div', { class: 'bar', title: `${i === 0 ? 'Today (with overdue)' : `+${i} day${i > 1 ? 's' : ''}`}: ${n}` }, h('i', { style: `height:${(n / fmax) * 100}%` }), h('span', null, String(n))))),
    ),
  );
  return { el };
}
