import './style.css';
import { h } from './ui/dom';
import type { Tool } from './ui/common';
import { organizeTool } from './ui/organize';
import { splitTool } from './ui/split';
import { fillTool } from './ui/fill';
import { compressTool } from './ui/compress';
import { ocrTool } from './ui/ocr';
import { mountHome } from './ui/home';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const tools: Tool[] = [organizeTool, splitTool, fillTool, compressTool, ocrTool];
const app = document.getElementById('app')!;
let deferredInstall: InstallPromptEvent | null = null;

function install() {
  if (!deferredInstall) return;
  void deferredInstall.prompt();
  void deferredInstall.userChoice.finally(() => {
    deferredInstall = null;
    syncInstall();
  });
}

const installBtn = h('button', { type: 'button', class: 'btn primary small', hidden: true, onclick: install }, 'Install app');
function syncInstall() {
  installBtn.hidden = !deferredInstall;
  window.dispatchEvent(new CustomEvent('install-available'));
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e as InstallPromptEvent;
  syncInstall();
});
window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  syncInstall();
});

const tabs = [{ id: 'home', title: 'Home' }, ...tools.map((t) => ({ id: t.id, title: t.title }))];
const nav = h(
  'nav',
  { class: 'tabs', 'aria-label': 'Tools' },
  ...tabs.map((t) => h('a', { href: `#/${t.id}`, class: 'tab', 'data-tab': t.id }, t.title)),
);
const banner = h('div', { class: 'banner', hidden: true });
const main = h('main', { id: 'main' });

app.append(
  h(
    'header',
    { class: 'top' },
    h('div', { class: 'brand' }, h('img', { src: './icons/favicon.svg', alt: '', width: 28, height: 28 }), h('h1', null, 'Private PDF Toolkit')),
    h('span', { class: 'badge', title: 'Files are processed in this browser and are never uploaded' }, 'No uploads · No account · Works offline'),
    h('span', { class: 'grow' }),
    installBtn,
  ),
  nav,
  banner,
  main,
  h(
    'footer',
    { class: 'foot' },
    'Everything runs inside this page. A strict Content-Security-Policy would block any network request to another site. See the README for what this cannot do compared with Acrobat Pro.',
  ),
);

const panels = new Map<string, HTMLElement>();

function go(toolId: string, fileHint?: string) {
  location.hash = `#/${toolId}${fileHint ? `?file=${encodeURIComponent(fileHint)}` : ''}`;
}

function ensurePanel(id: string): HTMLElement {
  let panel = panels.get(id);
  if (panel) return panel;
  panel = h('section', { class: 'panel', id: `panel-${id}`, hidden: true });
  panels.set(id, panel);
  main.appendChild(panel);
  try {
    if (id === 'home') {
      mountHome(panel, { tools, go, canInstall: () => !!deferredInstall, install });
    } else {
      void tools.find((t) => t.id === id)!.mount(panel);
    }
  } catch (e) {
    panel.append(h('div', { class: 'status error' }, `This tool failed to start: ${e instanceof Error ? e.message : String(e)}`));
  }
  return panel;
}

function route() {
  const [rawId, query] = location.hash.replace(/^#\/?/, '').split('?');
  const id = tabs.some((t) => t.id === rawId) ? rawId : 'home';
  ensurePanel(id);
  panels.forEach((p, pid) => (p.hidden = pid !== id));
  nav.querySelectorAll('a').forEach((a) => {
    if (a.dataset.tab === id) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const file = query ? new URLSearchParams(query).get('file') : null;
  banner.hidden = !file;
  banner.replaceChildren(
    ...(file
      ? [
          `From your recent list: choose "${file}" again to continue. Browsers do not let a web app reopen a file by name, and this app never keeps file contents.`,
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Dismiss', onclick: () => (banner.hidden = true) }, '✕'),
        ]
      : []),
  );
  document.title = id === 'home' ? 'Private PDF Toolkit' : `${tabs.find((t) => t.id === id)!.title} · Private PDF Toolkit`;
}

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is optional */
    });
  });
}
