import { h, setChildren } from './dom';
import {
  button,
  dropzone,
  fmtBytes,
  friendly,
  isPdfFile,
  noteRecent,
  readBytes,
  saveBytes,
  statusLine,
  toolHeader,
  type Tool,
} from './common';
import { baseName, extractPages, loadPdf, splitByGroups } from '../lib/pdfops';
import { chunkEvery, formatPageList, parsePageList, parseRangeGroups, RangeSyntaxError } from '../lib/ranges';
import { createZip } from '../lib/zip';
import { destroyDoc, openPdf, renderToCanvas, RenderQueue, viewSize, type PDFDocumentProxy } from '../lib/pdfjs';

type Mode = 'extract' | 'ranges' | 'every';

interface Part {
  name: string;
  bytes: Uint8Array;
  pages: string;
}

export const splitTool: Tool = {
  id: 'split',
  title: 'Split & extract',
  blurb: 'Pull out pages, or cut one PDF into several by page range.',
  mount(root) {
    let bytes: Uint8Array | null = null;
    let fileName = '';
    let doc: PDFDocumentProxy | null = null;
    let pageCount = 0;
    const selected = new Set<number>();
    const cells: HTMLElement[] = [];
    const queue = new RenderQueue(2);

    const status = statusLine();
    const zone = dropzone({ label: 'Choose a PDF', onFiles: (f) => void load(f[0]) });
    const info = h('div', { class: 'file-info', hidden: true });
    const grid = h('div', { class: 'page-grid small', role: 'list', hidden: true });
    const results = h('div', { class: 'results', hidden: true });

    const rangeInput = h('input', {
      type: 'text',
      class: 'text wide',
      placeholder: 'e.g. 1-3, 5, 8-',
      'aria-label': 'Pages',
      oninput: () => {
        if (mode === 'extract') syncSelectionFromText();
      },
    });
    const everyInput = h('input', { type: 'number', min: 1, value: 1, class: 'text narrow', 'aria-label': 'Pages per file' });
    const rangeLabel = h('label', { class: 'field' });
    const everyLabel = h('label', { class: 'field', hidden: true }, 'Pages per file ', everyInput);
    const help = h('p', { class: 'muted small-text' });
    let mode: Mode = 'extract';

    const modeRadios = (
      [
        ['extract', 'Extract pages into one PDF'],
        ['ranges', 'Split into separate PDFs by range'],
        ['every', 'Split every N pages'],
      ] as Array<[Mode, string]>
    ).map(([value, text]) => {
      const input = h('input', {
        type: 'radio',
        name: 'split-mode',
        value,
        checked: value === 'extract',
        onchange: () => setMode(value),
      });
      return h('label', { class: 'radio' }, input, ' ', text);
    });

    const runBtn = button('Create PDF', () => void run(), 'primary');
    const controls = h(
      'div',
      { class: 'controls', hidden: true },
      h('div', { class: 'modes' }, ...modeRadios),
      rangeLabel,
      everyLabel,
      help,
      h('div', { class: 'row' }, runBtn, button('Choose another file', () => reset())),
    );

    root.append(
      toolHeader('Split & extract', 'Open a PDF, then pick pages by clicking thumbnails or typing ranges. Everything happens in your browser.'),
      zone,
      info,
      status.el,
      controls,
      grid,
      results,
    );
    setMode('extract');

    function setMode(m: Mode) {
      mode = m;
      rangeLabel.hidden = m === 'every';
      everyLabel.hidden = m !== 'every';
      rangeLabel.replaceChildren(m === 'extract' ? 'Pages to extract ' : 'Ranges (each becomes its own file) ', rangeInput);
      if (m === 'extract') {
        rangeInput.placeholder = 'e.g. 1-3, 5, 8-';
        help.textContent = 'Pages are kept in the order you type them. Click thumbnails to select them too.';
        runBtn.textContent = 'Extract pages';
        rangeInput.value = formatPageList(selected);
      } else if (m === 'ranges') {
        rangeInput.placeholder = 'e.g. 1-3, 4-6, 7-';
        help.textContent = 'Separate ranges with commas. "7-" means page 7 to the end. Three ranges give three PDFs.';
        runBtn.textContent = 'Split into files';
        if (!rangeInput.value || /^\d/.test(rangeInput.value) === false) rangeInput.value = '';
      } else {
        help.textContent = 'A 10-page PDF split every 3 pages gives files with pages 1-3, 4-6, 7-9 and 10.';
        runBtn.textContent = 'Split into files';
      }
    }

    function reset() {
      bytes = null;
      void destroyDoc(doc);
      doc = null;
      selected.clear();
      cells.length = 0;
      grid.replaceChildren();
      results.replaceChildren();
      for (const el of [info, grid, controls, results]) el.hidden = true;
      zone.hidden = false;
      status.clear();
    }

    async function load(file: File | undefined) {
      if (!file) return;
      if (!isPdfFile(file)) return status.set('That does not look like a PDF.', 'error');
      reset();
      try {
        status.set(`Reading ${file.name}...`);
        const b = await readBytes(file);
        await loadPdf(b, file.name);
        const d = await openPdf(b, file.name);
        bytes = b;
        doc = d;
        fileName = file.name;
        pageCount = d.numPages;
        void noteRecent(file, 'split');
        status.clear();
        info.hidden = false;
        info.textContent = `${file.name}: ${pageCount} page${pageCount === 1 ? '' : 's'}, ${fmtBytes(b.length)}`;
        zone.hidden = true;
        controls.hidden = false;
        grid.hidden = false;
        buildGrid();
        setMode(mode);
      } catch (e) {
        status.set(friendly(e), 'error');
      }
    }

    function buildGrid() {
      grid.replaceChildren();
      cells.length = 0;
      const io = new IntersectionObserver(
        (entries) => {
          for (const en of entries) {
            if (!en.isIntersecting) continue;
            io.unobserve(en.target);
            const idx = cells.indexOf(en.target as HTMLElement);
            if (idx >= 0) void renderCell(idx);
          }
        },
        { rootMargin: '300px' },
      );
      for (let i = 0; i < pageCount; i++) {
        const canvas = h('canvas', { class: 'thumb-canvas', width: 1, height: 1 });
        const cell = h(
          'button',
          {
            type: 'button',
            class: 'card selectable',
            role: 'listitem',
            'aria-pressed': 'false',
            title: `Page ${i + 1}`,
            onclick: () => toggle(i),
          },
          h('div', { class: 'thumb small' }, canvas),
          h('div', { class: 'card-label' }, h('span', { class: 'num' }, String(i + 1))),
        );
        (cell as HTMLElement & { _canvas?: HTMLCanvasElement })._canvas = canvas;
        cells.push(cell);
        grid.appendChild(cell);
        io.observe(cell);
      }
    }

    async function renderCell(i: number) {
      const d = doc;
      if (!d) return;
      const canvas = (cells[i] as HTMLElement & { _canvas?: HTMLCanvasElement })._canvas!;
      await queue
        .run(async () => {
          const page = await d.getPage(i + 1);
          const size = viewSize(page);
          await renderToCanvas(page, canvas, Math.min(96 / size.width, 124 / size.height)).promise;
          page.cleanup();
        })
        .catch(() => undefined);
    }

    function paintSelection() {
      cells.forEach((c, i) => {
        const on = selected.has(i);
        c.classList.toggle('selected', on);
        c.setAttribute('aria-pressed', String(on));
      });
    }

    function toggle(i: number) {
      if (selected.has(i)) selected.delete(i);
      else selected.add(i);
      paintSelection();
      if (mode === 'extract') rangeInput.value = formatPageList(selected);
      else if (mode === 'ranges') rangeInput.value = formatPageList(selected);
    }

    function syncSelectionFromText() {
      try {
        const list = parsePageList(rangeInput.value, pageCount);
        selected.clear();
        list.forEach((p) => selected.add(p));
      } catch {
        selected.clear();
      }
      paintSelection();
    }

    async function run() {
      if (!bytes) return;
      status.clear();
      results.replaceChildren();
      results.hidden = true;
      runBtn.disabled = true;
      try {
        const base = baseName(fileName);
        const parts: Part[] = [];
        if (mode === 'extract') {
          const pages = parsePageList(rangeInput.value || formatPageList(selected), pageCount);
          const out = await extractPages(bytes, pages);
          parts.push({ name: `${base}-pages-${formatPageList(pages).replace(/, /g, '_')}.pdf`, bytes: out, pages: formatPageList(pages) });
        } else {
          const groups =
            mode === 'ranges'
              ? parseRangeGroups(rangeInput.value, pageCount)
              : chunkEvery(pageCount, Number(everyInput.value));
          const outs = await splitByGroups(bytes, groups);
          const pad = String(groups.length).length;
          outs.forEach((o, k) =>
            parts.push({
              name: `${base}-part${String(k + 1).padStart(pad, '0')}-pages-${formatPageList(groups[k]).replace(/, /g, '_')}.pdf`,
              bytes: o,
              pages: formatPageList(groups[k]),
            }),
          );
        }
        showResults(parts);
        status.set(`Created ${parts.length} PDF${parts.length === 1 ? '' : 's'}. Your original file was not changed.`, 'ok');
      } catch (e) {
        status.set(friendly(e), e instanceof RangeSyntaxError ? 'warn' : 'error');
      } finally {
        runBtn.disabled = false;
      }
    }

    function showResults(parts: Part[]) {
      results.hidden = false;
      setChildren(
        results,
        h('h3', null, parts.length === 1 ? 'Result' : `${parts.length} files`),
        ...parts.map((p) =>
          h(
            'div',
            { class: 'result-row' },
            h('span', { class: 'result-name' }, p.name),
            h('span', { class: 'muted' }, `pages ${p.pages} · ${fmtBytes(p.bytes.length)}`),
            button('Download', () => saveBytes(p.bytes, p.name), 'small'),
          ),
        ),
        parts.length > 1
          ? button(
              'Download all as .zip',
              () => saveBytes(createZip(parts.map((p) => ({ name: p.name, data: p.bytes }))), `${baseName(fileName)}-split.zip`, 'application/zip'),
              'primary',
            )
          : null,
      );
    }
  },
};
