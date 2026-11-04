import { h, clear, toast, type Screen } from '../dom';
import * as db from '../db';
import { buildChoices, checkAnswer, shuffle, suggestedRating, type ChoiceOption, type Verdict } from '../answers';
import { formatInterval, preview, schedule } from '../fsrs';
import { UrlBag } from '../images';
import { buildQueue, Session } from '../scheduler';
import { fsrsParams } from '../settings';
import { setScreenKeys } from '../keys';
import { State, type Card, type Rating, type ReviewLog } from '../types';
import { sideContent } from './common';

type Mode = 'flip' | 'type' | 'choice';
type Dir = 'front' | 'back' | 'mixed';

interface HistoryEntry {
  before: Card;
  logId: number | null;
}

const RATING_LABEL: Record<Rating, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };

export async function studyScreen(deckId: string, requested: Mode, query: URLSearchParams): Promise<Screen> {
  const deck = await db.getDeck(deckId);
  if (!deck) return { el: h('div', { class: 'panel error' }, h('h2', null, 'Deck not found'), h('a', { class: 'btn', href: '#/' }, 'Back to decks')) };
  const mode: Mode = requested === 'type' || requested === 'choice' ? requested : 'flip';
  const dir = (query.get('dir') as Dir) || 'front';
  const practice = query.get('practice') === '1';
  const allCards = await db.listCards(deckId);
  const now0 = Date.now();

  let session: Session;
  if (practice) {
    session = Session.fromCards(shuffle(allCards));
  } else {
    const today = await db.todayCounts(deckId, now0);
    session = new Session(
      buildQueue(allCards, { now: now0, newPerDay: deck.newPerDay, newDoneToday: today.newDone, reviewsPerDay: deck.reviewsPerDay, reviewsDoneToday: today.reviewsDone }),
    );
  }
  const total0 = session.remaining;

  const bag = new UrlBag();
  const el = h('section', { class: 'screen study' });
  const bar = h('div', { class: 'study-bar' });
  const stage = h('div', { class: 'stage' });
  el.append(bar, stage);

  let cur: Card | null = null;
  let promptSide: 'front' | 'back' = 'front';
  let effectiveMode: Mode = mode;
  let answered = false;
  let shownAt = Date.now();
  let verdict: Verdict | null = null;
  let typed = '';
  let choices: ChoiceOption[] | null = null;
  let chosen = -1;
  let suggestion: Rating | null = null;
  let busy = false;
  const history: HistoryEntry[] = [];
  const stats = { done: 0, remembered: 0, ms: 0 };
  let typeInput: HTMLInputElement | null = null;

  const textOf = (c: Card, side: 'front' | 'back') => (side === 'front' ? c.front : c.back);
  const imageOf = (c: Card, side: 'front' | 'back') => (side === 'front' ? c.frontImage : c.backImage);
  const other = (s: 'front' | 'back') => (s === 'front' ? 'back' : 'front');

  function counts() {
    let fresh = 0;
    let learn = session.learning.length;
    let due = 0;
    for (const c of session.main) {
      if (c.state === State.New) fresh++;
      else if (c.state === State.Review) due++;
      else learn++;
    }
    if (cur) {
      if (cur.state === State.New) fresh++;
      else if (cur.state === State.Review) due++;
      else learn++;
    }
    return { fresh, learn, due };
  }

  function renderBar() {
    clear(bar);
    const c = counts();
    const left = c.fresh + c.learn + c.due;
    const pct = stats.done + left ? Math.round((stats.done / (stats.done + left)) * 100) : 100;
    bar.append(
      h('a', { class: 'back', href: `#/deck/${deckId}` }, `← ${deck!.name}`),
      h(
        'div',
        { class: 'counts', 'aria-label': 'Cards left' },
        h('span', { class: 'cnt c-new', title: 'New' }, String(c.fresh)),
        h('span', { class: 'cnt c-learn', title: 'Learning' }, String(c.learn)),
        h('span', { class: 'cnt c-due', title: 'Due' }, String(c.due)),
      ),
      h('button', { class: 'btn small', disabled: history.length === 0 || undefined, onclick: () => void undo(), title: 'Undo last rating (z)' }, 'Undo'),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('i', { style: `width:${pct}%` })),
    );
  }

  function next() {
    const card = session.pick(Date.now());
    cur = card;
    answered = false;
    verdict = null;
    typed = '';
    chosen = -1;
    suggestion = null;
    choices = null;
    shownAt = Date.now();
    if (!card) return finish();
    promptSide = dir === 'mixed' ? (Math.random() < 0.5 ? 'front' : 'back') : dir;
    effectiveMode = mode;
    const answerSide = other(promptSide);
    const hasPrompt = !!(textOf(card, promptSide) || imageOf(card, promptSide));
    if (!hasPrompt) promptSide = answerSide;
    if (mode === 'type' && !textOf(card, other(promptSide)).trim()) effectiveMode = 'flip';
    if (mode === 'choice') {
      choices = buildChoices(card, allCards, other(promptSide));
      if (!choices) effectiveMode = 'flip';
    }
    render();
  }

  function finish() {
    bag.dispose();
    clear(stage);
    renderBar();
    const pct = stats.done ? Math.round((stats.remembered / stats.done) * 100) : 0;
    const secs = Math.round(stats.ms / 1000);
    const nothing = total0 === 0 && stats.done === 0;
    stage.append(
      h(
        'div',
        { class: 'panel done' },
        h('h2', null, nothing ? 'Nothing to study right now' : practice ? 'Practice round finished' : 'Session complete'),
        nothing
          ? h('p', { class: 'muted' }, allCards.length ? 'No cards are due and today’s new-card limit is used up. Come back later, raise the limit in the deck settings, or practice without scheduling.' : 'This deck has no cards yet.')
          : h('p', null, `${stats.done} review${stats.done === 1 ? '' : 's'}, ${pct}% remembered, ${Math.floor(secs / 60)}m ${secs % 60}s.`),
        h(
          'div',
          { class: 'row' },
          h('a', { class: 'btn primary', href: `#/deck/${deckId}` }, 'Back to deck'),
          allCards.length ? h('a', { class: 'btn', href: `#/study/${deckId}/${mode}?dir=${dir}&practice=1` }, 'Practice all cards') : h('a', { class: 'btn', href: `#/deck/${deckId}` }, 'Add cards'),
          h('a', { class: 'btn', href: '#/stats' }, 'See stats'),
        ),
      ),
    );
  }

  function render() {
    if (!cur) return;
    bag.dispose();
    clear(stage);
    renderBar();
    const card = cur;
    const promptEl = sideContent(textOf(card, promptSide), imageOf(card, promptSide), bag, 'prompt');
    const label = h('div', { class: 'side-label' }, promptSide === 'front' ? 'Front' : 'Back');
    const face = h('div', { class: 'flashcard' + (answered ? ' answered' : '') }, label, promptEl);

    if (answered) {
      face.append(h('hr'), h('div', { class: 'side-label' }, promptSide === 'front' ? 'Back' : 'Front'), sideContent(textOf(card, other(promptSide)), imageOf(card, other(promptSide)), bag, 'answer'));
    }
    stage.append(face);

    if (!answered) {
      if (effectiveMode === 'flip') {
        stage.append(h('button', { class: 'btn primary big', onclick: reveal }, 'Show answer ', h('kbd', null, 'Space')));
      } else if (effectiveMode === 'type') {
        typeInput = h('input', { type: 'text', class: 'answer-input', placeholder: 'Type your answer', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, 'aria-label': 'Your answer' });
        stage.append(
          h(
            'form',
            { class: 'type-form', onsubmit: (e: Event) => { e.preventDefault(); checkTyped(); } },
            typeInput,
            h('button', { class: 'btn primary', type: 'submit' }, 'Check ', h('kbd', null, 'Enter')),
            h('button', { class: 'btn', type: 'button', onclick: () => { typed = ''; checkTyped(); } }, 'I don’t know'),
          ),
        );
        typeInput.focus();
      } else if (choices) {
        const list = h('div', { class: 'choices', role: 'group', 'aria-label': 'Choose the answer' });
        choices.forEach((o, i) => {
          list.append(
            h(
              'button',
              { class: 'choice', onclick: () => choose(i) },
              h('kbd', null, String(i + 1)),
              o.image ? h('img', { src: bag.url(o.image), alt: '' }) : null,
              o.text ? h('span', null, o.text) : null,
            ),
          );
        });
        stage.append(list);
      }
    } else {
      if (effectiveMode === 'type' && verdict) {
        stage.append(h('div', { class: 'verdict ' + verdict }, verdict === 'correct' ? 'Correct' : verdict === 'close' ? 'Close: check the spelling' : 'Not quite', typed ? h('span', { class: 'muted' }, ` You typed: ${typed}`) : null));
      }
      if (effectiveMode === 'choice' && choices) {
        const list = h('div', { class: 'choices locked' });
        choices.forEach((o, i) => {
          const cls = o.correct ? ' right' : i === chosen ? ' wrong' : '';
          list.append(h('div', { class: 'choice' + cls }, h('kbd', null, String(i + 1)), o.image ? h('img', { src: bag.url(o.image), alt: '' }) : null, o.text ? h('span', null, o.text) : null));
        });
        stage.append(list);
      }
      const pv = preview(card, Date.now(), fsrsParams());
      const row = h('div', { class: 'ratings', role: 'group', 'aria-label': 'How well did you remember?' });
      for (const p of pv) {
        row.append(
          h(
            'button',
            { class: `rate r${p.rating}` + (suggestion === p.rating ? ' suggested' : ''), disabled: busy || undefined, onclick: () => void rate(p.rating) },
            h('span', { class: 'rate-name' }, RATING_LABEL[p.rating]),
            h('span', { class: 'rate-int' }, formatInterval(p.intervalMs)),
            h('kbd', null, String(p.rating)),
          ),
        );
      }
      stage.append(row);
      if (practice) stage.append(h('p', { class: 'muted center' }, 'Practice mode: your ratings do not change the schedule.'));
    }
  }

  function reveal() {
    if (!cur || answered) return;
    answered = true;
    suggestion = null;
    render();
  }

  function checkTyped() {
    if (!cur || answered) return;
    typed = typeInput?.value.trim() ?? '';
    verdict = typed ? checkAnswer(typed, textOf(cur, other(promptSide))) : 'wrong';
    suggestion = suggestedRating(verdict);
    answered = true;
    render();
  }

  function choose(i: number) {
    if (!cur || answered || !choices || !choices[i]) return;
    chosen = i;
    suggestion = choices[i].correct ? 3 : 1;
    answered = true;
    render();
  }

  async function rate(r: Rating) {
    if (!cur || !answered || busy) return;
    busy = true;
    const before = cur;
    const now = Date.now();
    try {
      const res = schedule(before, r, now, fsrsParams());
      const updated: Card = { ...before, ...res.card, updatedAt: now };
      stats.done += 1;
      if (r > 1) stats.remembered += 1;
      stats.ms += Math.min(now - shownAt, 120_000);
      if (practice) {
        history.push({ before, logId: null });
        if (r === 1) session.main.push(before);
      } else {
        const log: ReviewLog = {
          cardId: before.id,
          deckId,
          ts: now,
          rating: r,
          prevState: before.state,
          state: updated.state,
          elapsedDays: res.elapsedDays,
          scheduledDays: res.scheduledDays,
          mode: effectiveMode,
          durationMs: Math.min(now - shownAt, 120_000),
        };
        const logId = await db.saveReview(updated, log);
        history.push({ before, logId });
        session.requeue(updated, now);
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save that review.', 'error');
      busy = false;
      return;
    }
    busy = false;
    next();
  }

  async function undo() {
    const last = history.pop();
    if (!last || busy) return;
    busy = true;
    try {
      if (last.logId !== null) await db.undoReview(last.before, last.logId);
      if (cur) session.unshift(cur);
      session.unshift(last.before);
      stats.done = Math.max(0, stats.done - 1);
      toast('Last rating undone.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not undo.', 'error');
    }
    busy = false;
    next();
  }

  setScreenKeys((e) => {
    if (e.key === 'Escape') {
      location.hash = `#/deck/${deckId}`;
      return true;
    }
    if (!cur) {
      if (e.key === 'Enter') {
        location.hash = `#/deck/${deckId}`;
        return true;
      }
      if (e.key === 'z') {
        void undo();
        return true;
      }
      return false;
    }
    const typing = e.target instanceof HTMLInputElement;
    if (typing) {
      if (e.key === 'Enter' && !answered && effectiveMode === 'type') {
        checkTyped();
        return true;
      }
      return false;
    }
    if (e.key === 'z') {
      void undo();
      return true;
    }
    if (!answered) {
      if (effectiveMode === 'flip' && (e.key === ' ' || e.key === 'Enter')) {
        reveal();
        return true;
      }
      if (effectiveMode === 'choice' && /^[1-9]$/.test(e.key)) {
        choose(Number(e.key) - 1);
        return true;
      }
      return false;
    }
    if (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4') {
      void rate(Number(e.key) as Rating);
      return true;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      void rate(suggestion ?? 3);
      return true;
    }
    return false;
  });

  next();
  return {
    el,
    destroy: () => {
      bag.dispose();
    },
  };
}
