import { h, clear, append, toast, type Screen } from '../dom';
import * as db from '../db';
import { applyBundle, type RestoreMode } from '../backup';
import { parseCsvCards, parseJsonImport, parseQuizlet, type ImportBundle, type ParsedCard, type Skipped } from '../io';
import { getSettings } from '../settings';

type Format = 'auto' | 'quizlet' | 'csv' | 'json';

const TERM_SEPS: Record<string, string> = { tab: '\t', comma: ',', semicolon: ';', dash: ' - ', custom: '' };
const ROW_SEPS: Record<string, string> = { newline: '\n', semicolon: ';', custom: '' };

export function detectFormat(text: string, filename: string): Exclude<Format, 'auto'> {
  const t = text.trimStart();
  if (/\.json$/i.test(filename) || t.startsWith('{') || t.startsWith('[')) return 'json';
  if (/\.csv$/i.test(filename)) return 'csv';
  return 'quizlet';
}

interface Preview {
  format: Exclude<Format, 'auto'>;
  /** decks that would be created or filled */
  decks: { name: string; cards: ParsedCard[] }[];
  skipped: Skipped[];
  error?: string;
  hint?: string;
  bundle?: ImportBundle;
  total: number;
}

export async function importScreen(presetDeck: string): Promise<Screen> {
  const decks = await db.listDecks();
  if (presetDeck && !decks.some((d) => d.id === presetDeck)) presetDeck = '';

  let filename = '';
  let format: Format = 'auto';
  let termKey = 'tab';
  let rowKey = 'newline';
  let customTerm = '';
  let customRow = '';
  let destination: 'new' | 'existing' = presetDeck ? 'existing' : 'new';
  let existingId = presetDeck || decks[0]?.id || '';
  let newName = '';
  let restoreMode: RestoreMode = 'merge';
  let prev: Preview | null = null;
  let timer = 0;

  const el = h('section', { class: 'screen' });
  const text = h('textarea', { class: 'paste', rows: 10, placeholder: 'Paste your Quizlet export here, or choose a file below.\n\nterm<TAB>definition\nterm<TAB>definition', 'aria-label': 'Text to import', spellcheck: false });
  const previewBox = h('div', { class: 'panel preview' });
  const optionsBox = h('div', { class: 'panel' });
  const destBox = h('div', { class: 'panel' });
  const actionBox = h('div', { class: 'row' });

  function compute(): Preview {
    const raw = text.value;
    const fmt = format === 'auto' ? detectFormat(raw, filename) : format;
    const base = { format: fmt, skipped: [] as Skipped[], total: 0 };
    if (!raw.trim()) return { ...base, decks: [] };
    if (fmt === 'quizlet') {
      const term = termKey === 'custom' ? customTerm : TERM_SEPS[termKey];
      const row = rowKey === 'custom' ? customRow : ROW_SEPS[rowKey];
      if (!term) return { ...base, decks: [], error: 'Enter the separator that sits between a term and its definition.' };
      if (!row) return { ...base, decks: [], error: 'Enter the separator that sits between cards.' };
      const r = parseQuizlet(raw, term, row);
      const p: Preview = { ...base, decks: [{ name: newName || nameFromFile(), cards: r.cards }], skipped: r.skipped, total: r.cards.length };
      if (!r.cards.length && termKey === 'tab') p.hint = raw.includes(',') ? 'No tab characters were found. If your export used commas, choose "Comma" as the separator between term and definition.' : 'No tab characters were found between terms and definitions.';
      return p;
    }
    if (fmt === 'csv') {
      const r = parseCsvCards(raw);
      const groups = new Map<string, ParsedCard[]>();
      for (const row of r.rows) {
        const k = row.deck ?? (newName || nameFromFile());
        const l = groups.get(k) ?? [];
        l.push({ front: row.front, back: row.back });
        groups.set(k, l);
      }
      return { ...base, decks: Array.from(groups, ([name, cards]) => ({ name, cards })), skipped: r.skipped, total: r.rows.length };
    }
    try {
      const bundle = parseJsonImport(raw, newName || nameFromFile());
      return {
        ...base,
        bundle,
        decks: bundle.decks.map((d) => ({ name: d.name, cards: d.cards.map((c) => ({ front: c.front || '[image]', back: c.back || '[image]' })) })),
        total: bundle.decks.reduce((n, d) => n + d.cards.length, 0),
      };
    } catch (err) {
      return { ...base, decks: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  const nameFromFile = () => filename.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim() || 'Imported deck';

  function schedule() {
    window.clearTimeout(timer);
    timer = window.setTimeout(refresh, 150);
  }

  function refresh() {
    prev = compute();
    renderOptions();
    renderPreview();
    renderDest();
    renderAction();
  }

  function radio(name: string, value: string, label: string, checked: boolean, on: () => void): HTMLElement {
    const input = h('input', { type: 'radio', name, value, checked: checked || undefined });
    input.addEventListener('change', () => input.checked && on());
    return h('label', { class: 'check' }, input, ' ', label);
  }

  function renderOptions() {
    clear(optionsBox);
    const fmt = prev?.format ?? 'quizlet';
    const formatSel = h(
      'select',
      { 'aria-label': 'Format' },
      h('option', { value: 'auto' }, `Auto-detect${format === 'auto' ? ` (${fmt === 'quizlet' ? 'Quizlet text' : fmt.toUpperCase()})` : ''}`),
      h('option', { value: 'quizlet' }, 'Quizlet export (pasted text)'),
      h('option', { value: 'csv' }, 'CSV'),
      h('option', { value: 'json' }, 'JSON'),
    );
    formatSel.value = format;
    formatSel.addEventListener('change', () => {
      format = formatSel.value as Format;
      refresh();
    });
    optionsBox.append(h('h2', null, '2. Format'), h('label', { class: 'inline' }, 'Format ', formatSel));
    if (fmt === 'quizlet') {
      const termSel = h(
        'select',
        { 'aria-label': 'Between term and definition' },
        h('option', { value: 'tab' }, 'Tab (Quizlet default)'),
        h('option', { value: 'comma' }, 'Comma'),
        h('option', { value: 'semicolon' }, 'Semicolon'),
        h('option', { value: 'dash' }, 'Space-dash-space ( - )'),
        h('option', { value: 'custom' }, 'Custom'),
      );
      termSel.value = termKey;
      termSel.addEventListener('change', () => {
        termKey = termSel.value;
        refresh();
      });
      const rowSel = h('select', { 'aria-label': 'Between cards' }, h('option', { value: 'newline' }, 'New line (Quizlet default)'), h('option', { value: 'semicolon' }, 'Semicolon'), h('option', { value: 'custom' }, 'Custom'));
      rowSel.value = rowKey;
      rowSel.addEventListener('change', () => {
        rowKey = rowSel.value;
        refresh();
      });
      const customT = h('input', { type: 'text', placeholder: 'term/definition separator', value: customTerm, 'aria-label': 'Custom term separator' });
      customT.addEventListener('input', () => {
        customTerm = customT.value;
        schedule();
      });
      const customR = h('input', { type: 'text', placeholder: 'card separator', value: customRow, 'aria-label': 'Custom card separator' });
      customR.addEventListener('input', () => {
        customRow = customR.value;
        schedule();
      });
      optionsBox.append(
        h('div', { class: 'row' }, h('label', { class: 'inline' }, 'Between term and definition ', termSel, termKey === 'custom' ? customT : null), h('label', { class: 'inline' }, 'Between cards ', rowSel, rowKey === 'custom' ? customR : null)),
        h('p', { class: 'muted' }, 'In Quizlet: open a set, choose ... > Export, copy the text. Its defaults (a tab between term and definition, a new line between cards) are already selected.'),
      );
    }
  }

  function renderPreview() {
    clear(previewBox);
    previewBox.append(h('h2', null, '3. Preview'));
    if (!prev || (!prev.total && !prev.error && !text.value.trim())) {
      previewBox.append(h('p', { class: 'muted' }, 'Nothing to import yet.'));
      return;
    }
    if (prev.error) previewBox.append(h('p', { class: 'form-error', role: 'alert' }, prev.error));
    if (prev.hint) previewBox.append(h('p', { class: 'form-error' }, prev.hint));
    if (prev.total) {
      previewBox.append(h('p', null, h('b', null, `${prev.total} card${prev.total === 1 ? '' : 's'}`), ` ready${prev.decks.length > 1 ? ` in ${prev.decks.length} decks` : ''}.`));
      const t = h('table', { class: 'preview-table' }, h('thead', null, h('tr', null, h('th', null, 'Front'), h('th', null, 'Back'))));
      const body = h('tbody');
      const rows = prev.decks.flatMap((d) => d.cards).slice(0, 5);
      for (const c of rows) body.append(h('tr', null, h('td', null, c.front), h('td', null, c.back)));
      t.append(body);
      previewBox.append(t);
      if (prev.total > rows.length) previewBox.append(h('p', { class: 'muted' }, `…and ${prev.total - rows.length} more.`));
    }
    if (prev.skipped.length) {
      previewBox.append(
        h('details', null, h('summary', null, `${prev.skipped.length} line${prev.skipped.length === 1 ? '' : 's'} will be skipped`), h('ul', { class: 'skipped' }, prev.skipped.slice(0, 10).map((s) => h('li', null, `Line ${s.line}: ${s.reason}${s.text ? ` (${s.text})` : ''}`)), prev.skipped.length > 10 ? h('li', null, `…and ${prev.skipped.length - 10} more`) : null)),
      );
    }
  }

  function renderDest() {
    clear(destBox);
    destBox.append(h('h2', null, '4. Where should the cards go?'));
    if (!prev?.total) {
      destBox.append(h('p', { class: 'muted' }, 'Choose what to import first.'));
      return;
    }
    const isBackup = prev.bundle?.isBackup ?? false;
    if (isBackup) {
      destBox.append(
        h('p', null, 'This is a Flashcards+ backup, so schedules and review history can come along.'),
        radio('mode', 'merge', 'Merge: add missing decks and cards, update ones with the same id, keep everything else', restoreMode === 'merge', () => (restoreMode = 'merge')),
        radio('mode', 'copy', 'Import as copies: new decks, nothing is overwritten (review history is not copied)', restoreMode === 'copy', () => (restoreMode = 'copy')),
        radio('mode', 'replace', 'Replace everything: erase this browser’s decks first, then restore the backup', restoreMode === 'replace', () => (restoreMode = 'replace')),
      );
      return;
    }
    const csvMulti = prev.format === 'csv' && prev.decks.length > 1;
    if (csvMulti) {
      destBox.append(h('p', null, `The CSV has a deck column, so ${prev.decks.length} new decks will be created: ${prev.decks.map((d) => d.name).join(', ')}.`));
      return;
    }
    const nameInput = h('input', { type: 'text', value: newName || prev.decks[0]?.name || '', 'aria-label': 'New deck name', maxLength: 120 });
    nameInput.addEventListener('input', () => {
      newName = nameInput.value;
    });
    const sel = h('select', { 'aria-label': 'Existing deck' }, decks.map((d) => h('option', { value: d.id, selected: d.id === existingId || undefined }, d.name)));
    sel.addEventListener('change', () => (existingId = sel.value));
    append(destBox, [
      h('div', null, radio('dest', 'new', 'A new deck named', destination === 'new', () => { destination = 'new'; renderDest(); renderAction(); }), ' ', destination === 'new' ? nameInput : null),
      decks.length ? h('div', null, radio('dest', 'existing', 'Add to an existing deck', destination === 'existing', () => { destination = 'existing'; renderDest(); renderAction(); }), ' ', destination === 'existing' ? sel : null) : null,
    ]);
  }

  function renderAction() {
    clear(actionBox);
    const ok = !!prev?.total && !prev.error;
    actionBox.append(
      h(
        'button',
        {
          class: 'btn primary big',
          disabled: !ok || undefined,
          onclick: () => void run(),
        },
        ok ? `Import ${prev!.total} card${prev!.total === 1 ? '' : 's'}` : 'Import',
      ),
    );
  }

  async function run() {
    if (!prev || !prev.total || prev.error) return;
    const settings = getSettings();
    let bundle: ImportBundle;
    let mode: RestoreMode = 'copy';
    let into: string | undefined;
    if (prev.bundle) {
      bundle = prev.bundle;
      if (bundle.isBackup) {
        mode = restoreMode;
        if (mode === 'replace' && !window.confirm('This erases every deck in this browser and replaces them with the backup. Continue?')) return;
      }
    } else {
      bundle = { decks: prev.decks.map((d) => ({ name: d.name, cards: d.cards })), reviews: [], isBackup: false };
    }
    if (!bundle.isBackup && prev.decks.length === 1 && destination === 'existing' && existingId) into = existingId;
    else if (!bundle.isBackup && prev.decks.length === 1 && destination === 'new') {
      bundle = { ...bundle, decks: [{ ...bundle.decks[0], name: (newName || prev.decks[0].name).trim() || 'Imported deck' }] };
    }
    try {
      const res = await applyBundle(bundle, mode, settings, into);
      toast(`Imported ${res.cards} card${res.cards === 1 ? '' : 's'}${res.decks ? ` into ${res.decks} deck${res.decks === 1 ? '' : 's'}` : ''}.`);
      if (into) location.hash = `#/deck/${into}`;
      else location.hash = '#/';
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Import failed.', 'error');
    }
  }

  const file = h('input', { type: 'file', accept: '.txt,.csv,.tsv,.json,text/plain,text/csv,application/json', 'aria-label': 'Choose a file to import' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    filename = f.name;
    text.value = await f.text();
    refresh();
  });
  text.addEventListener('input', () => {
    filename = '';
    schedule();
  });

  el.append(
    h('div', { class: 'page-head' }, h('h1', null, 'Import'), h('a', { class: 'btn small', href: '#/settings' }, 'Export and backup')),
    h('div', { class: 'panel' }, h('h2', null, '1. Paste or choose a file'), text, h('label', { class: 'inline' }, 'Or choose a file (.txt, .csv, .json) ', file)),
    optionsBox,
    previewBox,
    destBox,
    actionBox,
  );
  refresh();
  return { el, destroy: () => window.clearTimeout(timer) };
}
