import { h, setChildren } from './dom';
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
import { baseName, getPageInfo, loadPdf } from '../lib/pdfops';
import { compressPdf } from '../lib/compress';
import { CancelToken } from '../lib/cancel';

const PRESETS = [
  { id: 'small', label: 'Smallest file', quality: 40, dpi: 96 },
  { id: 'balanced', label: 'Balanced', quality: 60, dpi: 130 },
  { id: 'sharp', label: 'Sharper', quality: 80, dpi: 180 },
] as const;

export const compressTool: Tool = {
  id: 'compress',
  title: 'Compress',
  blurb: 'Shrink a PDF by re-rendering each page as a JPEG at the quality you pick.',
  mount(root) {
    let bytes: Uint8Array | null = null;
    let fileName = '';
    let pages = 0;
    let token: CancelToken | null = null;
    let result: Uint8Array | null = null;

    const status = statusLine();
    const progress = progressBar();
    const zone = dropzone({ label: 'Choose a PDF to compress', onFiles: (f) => void load(f[0]) });
    const info = h('div', { class: 'file-info', hidden: true });

    const qualityOut = h('output', { class: 'value' });
    const quality = h('input', { type: 'range', min: 10, max: 95, step: 5, value: 60, 'aria-label': 'JPEG quality', oninput: () => update() });
    const dpiOut = h('output', { class: 'value' });
    const dpi = h('input', { type: 'range', min: 72, max: 250, step: 2, value: 130, 'aria-label': 'Resolution in DPI', oninput: () => update() });
    const presetSel = h(
      'select',
      {
        class: 'text',
        'aria-label': 'Preset',
        onchange: () => {
          const p = PRESETS.find((x) => x.id === presetSel.value);
          if (p) {
            quality.value = String(p.quality);
            dpi.value = String(p.dpi);
            update();
          }
        },
      },
      ...PRESETS.map((p) => h('option', { value: p.id, selected: p.id === 'balanced' }, `${p.label} (quality ${p.quality}, ${p.dpi} DPI)`)),
      h('option', { value: 'custom' }, 'Custom'),
    );
    function update() {
      qualityOut.textContent = `${quality.value}%`;
      dpiOut.textContent = `${dpi.value} DPI`;
      const match = PRESETS.find((p) => String(p.quality) === quality.value && String(p.dpi) === dpi.value);
      presetSel.value = match ? match.id : 'custom';
    }
    update();

    const ack = h('input', { type: 'checkbox', onchange: () => syncRun() });
    const runBtn = button('Compress', () => void run(), 'primary');
    const cancelBtn = button('Cancel', () => token?.cancel());
    cancelBtn.hidden = true;
    const result$ = h('div', { class: 'results', hidden: true });

    const warning = h(
      'div',
      { class: 'status warn', role: 'alert' },
      h('strong', null, 'This flattens your PDF. '),
      'Every page is turned into a picture, so text can no longer be selected, searched or copied, and links, form fields, bookmarks and annotations are removed. Use the OCR tool afterwards if you need searchable text again. Your original file is not changed. Pages that are mostly text can come out larger, not smaller.',
    );

    const controls = h(
      'div',
      { class: 'controls', hidden: true },
      warning,
      h('label', { class: 'field' }, 'Preset ', presetSel),
      h('label', { class: 'field slider' }, 'JPEG quality ', quality, qualityOut),
      h('label', { class: 'field slider' }, 'Resolution ', dpi, dpiOut),
      h('label', { class: 'radio' }, ack, ' I understand that text will be flattened to images'),
      h('div', { class: 'row' }, runBtn, cancelBtn, button('Choose another file', () => reset())),
    );

    root.append(
      toolHeader('Compress', 'Re-renders every page as a JPEG to cut file size. Best for scans and photo-heavy documents.'),
      zone,
      info,
      controls,
      status.el,
      progress.el,
      result$,
    );

    function syncRun() {
      runBtn.disabled = !ack.checked || !bytes;
    }

    function reset() {
      bytes = null;
      result = null;
      info.hidden = true;
      controls.hidden = true;
      result$.hidden = true;
      zone.hidden = false;
      ack.checked = false;
      progress.hide();
      status.clear();
    }

    async function load(file: File | undefined) {
      if (!file) return;
      if (!isPdfFile(file)) return status.set('That does not look like a PDF.', 'error');
      reset();
      try {
        const b = await readBytes(file);
        await loadPdf(b, file.name);
        pages = (await getPageInfo(b)).count;
        bytes = b;
        fileName = file.name;
        void noteRecent(file, 'compress');
        info.hidden = false;
        info.textContent = `${file.name}: ${pages} page${pages === 1 ? '' : 's'}, ${fmtBytes(b.length)}`;
        zone.hidden = true;
        controls.hidden = false;
        syncRun();
      } catch (e) {
        status.set(friendly(e), 'error');
      }
    }

    async function run() {
      if (!bytes) return;
      token = new CancelToken();
      runBtn.disabled = true;
      cancelBtn.hidden = false;
      result$.hidden = true;
      status.clear();
      progress.set(0, 'Starting...');
      const before = bytes.length;
      try {
        const out = await compressPdf(bytes, {
          quality: Number(quality.value) / 100,
          dpi: Number(dpi.value),
          signal: token,
          onProgress: (done, total) => progress.set(done / total, `Page ${done} of ${total}`),
        });
        result = out;
        progress.hide();
        const saved = before - out.length;
        const pct = Math.round((Math.abs(saved) / before) * 100);
        result$.hidden = false;
        setChildren(
          result$,
          h('h3', null, 'Done'),
          h('p', null, `${fmtBytes(before)} → ${fmtBytes(out.length)} (${saved >= 0 ? `${pct}% smaller` : `${pct}% larger`})`),
          saved < 0
            ? h('p', { class: 'status warn' }, 'The result is bigger than the original, so keep the original. Try a lower quality or resolution, or skip compression for this file.')
            : null,
          button('Download compressed PDF', () => result && saveBytes(result, `${baseName(fileName)}-compressed.pdf`), 'primary'),
        );
        status.set('Compressed. The text in this copy is now part of the images.', saved >= 0 ? 'ok' : 'warn');
      } catch (e) {
        progress.hide();
        status.set(friendly(e) === 'Cancelled' ? 'Cancelled.' : friendly(e), friendly(e) === 'Cancelled' ? 'info' : 'error');
      } finally {
        cancelBtn.hidden = true;
        syncRun();
      }
    }
  },
};
