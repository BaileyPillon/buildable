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
import { assetUrl, wasmAllowed } from '../lib/pdfjs';
import { ocrPdf, type OcrRunResult } from '../lib/ocr';
import { CancelToken } from '../lib/cancel';

const OFFLINE_FILES = [
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract/lang/eng.traineddata.gz',
];

export const ocrTool: Tool = {
  id: 'ocr',
  title: 'OCR',
  blurb: 'Turn a scanned PDF into a searchable one (English).',
  mount(root) {
    let bytes: Uint8Array | null = null;
    let fileName = '';
    let pages = 0;
    let token: CancelToken | null = null;

    const status = statusLine();
    const progress = progressBar();
    const zone = dropzone({ label: 'Choose a scanned PDF', onFiles: (f) => void load(f[0]) });
    const info = h('div', { class: 'file-info', hidden: true });
    const dpi = h(
      'select',
      { class: 'text', 'aria-label': 'Scan resolution' },
      h('option', { value: '150' }, 'Fast (150 DPI)'),
      h('option', { value: '200', selected: true }, 'Standard (200 DPI)'),
      h('option', { value: '300' }, 'Best (300 DPI, slow)'),
    );
    const skip = h('input', { type: 'checkbox', checked: true });
    const runBtn = button('Make searchable', () => void run(), 'primary');
    const cancelBtn = button('Cancel', () => token?.cancel());
    cancelBtn.hidden = true;
    const result = h('div', { class: 'results', hidden: true });

    const engineNote = h(
      'p',
      { class: 'muted small-text' },
      wasmAllowed()
        ? 'Engine: WebAssembly (fastest). Recognition runs in a background worker on this device; no page image is uploaded.'
        : 'Engine: JavaScript. This site’s security policy blocks WebAssembly, so OCR uses the slower pure-JavaScript build of Tesseract. It still runs entirely on this device and works, but expect several seconds to about a minute per page, depending on how much text it holds.',
    );
    const offlineBtn = button('Save OCR files for offline use', () => void prepareOffline());

    const controls = h(
      'div',
      { class: 'controls', hidden: true },
      h('label', { class: 'field' }, 'Quality ', dpi),
      h('label', { class: 'radio' }, skip, ' Skip pages that already have selectable text'),
      engineNote,
      h('p', { class: 'muted small-text' }, 'The first run loads the OCR engine and English language data (about 9 MB from this site, cached afterwards). The original page images are kept exactly as they are; recognized words are added as an invisible text layer.'),
      h('div', { class: 'row' }, runBtn, cancelBtn, button('Choose another file', () => reset()), offlineBtn),
    );

    root.append(
      toolHeader('OCR', 'Add a searchable text layer to a scanned PDF. English only in this build.'),
      zone,
      info,
      controls,
      status.el,
      progress.el,
      result,
    );

    function reset() {
      bytes = null;
      info.hidden = true;
      controls.hidden = true;
      result.hidden = true;
      zone.hidden = false;
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
        void noteRecent(file, 'ocr');
        info.hidden = false;
        info.textContent = `${file.name}: ${pages} page${pages === 1 ? '' : 's'}, ${fmtBytes(b.length)}`;
        zone.hidden = true;
        controls.hidden = false;
      } catch (e) {
        status.set(friendly(e), 'error');
      }
    }

    async function prepareOffline() {
      offlineBtn.disabled = true;
      try {
        const urls = [...OFFLINE_FILES, wasmAllowed() ? 'vendor/tesseract/tesseract-core.wasm.js' : 'vendor/tesseract/tesseract-core.asm.js'];
        let done = 0;
        progress.set(0, 'Downloading OCR files...');
        for (const u of urls) {
          const r = await fetch(assetUrl(u));
          if (!r.ok) throw new Error(`Could not fetch ${u}`);
          await r.arrayBuffer();
          progress.set(++done / urls.length, `${done} of ${urls.length} files`);
        }
        progress.hide();
        status.set('OCR files are saved in this browser for offline use (installed app or cached site).', 'ok');
      } catch (e) {
        progress.hide();
        status.set(friendly(e), 'error');
      } finally {
        offlineBtn.disabled = false;
      }
    }

    async function run() {
      if (!bytes) return;
      token = new CancelToken();
      runBtn.disabled = true;
      cancelBtn.hidden = false;
      result.hidden = true;
      status.clear();
      progress.set(0, 'Preparing...');
      try {
        const res: OcrRunResult = await ocrPdf(bytes, {
          dpi: Number(dpi.value),
          skipPagesWithText: skip.checked,
          signal: token,
          onStatus: (m, f) => progress.set(f, m),
        });
        progress.hide();
        const base = baseName(fileName);
        result.hidden = false;
        setChildren(
          result,
          h('h3', null, 'Done'),
          h('p', null, `${res.pagesRecognized} page${res.pagesRecognized === 1 ? '' : 's'} recognized, ${res.pagesSkipped} skipped, ${res.wordsWritten} words added (${fmtBytes(res.pdf.length)}).`),
          res.wordsWritten === 0 ? h('p', { class: 'status warn' }, 'No text was found. If this is a scan, try the Best quality setting.') : null,
          h(
            'div',
            { class: 'row' },
            button('Download searchable PDF', () => saveBytes(res.pdf, `${base}-searchable.pdf`), 'primary'),
            button('Download text (.txt)', () => saveBytes(new TextEncoder().encode(res.text), `${base}-ocr.txt`, 'text/plain;charset=utf-8')),
          ),
        );
        status.set('OCR finished. Open the new PDF and try searching it.', res.wordsWritten ? 'ok' : 'warn');
      } catch (e) {
        progress.hide();
        const cancelled = friendly(e) === 'Cancelled';
        status.set(cancelled ? 'Cancelled.' : `OCR failed: ${friendly(e)}`, cancelled ? 'info' : 'error');
      } finally {
        cancelBtn.hidden = true;
        runBtn.disabled = false;
      }
    }
  },
};
