import { h } from './dom';
import { addRecent } from '../lib/recent';

export interface Tool {
  id: string;
  title: string;
  blurb: string;
  mount(root: HTMLElement): void | Promise<void>;
  unmount?(): void;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

export async function readBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export function isPdfFile(f: File): boolean {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
}

/** Hand bytes to the user as a download. Nothing is uploaded; the blob never leaves the page. */
export function saveBytes(bytes: Uint8Array, filename: string, mime = 'application/pdf') {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function friendly(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Remember that a file was opened (name/size/tool only) and tell the Home page to refresh. */
export async function noteRecent(file: { name: string; size: number }, tool: string) {
  await addRecent(file, tool);
  window.dispatchEvent(new CustomEvent('recent-changed'));
}

export interface DropzoneOptions {
  label: string;
  sub?: string;
  multiple?: boolean;
  accept?: string;
  onFiles(files: File[]): void;
}

export function dropzone(opts: DropzoneOptions) {
  const input = h('input', {
    type: 'file',
    accept: opts.accept ?? 'application/pdf,.pdf',
    multiple: !!opts.multiple,
    class: 'sr-only',
    onchange: () => {
      const files = Array.from(input.files ?? []);
      input.value = '';
      if (files.length) opts.onFiles(files);
    },
  });
  const el = h(
    'label',
    {
      class: 'dropzone',
      ondragover: (e: DragEvent) => {
        e.preventDefault();
        el.classList.add('over');
      },
      ondragleave: () => el.classList.remove('over'),
      ondrop: (e: DragEvent) => {
        e.preventDefault();
        el.classList.remove('over');
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length) opts.onFiles(files);
      },
    },
    input,
    h('strong', null, opts.label),
    h('span', { class: 'muted' }, opts.sub ?? 'or drop files here. They stay on this device.'),
  );
  return el;
}

export type StatusKind = 'info' | 'ok' | 'warn' | 'error';

export function statusLine() {
  const el = h('div', { class: 'status', role: 'status', 'aria-live': 'polite', hidden: true });
  return {
    el,
    set(msg: string, kind: StatusKind = 'info') {
      el.hidden = !msg;
      el.className = `status ${kind}`;
      el.textContent = msg;
    },
    clear() {
      el.hidden = true;
      el.textContent = '';
    },
  };
}

export function progressBar() {
  const bar = h('div', { class: 'bar' });
  const label = h('span', { class: 'muted' });
  const el = h('div', { class: 'progress', hidden: true }, h('div', { class: 'track' }, bar), label);
  return {
    el,
    set(fraction: number, text = '') {
      el.hidden = false;
      bar.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
      label.textContent = text;
    },
    hide() {
      el.hidden = true;
    },
  };
}

export function button(text: string, onClick: (e: MouseEvent) => void, cls = '') {
  return h('button', { type: 'button', class: `btn ${cls}`.trim(), onclick: onClick }, text);
}

export function toolHeader(title: string, blurb: string) {
  return h('div', { class: 'tool-head' }, h('h2', null, title), h('p', { class: 'muted' }, blurb));
}
