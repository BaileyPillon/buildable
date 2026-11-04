import { h } from './dom';
import {
  button,
  dropzone,
  fmtBytes,
  friendly,
  isPdfFile,
  noteRecent,
  progressBar,
  readBytes,
  saveBytes,
  statusLine,
  toolHeader,
  type Tool,
} from './common';
import { assemble, baseName, loadPdf, type PageSpec } from '../lib/pdfops';
import { destroyDoc, openPdf, renderToCanvas, RenderQueue, viewSize, type PDFDocumentProxy } from '../lib/pdfjs';

interface Source {
  name: string;
  bytes: Uint8Array;
  doc: PDFDocumentProxy;
  pages: number;
}

interface Item {
  id: number;
  src: number;
  page: number; // 0-based
  rot: number; // extra clockwise rotation: 0 / 90 / 180 / 270
  selected: boolean;
  el: HTMLElement;
  thumb: HTMLElement;
  canvas: HTMLCanvasElement;
  rendered: boolean;
  natural?: { w: number; h: number };
}

const BOX_W = 150;
const BOX_H = 196;

export const organizeTool: Tool = {
  id: 'organize',
  title: 'Merge & organize',
  blurb: 'Combine PDFs, drag pages into order, rotate or delete pages.',
  mount(root) {
    const sources: Source[] = [];
    let items: Item[] = [];
    const deleted: Array<{ item: Item; index: number }> = [];
    let nextId = 1;
    let dragId: number | null = null;
    const queue = new RenderQueue(2);

    const status = statusLine();
    const progress = progressBar();
    const grid = h('div', { class: 'page-grid', role: 'list' });
    const summary = h('span', { class: 'muted' });
    const nameInput = h('input', { type: 'text', value: 'merged.pdf', class: 'text', 'aria-label': 'Output file name' });
    const exportBtn = button('Download PDF', () => void exportPdf(), 'primary');
    const undoBtn = button('Undo delete', () => undoDelete());
    const zone = dropzone({
      label: 'Choose PDFs to merge',
      sub: 'or drop one or more files here. Add as many as you like, then drag pages into order.',
      multiple: true,
      onFiles: (files) => void addFiles(files),
    });
    const addBtn = button('Add more PDFs', () => addInput.click());
    const addInput = h('input', {
      type: 'file',
      accept: 'application/pdf,.pdf',
      multiple: true,
      class: 'sr-only',
      onchange: () => {
        const f = Array.from(addInput.files ?? []);
        addInput.value = '';
        if (f.length) void addFiles(f);
      },
    });

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const item = items.find((i) => i.el === e.target);
          if (item && !item.rendered) void renderThumb(item);
        }
      },
      { rootMargin: '300px' },
    );

    const toolbar = h(
      'div',
      { class: 'toolbar', hidden: true },
      addBtn,
      addInput,
      h('span', { class: 'sep' }),
      button('Rotate left', () => rotateSelected(-90)),
      button('Rotate right', () => rotateSelected(90)),
      button('Delete selected', () => deleteSelected()),
      undoBtn,
      h('span', { class: 'sep' }),
      button('Select all', () => selectAll(true)),
      button('Select none', () => selectAll(false)),
      button('Remove everything', () => reset()),
    );

    const exportBar = h(
      'div',
      { class: 'export-bar', hidden: true },
      summary,
      h('label', { class: 'inline' }, 'File name ', nameInput),
      exportBtn,
    );

    root.append(
      toolHeader('Merge & organize', 'Add one or more PDFs. Drag pages to reorder them, rotate or delete the ones you do not want, then download one PDF.'),
      zone,
      toolbar,
      status.el,
      grid,
      progress.el,
      exportBar,
    );

    // Dropping files anywhere on the tool also adds them (but not when dragging a page card).
    root.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    root.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files.length || dragId !== null) return;
      if (zone.contains(e.target as Node)) return; // dropzone handles its own
      e.preventDefault();
      void addFiles(Array.from(e.dataTransfer.files));
    });

    async function addFiles(files: File[]) {
      const pdfs = files.filter(isPdfFile);
      if (pdfs.length < files.length) status.set('Some files were skipped because they are not PDFs.', 'warn');
      else status.clear();
      for (const f of pdfs) {
        try {
          status.set(`Reading ${f.name}...`);
          const bytes = await readBytes(f);
          await loadPdf(bytes, f.name); // validates, and reports password-protected files clearly
          const doc = await openPdf(bytes, f.name);
          const src = sources.push({ name: f.name, bytes, doc, pages: doc.numPages }) - 1;
          for (let p = 0; p < doc.numPages; p++) items.push(makeItem(src, p));
          void noteRecent(f, 'organize');
          status.clear();
        } catch (e) {
          status.set(`${f.name}: ${friendly(e)}`, 'error');
        }
      }
      if (sources.length === 1) nameInput.value = `${baseName(sources[0].name)}-edited.pdf`;
      else if (sources.length > 1) nameInput.value = 'merged.pdf';
      refresh();
    }

    function makeItem(src: number, page: number): Item {
      const id = nextId++;
      const canvas = h('canvas', { class: 'thumb-canvas', width: 1, height: 1 });
      const thumb = h('div', { class: 'thumb' }, canvas);
      const item = { id, src, page, rot: 0, selected: false, canvas, thumb, rendered: false } as unknown as Item;
      const check = h('input', {
        type: 'checkbox',
        'aria-label': `Select page ${page + 1} of ${sources[src].name}`,
        onchange: () => {
          item.selected = check.checked;
          item.el.classList.toggle('selected', item.selected);
        },
      });
      const numberTag = h('span', { class: 'num' });
      const label = h('div', { class: 'card-label' }, check, numberTag, h('span', { class: 'src', title: sources[src].name }, `${sources[src].name} · p.${page + 1}`));
      const btn = (text: string, title: string, fn: () => void) =>
        h('button', { type: 'button', class: 'icon-btn', title, 'aria-label': title, onclick: fn }, text);
      const actions = h(
        'div',
        { class: 'card-actions' },
        btn('‹', 'Move earlier', () => moveBy(item, -1)),
        btn('↺', 'Rotate left', () => rotateItem(item, -90)),
        btn('↻', 'Rotate right', () => rotateItem(item, 90)),
        btn('✕', 'Delete page', () => deleteItems([item])),
        btn('›', 'Move later', () => moveBy(item, 1)),
      );
      const el = h('div', { class: 'card', draggable: true, role: 'listitem' }, thumb, label, actions);
      item.el = el;
      (el as HTMLElement & { _check?: HTMLInputElement; _num?: HTMLElement })._check = check;
      (el as HTMLElement & { _num?: HTMLElement })._num = numberTag;

      el.addEventListener('dragstart', (e) => {
        dragId = id;
        e.dataTransfer?.setData('text/plain', String(id));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => {
        dragId = null;
        el.classList.remove('dragging');
        grid.querySelectorAll('.drop-before,.drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
      });
      el.addEventListener('dragover', (e) => {
        if (dragId === null || dragId === id) return;
        e.preventDefault();
        const r = el.getBoundingClientRect();
        const after = e.clientX > r.left + r.width / 2;
        el.classList.toggle('drop-after', after);
        el.classList.toggle('drop-before', !after);
      });
      el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
      el.addEventListener('drop', (e) => {
        if (dragId === null) return;
        e.preventDefault();
        e.stopPropagation();
        const after = el.classList.contains('drop-after');
        el.classList.remove('drop-before', 'drop-after');
        moveTo(dragId, id, after);
        dragId = null;
      });
      return item;
    }

    async function renderThumb(item: Item) {
      item.rendered = true;
      try {
        await queue.run(async () => {
          const page = await sources[item.src].doc.getPage(item.page + 1);
          const size = viewSize(page);
          const scale = Math.min(BOX_W / size.width, BOX_H / size.height);
          await renderToCanvas(page, item.canvas, scale).promise;
          item.natural = { w: size.width * scale, h: size.height * scale };
          applyRotation(item);
          page.cleanup();
        });
      } catch {
        item.rendered = false;
      }
    }

    function applyRotation(item: Item) {
      const n = item.natural;
      if (!n) return;
      const turned = item.rot % 180 !== 0;
      const k = turned ? Math.min(BOX_W / n.h, BOX_H / n.w, 1) : 1;
      item.canvas.style.transform = `rotate(${item.rot}deg) scale(${k})`;
    }

    function refresh() {
      // Re-append the same card elements in the new order: thumbnails are never re-rendered.
      grid.replaceChildren(...items.map((i) => i.el));
      items.forEach((it, idx) => {
        (it.el as HTMLElement & { _num?: HTMLElement })._num!.textContent = String(idx + 1);
        io.observe(it.el);
      });
      const has = items.length > 0;
      zone.hidden = has;
      toolbar.hidden = !has;
      exportBar.hidden = !has;
      undoBtn.disabled = deleted.length === 0;
      const files = sources.length;
      summary.textContent = `${items.length} page${items.length === 1 ? '' : 's'} from ${files} file${files === 1 ? '' : 's'}`;
      exportBtn.disabled = !has;
    }

    function moveTo(id: number, targetId: number, after: boolean) {
      const from = items.findIndex((i) => i.id === id);
      if (from < 0) return;
      const [moved] = items.splice(from, 1);
      let to = items.findIndex((i) => i.id === targetId);
      if (to < 0) to = items.length;
      items.splice(after ? to + 1 : to, 0, moved);
      refresh();
    }

    function moveBy(item: Item, delta: number) {
      const i = items.indexOf(item);
      const j = i + delta;
      if (j < 0 || j >= items.length) return;
      items.splice(i, 1);
      items.splice(j, 0, item);
      refresh();
      item.el.querySelector<HTMLButtonElement>(delta < 0 ? 'button[title="Move earlier"]' : 'button[title="Move later"]')?.focus();
    }

    function rotateItem(item: Item, delta: number) {
      item.rot = (((item.rot + delta) % 360) + 360) % 360;
      applyRotation(item);
    }

    function selectedOrAll(): Item[] {
      const sel = items.filter((i) => i.selected);
      return sel.length ? sel : items;
    }

    function rotateSelected(delta: number) {
      selectedOrAll().forEach((i) => rotateItem(i, delta));
    }

    function selectAll(on: boolean) {
      for (const i of items) {
        i.selected = on;
        i.el.classList.toggle('selected', on);
        ((i.el as HTMLElement & { _check?: HTMLInputElement })._check as HTMLInputElement).checked = on;
      }
    }

    function deleteSelected() {
      const sel = items.filter((i) => i.selected);
      if (!sel.length) {
        status.set('Tick the pages you want to delete first (or use the ✕ on a page).', 'info');
        return;
      }
      deleteItems(sel);
    }

    function deleteItems(list: Item[]) {
      if (list.length >= items.length) {
        status.set('A PDF needs at least one page, so you cannot delete every page. Use "Remove everything" to start over.', 'warn');
        return;
      }
      status.clear();
      for (const it of list) {
        const index = items.indexOf(it);
        deleted.push({ item: it, index });
        io.unobserve(it.el);
        items.splice(index, 1);
      }
      refresh();
    }

    function undoDelete() {
      // Undo the most recent delete action (restoring in reverse order puts pages back where they were).
      const last = deleted.pop();
      if (!last) return;
      items.splice(Math.min(last.index, items.length), 0, last.item);
      refresh();
    }

    function reset() {
      items = [];
      deleted.length = 0;
      sources.splice(0).forEach((s) => void destroyDoc(s.doc));
      status.clear();
      progress.hide();
      refresh();
    }

    async function exportPdf() {
      if (!items.length) return;
      exportBtn.disabled = true;
      status.clear();
      progress.set(0.3, 'Building your PDF...');
      try {
        // Only send sources that are still used; remap indices.
        const used = [...new Set(items.map((i) => i.src))];
        const remap = new Map(used.map((s, i) => [s, i]));
        const specs: PageSpec[] = items.map((i) => ({ source: remap.get(i.src)!, page: i.page, rotate: i.rot }));
        const out = await assemble(
          used.map((s) => sources[s].bytes),
          specs,
        );
        let name = nameInput.value.trim() || 'merged.pdf';
        if (!/\.pdf$/i.test(name)) name += '.pdf';
        saveBytes(out, name);
        progress.hide();
        status.set(`Saved ${name} (${fmtBytes(out.length)}, ${items.length} pages).`, 'ok');
      } catch (e) {
        progress.hide();
        status.set(friendly(e), 'error');
      } finally {
        exportBtn.disabled = false;
      }
    }

    refresh();
  },
};
