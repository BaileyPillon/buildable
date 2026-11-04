import './style.css';
import { h, clear, toast, type Screen } from './dom';
import { applyStoredTheme, initSettings, toggleTheme, effectiveDark } from './settings';
import { installGlobalKeys, setScreenKeys, toggleHelp } from './keys';
import { decksScreen } from './views/decks';
import { deckScreen } from './views/deck';
import { studyScreen } from './views/study';
import { matchScreen } from './views/match';
import { statsScreen } from './views/statsView';
import { importScreen } from './views/importView';
import { settingsScreen } from './views/settingsView';
import { registerServiceWorker, captureInstallPrompt } from './pwa';

applyStoredTheme();
captureInstallPrompt();

const NAV: [string, string][] = [
  ['#/', 'Decks'],
  ['#/stats', 'Stats'],
  ['#/import', 'Import'],
  ['#/settings', 'Backup & settings'],
];

let current: Screen | null = null;
let renderToken = 0;

function parseHash(): { parts: string[]; query: URLSearchParams } {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(qs ?? '') };
}

function navigate(hash: string): void {
  if (location.hash === hash) void render();
  else location.hash = hash;
}

async function route(): Promise<Screen> {
  const { parts, query } = parseHash();
  const [a, b, c] = parts;
  if (!a) return decksScreen();
  if (a === 'deck' && b) return deckScreen(b);
  if (a === 'study' && b) return studyScreen(b, (c as 'flip' | 'type' | 'choice') || 'flip', query);
  if (a === 'match' && b) return matchScreen(b, query);
  if (a === 'stats') return statsScreen(query.get('deck') ?? '');
  if (a === 'import') return importScreen(query.get('deck') ?? '');
  if (a === 'settings') return settingsScreen();
  return decksScreen();
}

const main = h('main', { id: 'main', tabindex: '-1' });

function navLinks(): HTMLElement {
  const active = '#/' + (parseHash().parts[0] ?? '');
  return h(
    'nav',
    { 'aria-label': 'Main' },
    NAV.map(([href, label]) => {
      const here = href === active || (href === '#/' && ['', 'deck', 'study', 'match'].includes(parseHash().parts[0] ?? ''));
      return h('a', { href, class: here ? 'active' : '', 'aria-current': here ? 'page' : null }, label);
    }),
  );
}

const header = h('header', { class: 'top' });
function renderHeader(): void {
  clear(header);
  header.append(
    h('a', { class: 'brand', href: '#/' }, h('img', { src: './icon.svg', alt: '', width: 26, height: 26 }), h('span', null, 'Flashcards+')),
    navLinks(),
    h(
      'div',
      { class: 'tools' },
      h('button', { class: 'icon-btn', title: 'Toggle dark mode (t)', 'aria-label': 'Toggle dark mode', onclick: () => void toggleTheme().then(renderHeader) }, effectiveDark() ? '☀' : '☾'),
      h('button', { class: 'icon-btn', title: 'Keyboard shortcuts (?)', 'aria-label': 'Keyboard shortcuts', onclick: toggleHelp }, '?'),
    ),
  );
}

async function render(): Promise<void> {
  const token = ++renderToken;
  setScreenKeys(null);
  current?.destroy?.();
  current = null;
  renderHeader();
  clear(main);
  main.appendChild(h('p', { class: 'muted loading' }, 'Loading…'));
  try {
    const screen = await route();
    if (token !== renderToken) {
      screen.destroy?.();
      return;
    }
    current = screen;
    clear(main);
    main.appendChild(screen.el);
    window.scrollTo(0, 0);
  } catch (err) {
    if (token !== renderToken) return;
    clear(main);
    main.appendChild(
      h('div', { class: 'panel error' }, h('h2', null, 'Something went wrong'), h('p', null, err instanceof Error ? err.message : String(err)), h('a', { class: 'btn', href: '#/' }, 'Back to decks')),
    );
  }
}

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  app.append(header, main);
  try {
    await initSettings();
  } catch (err) {
    main.append(
      h(
        'div',
        { class: 'panel error' },
        h('h2', null, 'Storage is unavailable'),
        h('p', null, 'Flashcards+ keeps your decks in this browser’s IndexedDB, and it could not be opened. Private-browsing modes and some strict privacy settings block it.'),
        h('p', { class: 'muted' }, err instanceof Error ? err.message : String(err)),
      ),
    );
    return;
  }
  installGlobalKeys(navigate);
  window.addEventListener('hashchange', () => void render());
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', renderHeader);
  await render();
  registerServiceWorker((reload) => toast('A new version is ready.', 'info', { label: 'Reload', run: reload }));
}

void boot();
