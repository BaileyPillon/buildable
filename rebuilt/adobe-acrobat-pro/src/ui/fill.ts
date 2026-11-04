import { h } from './dom';
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
import { baseName, loadPdf } from '../lib/pdfops';
import { applyFormValues, readForm, type FieldValue, type FormInfo, type FormWidget } from '../lib/formfields';
import { applyAnnotations, BASELINE_EM, LINE_HEIGHT, TEXT_PAD, type Annot, type AnnotFont, type ImageAnnot, type TextAnnot } from '../lib/annotate';
import { AnnotationMode, destroyDoc, openPdf, renderToCanvas, viewSize, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from '../lib/pdfjs';
import { createSignature, type Signature } from './signature';

interface PageView {
  index: number;
  page: PDFPageProxy;
  w: number; // view size in points
  h: number;
  el: HTMLElement;
  canvas: HTMLCanvasElement;
  forms: HTMLElement;
  layer: HTMLElement;
  rendered: boolean;
  task?: RenderTask;
}

interface Item {
  id: number;
  data: Annot;
  el: HTMLElement;
  layout(): void;
}

type Armed = { kind: 'text' } | { kind: 'image'; sig: Signature };

const CSS_FONT: Record<AnnotFont, string> = {
  Helvetica: 'Helvetica, Arial, sans-serif',
  Times: '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
};

export const fillTool: Tool = {
  id: 'fill',
  title: 'Fill & sign',
  blurb: 'Fill form fields, add text boxes, and place a typed or drawn signature.',
  mount(root) {
    let bytes: Uint8Array | null = null;
    let fileName = '';
    let pdf: PDFDocumentProxy | null = null;
    let pages: PageView[] = [];
    let form: FormInfo = { widgets: [], initial: {}, skipped: [] };
    let values: Record<string, FieldValue> = {};
    let items: Item[] = [];
    let zoom = 1.2;
    let armed: Armed | null = null;
    let nextId = 1;
    const sigs: Signature[] = [];

    const status = statusLine();
    const zone = dropzone({ label: 'Choose a PDF to fill or sign', onFiles: (f) => void load(f[0]) });
    const hintBar = h('div', { class: 'status info', hidden: true });
    const pagesBox = h('div', { class: 'fill-pages' });
    const sigList = h('div', { class: 'sig-list' });
    const flatten = h('input', { type: 'checkbox' });
    const zoomLabel = h('span', { class: 'muted zoom-label' });
    const formNote = h('span', { class: 'muted' });
    const downloadBtn = button('Download PDF', () => void exportPdf(), 'primary');

    const toolbar = h(
      'div',
      { class: 'toolbar sticky', hidden: true },
      button('Add text box', () => arm({ kind: 'text' })),
      button('Add signature', () => void newSignature()),
      sigList,
      h('span', { class: 'sep' }),
      button('−', () => setZoom(zoom / 1.15), 'small'),
      zoomLabel,
      button('+', () => setZoom(zoom * 1.15), 'small'),
      h('span', { class: 'sep' }),
      h('label', { class: 'inline' }, flatten, ' Flatten form fields'),
      formNote,
      h('span', { class: 'grow' }),
      button('Other file', () => reset()),
      downloadBtn,
    );

    root.append(
      toolHeader('Fill & sign', 'Type into form fields, drop in text boxes, and sign with a typed or drawn signature. The file is edited locally and saved as a new PDF.'),
      zone,
      toolbar,
      hintBar,
      status.el,
      pagesBox,
    );

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && armed) arm(null);
    });

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const pv = pages.find((p) => p.el === e.target);
          if (pv) renderPage(pv);
        }
      },
      { rootMargin: '700px' },
    );

    // ---------- loading

    function reset() {
      pages.forEach((p) => p.task?.cancel());
      io.disconnect();
      void destroyDoc(pdf);
      pdf = null;
      bytes = null;
      pages = [];
      items = [];
      values = {};
      form = { widgets: [], initial: {}, skipped: [] };
      pagesBox.replaceChildren();
      toolbar.hidden = true;
      zone.hidden = false;
      arm(null);
      status.clear();
    }

    async function load(file: File | undefined) {
      if (!file) return;
      if (!isPdfFile(file)) return status.set('That does not look like a PDF.', 'error');
      reset();
      try {
        status.set(`Opening ${file.name}...`);
        const b = await readBytes(file);
        const lib = await loadPdf(b, file.name);
        const d = await openPdf(b, file.name);
        bytes = b;
        pdf = d;
        fileName = file.name;
        form = readForm(lib);
        values = structuredClone(form.initial);
        void noteRecent(file, 'fill');

        const first = await d.getPage(1);
        const fit = (Math.min(pagesBox.clientWidth || 900, 980) - 8) / viewSize(first).width;
        zoom = Math.max(0.5, Math.min(1.6, fit));
        first.cleanup();

        for (let i = 0; i < d.numPages; i++) {
          const page = await d.getPage(i + 1);
          const size = viewSize(page);
          const canvas = h('canvas', { class: 'page-canvas' });
          const forms = h('div', { class: 'layer forms' });
          const layer = h('div', { class: 'layer items' });
          const el = h('div', { class: 'fill-page', 'data-page': String(i + 1) }, canvas, forms, layer, h('span', { class: 'page-tag' }, `Page ${i + 1} of ${d.numPages}`));
          const pv: PageView = { index: i, page, w: size.width, h: size.height, el, canvas, forms, layer, rendered: false };
          pages.push(pv);
          pagesBox.appendChild(el);
          layer.addEventListener('pointerdown', (ev) => onLayerClick(pv, ev));
        }
        for (const w of form.widgets) pages[w.page]?.forms.appendChild(makeWidget(w));
        zone.hidden = true;
        toolbar.hidden = false;
        status.clear();
        formNote.textContent = form.widgets.length
          ? `${new Set(form.widgets.map((w) => w.fieldName)).size} form field(s) found`
          : 'No form fields in this PDF. You can still add text and signatures.';
        layoutAll();
        pages.forEach((p) => io.observe(p.el));
      } catch (e) {
        reset();
        status.set(friendly(e), 'error');
      }
    }

    // ---------- layout & rendering

    function setZoom(z: number) {
      zoom = Math.max(0.4, Math.min(3, z));
      pages.forEach((p) => {
        p.task?.cancel();
        p.rendered = false;
        io.unobserve(p.el);
      });
      layoutAll();
      pages.forEach((p) => io.observe(p.el));
    }

    function layoutAll() {
      zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
      for (const p of pages) {
        p.el.style.width = `${p.w * zoom}px`;
        p.el.style.height = `${p.h * zoom}px`;
        p.canvas.style.width = `${p.w * zoom}px`;
        p.canvas.style.height = `${p.h * zoom}px`;
      }
      pagesBox.querySelectorAll<HTMLElement>('[data-widget]').forEach((el) => (el as HTMLElement & { _layout?: () => void })._layout?.());
      items.forEach((i) => i.layout());
    }

    function renderPage(pv: PageView) {
      if (pv.rendered) return;
      pv.rendered = true;
      pv.task = renderToCanvas(pv.page, pv.canvas, zoom, { annotationMode: AnnotationMode.ENABLE_FORMS });
      pv.task.promise.catch(() => {
        pv.rendered = false; // cancelled by a zoom change, or failed: allow a retry
      });
    }

    // ---------- form fields

    function makeWidget(w: FormWidget): HTMLElement {
      const [x0, y0, x1, y1] = w.rect;
      const page = pages[w.page];
      // convert PDF-space rectangle to view points using pdf.js's own viewport (handles rotation/cropbox)
      const vp = page.page.getViewport({ scale: 1 });
      const [ax, ay] = vp.convertToViewportPoint(x0, y0);
      const [bx, by] = vp.convertToViewportPoint(x1, y1);
      const vx = Math.min(ax, bx);
      const vy = Math.min(ay, by);
      const vw = Math.abs(bx - ax);
      const vh = Math.abs(by - ay);
      let control: HTMLElement;
      const set = (v: FieldValue) => (values[w.fieldName] = v);

      if (w.kind === 'text') {
        const common = {
          class: 'fw',
          disabled: w.readOnly,
          maxLength: w.maxLength,
          'aria-label': w.fieldName,
          title: w.fieldName,
        };
        if (w.multiline) {
          const ta = h('textarea', { ...common, value: String(values[w.fieldName] ?? ''), oninput: () => set(ta.value) });
          control = ta;
        } else {
          const inp = h('input', { ...common, type: w.password ? 'password' : 'text', value: String(values[w.fieldName] ?? ''), oninput: () => set(inp.value) });
          control = inp;
        }
      } else if (w.kind === 'checkbox') {
        const cb = h('input', {
          type: 'checkbox',
          class: 'fw',
          disabled: w.readOnly,
          checked: values[w.fieldName] === true,
          'aria-label': w.fieldName,
          title: w.fieldName,
          onchange: () => set(cb.checked),
        });
        control = cb;
      } else if (w.kind === 'radio') {
        const rb = h('input', {
          type: 'radio',
          class: 'fw',
          name: `fw-${w.fieldName}`,
          disabled: w.readOnly,
          checked: !!w.onValue && values[w.fieldName] === w.onValue,
          'aria-label': `${w.fieldName}: ${w.onValue ?? ''}`,
          title: `${w.fieldName}: ${w.onValue ?? ''}`,
          onchange: () => rb.checked && w.onValue !== undefined && set(w.onValue),
        });
        control = rb;
      } else {
        const multi = w.kind === 'list' && w.multiselect;
        const sel = h(
          'select',
          {
            class: 'fw',
            disabled: w.readOnly,
            multiple: multi,
            size: w.kind === 'list' ? Math.max(2, Math.min(w.options.length, 6)) : undefined,
            'aria-label': w.fieldName,
            title: w.fieldName,
            onchange: () => set(multi ? Array.from(sel.selectedOptions).map((o) => o.value) : sel.value),
          },
          w.kind === 'dropdown' ? h('option', { value: '' }, '') : null,
          ...w.options.map((o) => {
            const cur = values[w.fieldName];
            const isSel = Array.isArray(cur) ? cur.includes(o) : cur === o;
            return h('option', { value: o, selected: isSel }, o);
          }),
        );
        control = sel;
      }
      const wrap = h('div', { class: `widget ${w.kind}`, 'data-widget': w.fieldName }, control);
      (wrap as HTMLElement & { _layout?: () => void })._layout = () => {
        wrap.style.left = `${vx * zoom}px`;
        wrap.style.top = `${vy * zoom}px`;
        wrap.style.width = `${vw * zoom}px`;
        wrap.style.height = `${vh * zoom}px`;
        control.style.fontSize = `${Math.max(8, Math.min(vh * zoom * 0.62, 15 * zoom))}px`;
      };
      return wrap;
    }

    // ---------- placing items

    function arm(a: Armed | null) {
      armed = a;
      pagesBox.classList.toggle('placing', !!a);
      if (!a) {
        hintBar.hidden = true;
        return;
      }
      hintBar.hidden = false;
      hintBar.textContent = a.kind === 'text' ? 'Click on the page where the text box should go. Press Esc to cancel.' : 'Click on the page where the signature should go. Press Esc to cancel.';
    }

    async function newSignature() {
      const sig = await createSignature();
      if (!sig) return;
      sigs.push(sig);
      renderSigList();
      arm({ kind: 'image', sig });
    }

    function renderSigList() {
      sigList.replaceChildren(
        ...sigs.map((s, i) =>
          h(
            'span',
            { class: 'sig-chip' },
            h('button', { type: 'button', class: 'sig-use', title: 'Place this signature', onclick: () => arm({ kind: 'image', sig: s }) }, h('img', { src: s.dataUrl, alt: `Signature ${i + 1}` })),
            h('button', { type: 'button', class: 'icon-btn', title: 'Forget this signature', 'aria-label': 'Forget this signature', onclick: () => (sigs.splice(i, 1), renderSigList()) }, '✕'),
          ),
        ),
      );
    }

    function onLayerClick(pv: PageView, ev: PointerEvent) {
      if (!armed || ev.target !== pv.layer) return;
      ev.preventDefault();
      const r = pv.layer.getBoundingClientRect();
      const x = (ev.clientX - r.left) / zoom;
      const y = (ev.clientY - r.top) / zoom;
      if (armed.kind === 'text') {
        const data: TextAnnot = { type: 'text', page: pv.index, x: Math.max(0, x - TEXT_PAD), y: Math.max(0, y - 8), text: '', size: 14, font: 'Helvetica', color: '#111111' };
        const item = addTextItem(pv, data);
        item.el.querySelector('textarea')?.focus();
      } else {
        const width = Math.min(170, pv.w * 0.45);
        const height = width / armed.sig.aspect;
        const data: ImageAnnot = {
          type: 'image',
          page: pv.index,
          x: Math.max(0, Math.min(pv.w - width, x - width / 2)),
          y: Math.max(0, Math.min(pv.h - height, y - height / 2)),
          width,
          height,
          png: armed.sig.png,
        };
        addImageItem(pv, data, armed.sig.dataUrl);
      }
      arm(null);
    }

    function removeItem(item: Item) {
      item.el.remove();
      items = items.filter((i) => i !== item);
    }

    function dragBehaviour(item: Item, handle: HTMLElement, pv: PageView) {
      handle.addEventListener('pointerdown', (e) => {
        if ((e.target as HTMLElement).closest('button,select,input,textarea')) return;
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        const d = item.data;
        const sx = e.clientX;
        const sy = e.clientY;
        const ox = d.x;
        const oy = d.y;
        const move = (m: PointerEvent) => {
          d.x = Math.max(0, Math.min(pv.w - 10, ox + (m.clientX - sx) / zoom));
          d.y = Math.max(0, Math.min(pv.h - 10, oy + (m.clientY - sy) / zoom));
          item.layout();
        };
        const up = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
      });
    }

    function addTextItem(pv: PageView, data: TextAnnot): Item {
      const ta = h('textarea', {
        class: 'ti-text',
        rows: 1,
        spellcheck: false,
        wrap: 'off',
        placeholder: 'Type here',
        'aria-label': 'Text box',
        value: data.text,
        oninput: () => {
          data.text = ta.value;
          item.layout();
        },
      });
      const grip = h('span', { class: 'grip', title: 'Drag to move', 'aria-hidden': 'true' }, '⠿');
      const fontSel = h(
        'select',
        {
          class: 'mini',
          'aria-label': 'Font',
          onchange: () => ((data.font = fontSel.value as AnnotFont), item.layout()),
        },
        ...(['Helvetica', 'Times', 'Courier'] as AnnotFont[]).map((f) => h('option', { value: f, selected: f === data.font }, f)),
      );
      const color = h('input', { type: 'color', class: 'mini-color', value: data.color, 'aria-label': 'Text colour', oninput: () => ((data.color = color.value), item.layout()) });
      const mini = (text: string, title: string, fn: () => void) => h('button', { type: 'button', class: 'icon-btn', title, 'aria-label': title, onclick: fn }, text);
      const bar = h(
        'div',
        { class: 'item-bar' },
        grip,
        fontSel,
        mini('A−', 'Smaller text', () => ((data.size = Math.max(6, data.size - 1)), item.layout())),
        mini('A+', 'Larger text', () => ((data.size = Math.min(96, data.size + 1)), item.layout())),
        color,
        mini('✕', 'Delete text box', () => removeItem(item)),
      );
      const el = h('div', { class: 'item text-item' }, bar, ta);
      const measure = document.createElement('canvas').getContext('2d')!;
      const item: Item = {
        id: nextId++,
        data,
        el,
        layout() {
          const px = data.size * zoom;
          el.style.left = `${data.x * zoom}px`;
          el.style.top = `${data.y * zoom}px`;
          ta.style.fontSize = `${px}px`;
          ta.style.fontFamily = CSS_FONT[data.font];
          ta.style.lineHeight = String(LINE_HEIGHT);
          ta.style.color = data.color;
          ta.style.padding = `${TEXT_PAD * zoom}px`;
          measure.font = `${px}px ${CSS_FONT[data.font]}`;
          const lines = (data.text || ' ').split('\n');
          const wText = Math.max(...lines.map((l) => measure.measureText(l || ' ').width), px * 3);
          ta.style.width = `${wText + TEXT_PAD * 2 * zoom + px * 0.6}px`;
          ta.style.height = `${lines.length * LINE_HEIGHT * px + TEXT_PAD * 2 * zoom}px`;
        },
      };
      void BASELINE_EM;
      dragBehaviour(item, grip, pv);
      pv.layer.appendChild(el);
      items.push(item);
      item.layout();
      return item;
    }

    function addImageItem(pv: PageView, data: ImageAnnot, dataUrl: string): Item {
      const img = h('img', { src: dataUrl, alt: 'Signature', draggable: false });
      const del = h('button', { type: 'button', class: 'icon-btn del', title: 'Delete signature', 'aria-label': 'Delete signature', onclick: () => removeItem(item) }, '✕');
      const handle = h('span', { class: 'resize', title: 'Drag to resize' });
      const el = h('div', { class: 'item image-item', tabindex: 0 }, img, del, handle);
      const item: Item = {
        id: nextId++,
        data,
        el,
        layout() {
          el.style.left = `${data.x * zoom}px`;
          el.style.top = `${data.y * zoom}px`;
          el.style.width = `${data.width * zoom}px`;
          el.style.height = `${data.height * zoom}px`;
        },
      };
      dragBehaviour(item, el, pv);
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handle.setPointerCapture(e.pointerId);
        const sx = e.clientX;
        const startW = data.width;
        const aspect = data.width / data.height;
        const move = (m: PointerEvent) => {
          const w = Math.max(24, Math.min(pv.w - data.x, startW + (m.clientX - sx) / zoom));
          data.width = w;
          data.height = w / aspect;
          item.layout();
        };
        const up = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
      });
      pv.layer.appendChild(el);
      items.push(item);
      item.layout();
      return item;
    }

    // ---------- export

    async function exportPdf() {
      if (!bytes) return;
      downloadBtn.disabled = true;
      status.set('Writing your PDF...');
      try {
        const doc = await loadPdf(bytes, fileName);
        const warnings: string[] = [];
        if (form.widgets.length) {
          const changed: Record<string, FieldValue> = {};
          for (const [k, v] of Object.entries(values)) {
            if (JSON.stringify(v) !== JSON.stringify(form.initial[k])) changed[k] = v;
          }
          warnings.push(...applyFormValues(doc, changed));
          if (flatten.checked) {
            try {
              doc.getForm().flatten();
            } catch (e) {
              warnings.push(`Could not flatten the form: ${friendly(e)}`);
            }
          }
        }
        const annots = items.map((i) => i.data).filter((a) => a.type === 'image' || a.text.trim());
        warnings.push(...(await applyAnnotations(doc, annots)));
        const out = await doc.save();
        saveBytes(out, `${baseName(fileName)}-filled.pdf`);
        status.set(`Saved ${baseName(fileName)}-filled.pdf (${fmtBytes(out.length)}).${warnings.length ? ' Notes: ' + warnings.join(' ') : ''}`, warnings.length ? 'warn' : 'ok');
      } catch (e) {
        status.set(friendly(e), 'error');
      } finally {
        downloadBtn.disabled = false;
      }
    }
  },
};
