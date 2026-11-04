import { h } from './dom';
import { button, fmtBytes, type Tool } from './common';
import { clearRecent, listRecent, removeRecent } from '../lib/recent';

export interface HomeContext {
  tools: Tool[];
  go(toolId: string, fileHint?: string): void;
  canInstall(): boolean;
  install(): void;
}

const TOOL_NAMES: Record<string, string> = {
  organize: 'Merge & organize',
  split: 'Split & extract',
  fill: 'Fill & sign',
  compress: 'Compress',
  ocr: 'OCR',
};

function ago(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

export function mountHome(root: HTMLElement, ctx: HomeContext) {
  const recentBox = h('div', { class: 'recent' });

  async function renderRecent() {
    const list = await listRecent();
    recentBox.replaceChildren(
      h(
        'div',
        { class: 'row between' },
        h('h3', null, 'Recent files'),
        list.length ? button('Clear list', async () => (await clearRecent(), renderRecent()), 'small') : null,
      ),
      h('p', { class: 'muted small-text' }, 'Only file names, sizes and the tool used are remembered, in this browser. File contents are never stored. Browsers do not let a web page reopen a file by name, so tap an entry to jump to the tool and pick the file again.'),
      list.length
        ? h(
            'ul',
            { class: 'recent-list' },
            ...list.map((e) =>
              h(
                'li',
                null,
                h(
                  'button',
                  { type: 'button', class: 'recent-open', onclick: () => ctx.go(e.tool, e.name) },
                  h('span', { class: 'recent-name' }, e.name),
                  h('span', { class: 'muted' }, `${fmtBytes(e.size)} · ${TOOL_NAMES[e.tool] ?? e.tool} · ${ago(e.openedAt)}`),
                ),
                h('button', { type: 'button', class: 'icon-btn', title: 'Remove from list', 'aria-label': `Remove ${e.name} from the list`, onclick: async () => (await removeRecent(e.key), renderRecent()) }, '✕'),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'Nothing yet. Open a PDF in any tool and it will show up here.'),
    );
  }

  const cards = h(
    'div',
    { class: 'tool-cards' },
    ...ctx.tools.map((t) =>
      h('button', { type: 'button', class: 'tool-card', onclick: () => ctx.go(t.id) }, h('strong', null, t.title), h('span', { class: 'muted' }, t.blurb)),
    ),
  );

  const installBtn = button('Install this app', () => ctx.install(), 'primary');
  installBtn.hidden = !ctx.canInstall();
  window.addEventListener('install-available', () => (installBtn.hidden = !ctx.canInstall()));

  root.append(
    h('div', { class: 'tool-head' }, h('h2', null, 'Your PDFs stay on your device'), h('p', { class: 'muted' }, 'Merge, split, rotate, fill, sign, compress and OCR PDFs. There is no server and no account: every file is processed by code running in this browser tab.')),
    cards,
    recentBox,
    h(
      'section',
      { class: 'install-help' },
      h('h3', null, 'Install it like an app'),
      h('p', { class: 'muted' }, 'Installing gives you an app icon, its own window, and offline use. It is a Progressive Web App, so there is nothing to download from a store.'),
      installBtn,
      h(
        'ul',
        { class: 'plain' },
        h('li', null, h('strong', null, 'Chrome or Edge (computer): '), 'click the install icon at the right end of the address bar, or open the ⋮ menu and choose "Install Private PDF Toolkit" (Edge: Apps → Install this site as an app).'),
        h('li', null, h('strong', null, 'Chrome (Android): '), 'open the ⋮ menu and tap "Install app" (or "Add to Home screen").'),
        h('li', null, h('strong', null, 'Safari (iPhone / iPad): '), 'tap Share, then "Add to Home Screen".'),
        h('li', null, h('strong', null, 'Safari (Mac): '), 'File → "Add to Dock".'),
        h('li', null, h('strong', null, 'Firefox: '), 'Firefox on desktop does not install web apps; just bookmark the page. It still works offline after the first visit. On Android use ⋮ → Install.'),
      ),
      h('p', { class: 'muted small-text' }, 'Offline use: after the first visit the app is cached. The OCR engine (about 9 MB) is cached the first time you use OCR, or press "Save OCR files for offline use" on the OCR tab.'),
    ),
  );

  void renderRecent();
  window.addEventListener('recent-changed', () => void renderRecent());
}
