/** Keyboard shortcuts: one global handler plus at most one screen-specific handler. */
import { h, isTypingTarget } from './dom';
import { toggleTheme } from './settings';

type KeyHandler = (e: KeyboardEvent) => boolean | void;

let screenHandler: KeyHandler | null = null;
let chord: string | null = null;
let chordTimer = 0;
let helpEl: HTMLElement | null = null;

/** Register the handler for the visible screen; return true from it to mark the key as used. */
export function setScreenKeys(fn: KeyHandler | null): void {
  screenHandler = fn;
}

export const SHORTCUTS: { scope: string; keys: string; does: string }[] = [
  { scope: 'Everywhere', keys: '?', does: 'Show or hide this help' },
  { scope: 'Everywhere', keys: 'g then d / s / i / b', does: 'Go to Decks / Stats / Import / Backup and settings' },
  { scope: 'Everywhere', keys: 't', does: 'Toggle dark mode' },
  { scope: 'Decks', keys: 'n', does: 'New deck' },
  { scope: 'Studying', keys: 'Space / Enter', does: 'Flip the card, or accept the suggested rating' },
  { scope: 'Studying', keys: '1 2 3 4', does: 'Rate Again / Hard / Good / Easy' },
  { scope: 'Studying', keys: 'z', does: 'Undo the last rating' },
  { scope: 'Studying', keys: 'Esc', does: 'End the session' },
  { scope: 'Multiple choice', keys: '1 2 3 4', does: 'Pick an answer (then 1-4 rates, Enter accepts)' },
  { scope: 'Type the answer', keys: 'Enter', does: 'Check the answer, then Enter again for the suggested rating' },
  { scope: 'Matching game', keys: '1-9, a-f', does: 'Select the tile with that label' },
];

export function toggleHelp(): void {
  if (helpEl) {
    helpEl.remove();
    helpEl = null;
    return;
  }
  const close = () => toggleHelp();
  helpEl = h(
    'div',
    { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Keyboard shortcuts', onclick: (e: Event) => e.target === helpEl && close() },
    h(
      'div',
      { class: 'modal' },
      h('h2', null, 'Keyboard shortcuts'),
      h(
        'table',
        { class: 'keys' },
        h('tbody', null, SHORTCUTS.map((s) => h('tr', null, h('td', null, h('kbd', null, s.keys)), h('td', null, s.does), h('td', { class: 'muted' }, s.scope)))),
      ),
      h('button', { class: 'btn', onclick: close }, 'Close (Esc)'),
    ),
  );
  document.body.appendChild(helpEl);
}

export function installGlobalKeys(navigate: (hash: string) => void): void {
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (helpEl && e.key === 'Escape') {
      toggleHelp();
      e.preventDefault();
      return;
    }
    if (isTypingTarget(e.target)) {
      // Screens may still want Escape / Enter in text boxes
      if (screenHandler && (e.key === 'Escape' || e.key === 'Enter')) {
        if (screenHandler(e)) e.preventDefault();
      }
      return;
    }
    if (chord === 'g') {
      chord = null;
      const to: Record<string, string> = { d: '#/', s: '#/stats', i: '#/import', b: '#/settings' };
      if (to[e.key]) {
        navigate(to[e.key]);
        e.preventDefault();
        return;
      }
    }
    if (screenHandler && screenHandler(e)) {
      e.preventDefault();
      return;
    }
    if (e.key === '?') {
      toggleHelp();
      e.preventDefault();
    } else if (e.key === 'g') {
      chord = 'g';
      window.clearTimeout(chordTimer);
      chordTimer = window.setTimeout(() => (chord = null), 1200);
    } else if (e.key === 't') {
      void toggleTheme();
    }
  });
}
