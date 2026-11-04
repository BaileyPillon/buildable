import { h, clear, toast, download, safeFilename, stamp, type Screen } from '../dom';
import * as db from '../db';
import { buildDeckCsv, buildDeckJson } from '../backup';
import { shrinkImage, UrlBag } from '../images';
import { buildQueue, newSchedFields, forecast } from '../scheduler';
import { summarize } from '../stats';
import type { Card } from '../types';
import { badge, cardStatus, sideContent } from './common';

const PAGE = 100;

interface FormValue {
  front: string;
  back: string;
  frontImage?: Blob;
  backImage?: Blob;
}

/** Add/edit form for one card. Images can be picked or pasted into the text box. */
function cardForm(initial: FormValue, submitLabel: string, onSubmit: (v: FormValue) => Promise<void>, onCancel?: () => void): HTMLElement {
  const value: FormValue = { ...initial };
  const bag = new UrlBag();
  const front = h('textarea', { rows: 2, placeholder: 'Front (term or question)', 'aria-label': 'Front text' });
  const back = h('textarea', { rows: 2, placeholder: 'Back (definition or answer)', 'aria-label': 'Back text' });
  front.value = initial.front;
  back.value = initial.back;
  const frontPrev = h('div', { class: 'img-prev' });
  const backPrev = h('div', { class: 'img-prev' });

  const showPrev = (side: 'frontImage' | 'backImage', box: HTMLElement) => {
    clear(box);
    const blob = value[side];
    if (!blob) return;
    box.append(
      h('img', { src: bag.url(blob), alt: 'Attached image' }),
      h('button', { type: 'button', class: 'link', onclick: () => { delete value[side]; showPrev(side, box); } }, 'Remove image'),
    );
  };
  const attach = async (side: 'frontImage' | 'backImage', box: HTMLElement, file: Blob | null | undefined) => {
    if (!file) return;
    try {
      value[side] = await shrinkImage(file);
      showPrev(side, box);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add that image.', 'error');
    }
  };
  const picker = (side: 'frontImage' | 'backImage', box: HTMLElement) => {
    const input = h('input', { type: 'file', accept: 'image/*', class: 'file', 'aria-label': side === 'frontImage' ? 'Front image' : 'Back image' });
    input.addEventListener('change', () => {
      void attach(side, box, input.files?.[0]);
      input.value = '';
    });
    return input;
  };
  const onPaste = (side: 'frontImage' | 'backImage', box: HTMLElement) => (e: ClipboardEvent) => {
    const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      void attach(side, box, file);
    }
  };
  front.addEventListener('paste', onPaste('frontImage', frontPrev));
  back.addEventListener('paste', onPaste('backImage', backPrev));
  showPrev('frontImage', frontPrev);
  showPrev('backImage', backPrev);

  const err = h('p', { class: 'form-error', role: 'alert' });
  const form = h(
    'form',
    { class: 'card-form' },
    h('div', { class: 'two' }, h('label', null, 'Front', front, picker('frontImage', frontPrev), frontPrev), h('label', null, 'Back', back, picker('backImage', backPrev), backPrev)),
    err,
    h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, submitLabel), onCancel ? h('button', { class: 'btn', type: 'button', onclick: onCancel }, 'Cancel') : null, h('span', { class: 'muted hint' }, 'Ctrl+Enter saves. Paste an image into a box to attach it.')),
  );
  const submit = async () => {
    value.front = front.value.trim();
    value.back = back.value.trim();
    if ((!value.front && !value.frontImage) || (!value.back && !value.backImage)) {
      err.textContent = 'Each side needs some text or an image.';
      return;
    }
    err.textContent = '';
    await onSubmit({ ...value });
    if (!onCancel) {
      front.value = '';
      back.value = '';
      delete value.frontImage;
      delete value.backImage;
      showPrev('frontImage', frontPrev);
      showPrev('backImage', backPrev);
      front.focus();
    }
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void submit();
  });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    }
  });
  (form as HTMLElement & { dispose?: () => void }).dispose = () => bag.dispose();
  return form;
}

export async function deckScreen(deckId: string): Promise<Screen> {
  const deck = await db.getDeck(deckId);
  if (!deck) {
    return { el: h('div', { class: 'panel error' }, h('h2', null, 'Deck not found'), h('a', { class: 'btn', href: '#/' }, 'Back to decks')) };
  }
  let cards = (await db.listCards(deckId)).sort((a, b) => a.createdAt - b.createdAt);
  const bag = new UrlBag();
  const forms: HTMLElement[] = [];
  let shown = PAGE;
  let filter = '';
  let editing: string | null = null;

  const el = h('section', { class: 'screen' });
  const head = h('div', { class: 'page-head' });
  const summary = h('div', { class: 'summary' });
  const studyPanel = h('div', { class: 'panel' });
  const listBox = h('div', { class: 'panel' });
  const addBox = h('div', { class: 'panel' });
  const settingsBox = h('details', { class: 'panel' });

  async function reload() {
    cards = (await db.listCards(deckId)).sort((a, b) => a.createdAt - b.createdAt);
    renderSummary();
    renderList();
  }

  function renderHead() {
    clear(head);
    const title = h('h1', null, deck!.name);
    head.append(
      h('a', { class: 'back', href: '#/' }, '← Decks'),
      title,
      h(
        'button',
        {
          class: 'btn small',
          onclick: async () => {
            const name = window.prompt('Rename deck', deck!.name);
            if (name && name.trim()) {
              deck!.name = name.trim().slice(0, 120);
              await db.putDeck(deck!);
              title.textContent = deck!.name;
            }
          },
        },
        'Rename',
      ),
    );
  }

  async function renderSummary() {
    clear(summary);
    const now = Date.now();
    const today = await db.todayCounts(deckId, now);
    const q = buildQueue(cards, { now, newPerDay: deck!.newPerDay, newDoneToday: today.newDone, reviewsPerDay: deck!.reviewsPerDay, reviewsDoneToday: today.reviewsDone });
    const s = summarize(cards);
    const f = forecast(cards, now, 7);
    summary.append(
      h('div', { class: 'tile' }, h('b', null, String(q.newCards.length)), h('span', null, `new today (${q.newAvailable} waiting)`)),
      h('div', { class: 'tile' }, h('b', null, String(q.learning.length)), h('span', null, 'learning')),
      h('div', { class: 'tile' }, h('b', null, String(q.review.length)), h('span', null, 'reviews due')),
      h('div', { class: 'tile' }, h('b', null, String(s.mature)), h('span', null, `mature of ${s.total}`)),
      h('div', { class: 'tile wide' }, h('span', null, 'Due in the next 7 days'), h('div', { class: 'spark' }, f.map((n, i) => h('i', { style: `height:${Math.min(100, (n / Math.max(1, ...f)) * 100)}%`, title: `${i === 0 ? 'Today' : `+${i}d`}: ${n}` })))),
    );
  }

  function renderStudy() {
    clear(studyPanel);
    const dir = h('select', { 'aria-label': 'Which side to show first' }, h('option', { value: 'front' }, 'Front first'), h('option', { value: 'back' }, 'Back first'), h('option', { value: 'mixed' }, 'Mixed'));
    const practice = h('input', { type: 'checkbox', id: 'practice' });
    const go = (mode: string) => {
      const q = new URLSearchParams({ dir: dir.value });
      if (practice.checked) q.set('practice', '1');
      location.hash = `#/${mode === 'match' ? 'match' : 'study'}/${deckId}${mode === 'match' ? '' : '/' + mode}?${q}`;
    };
    studyPanel.append(
      h('h2', null, 'Study'),
      h(
        'div',
        { class: 'modes' },
        h('button', { class: 'btn primary', onclick: () => go('flip') }, 'Flip cards'),
        h('button', { class: 'btn', onclick: () => go('type') }, 'Type the answer'),
        h('button', { class: 'btn', onclick: () => go('choice') }, 'Multiple choice'),
        h('button', { class: 'btn', onclick: () => go('match') }, 'Matching game'),
      ),
      h('div', { class: 'row opts' }, h('label', null, 'Show ', dir), h('label', { class: 'check', for: 'practice' }, practice, ' Practice all cards (does not change scheduling)')),
      h('p', { class: 'muted' }, 'Flip, type and multiple choice follow today’s due queue and update the schedule. The matching game is a timed warm-up.'),
    );
  }

  function renderAdd() {
    clear(addBox);
    const form = cardForm({ front: '', back: '' }, 'Add card', async (v) => {
      const now = Date.now();
      const card: Card = { id: db.uid(), deckId, front: v.front, back: v.back, createdAt: now, updatedAt: now, ...newSchedFields(now) };
      if (v.frontImage) card.frontImage = v.frontImage;
      if (v.backImage) card.backImage = v.backImage;
      await db.putCard(card);
      toast('Card added.');
      await reload();
    });
    forms.push(form);
    addBox.append(h('h2', null, 'Add a card'), form);
  }

  function renderList() {
    clear(listBox);
    bag.dispose();
    const q = filter.trim().toLowerCase();
    const visible = q ? cards.filter((c) => (c.front + ' ' + c.back).toLowerCase().includes(q)) : cards;
    const search = h('input', { type: 'search', placeholder: 'Search cards', 'aria-label': 'Search cards', value: filter });
    search.addEventListener('input', () => {
      filter = search.value;
      shown = PAGE;
      renderList();
      const again = listBox.querySelector<HTMLInputElement>('input[type=search]');
      again?.focus();
      again?.setSelectionRange(filter.length, filter.length);
    });
    listBox.append(h('div', { class: 'list-head' }, h('h2', null, `Cards (${cards.length})`), search));
    if (!cards.length) {
      listBox.append(h('p', { class: 'muted' }, 'No cards yet. Add one above, or import a list.'), h('a', { class: 'btn', href: `#/import?deck=${deckId}` }, 'Import into this deck'));
      return;
    }
    const ul = h('ul', { class: 'cards' });
    const now = Date.now();
    for (const c of visible.slice(0, shown)) {
      if (editing === c.id) {
        const form = cardForm({ front: c.front, back: c.back, frontImage: c.frontImage, backImage: c.backImage }, 'Save', async (v) => {
          c.front = v.front;
          c.back = v.back;
          if (v.frontImage) c.frontImage = v.frontImage;
          else delete c.frontImage;
          if (v.backImage) c.backImage = v.backImage;
          else delete c.backImage;
          c.updatedAt = Date.now();
          await db.putCard(c);
          editing = null;
          toast('Card saved.');
          await reload();
        }, () => {
          editing = null;
          renderList();
        });
        forms.push(form);
        ul.append(h('li', { class: 'cardrow editing' }, form));
        continue;
      }
      const st = cardStatus(c, now);
      ul.append(
        h(
          'li',
          { class: 'cardrow' },
          h('div', { class: 'cell' }, sideContent(c.front, c.frontImage, bag, 'mini')),
          h('div', { class: 'cell' }, sideContent(c.back, c.backImage, bag, 'mini')),
          h(
            'div',
            { class: 'cell actions' },
            badge(st.label, st.cls),
            h('button', { class: 'btn small', onclick: () => { editing = c.id; renderList(); } }, 'Edit'),
            h(
              'button',
              {
                class: 'btn small danger',
                onclick: async () => {
                  if (!window.confirm('Delete this card and its review history?')) return;
                  await db.deleteCard(c.id);
                  await reload();
                },
              },
              'Delete',
            ),
          ),
        ),
      );
    }
    listBox.append(ul);
    if (visible.length > shown) {
      listBox.append(h('button', { class: 'btn', onclick: () => { shown += PAGE; renderList(); } }, `Show more (${visible.length - shown} left)`));
    }
    if (q && !visible.length) listBox.append(h('p', { class: 'muted' }, 'No cards match.'));
  }

  function renderSettings() {
    clear(settingsBox);
    const np = h('input', { type: 'number', min: 0, max: 9999, value: String(deck!.newPerDay) });
    const rp = h('input', { type: 'number', min: 0, max: 99999, value: String(deck!.reviewsPerDay) });
    settingsBox.append(
      h('summary', null, 'Deck settings, export and delete'),
      h(
        'form',
        {
          class: 'settings-form',
          onsubmit: async (e: Event) => {
            e.preventDefault();
            deck!.newPerDay = Math.max(0, Math.floor(Number(np.value) || 0));
            deck!.reviewsPerDay = Math.max(0, Math.floor(Number(rp.value) || 0));
            await db.putDeck(deck!);
            toast('Deck settings saved.');
            await renderSummary();
          },
        },
        h('label', null, 'New cards per day', np),
        h('label', null, 'Maximum reviews per day', rp),
        h('button', { class: 'btn', type: 'submit' }, 'Save'),
      ),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn', onclick: async () => { download(`${safeFilename(deck!.name)}-${stamp()}.csv`, await buildDeckCsv(deckId), 'text/csv;charset=utf-8'); } }, 'Export CSV (text only)'),
        h('button', { class: 'btn', onclick: async () => { download(`${safeFilename(deck!.name)}-${stamp()}.json`, await buildDeckJson(deckId), 'application/json'); } }, 'Export JSON (with images and schedule)'),
        h('a', { class: 'btn', href: `#/import?deck=${deckId}` }, 'Import into this deck'),
        h(
          'button',
          {
            class: 'btn danger',
            onclick: async () => {
              if (!window.confirm(`Delete "${deck!.name}", all ${cards.length} cards and their history? This cannot be undone.`)) return;
              await db.deleteDeck(deckId);
              toast('Deck deleted.');
              location.hash = '#/';
            },
          },
          'Delete deck',
        ),
      ),
    );
  }

  renderHead();
  renderStudy();
  renderAdd();
  renderSettings();
  renderList();
  void renderSummary();
  el.append(head, summary, studyPanel, addBox, listBox, settingsBox);
  return {
    el,
    destroy: () => {
      bag.dispose();
      forms.forEach((f) => (f as HTMLElement & { dispose?: () => void }).dispose?.());
    },
  };
}
