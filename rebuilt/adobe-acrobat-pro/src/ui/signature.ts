import { h } from './dom';

export interface Signature {
  png: Uint8Array;
  dataUrl: string;
  aspect: number; // width / height
}

const STYLES: Array<{ label: string; family: string; italic: boolean }> = [
  { label: 'Script', family: '"Segoe Script","Snell Roundhand","Brush Script MT","Lucida Handwriting",cursive', italic: false },
  { label: 'Casual', family: '"Bradley Hand","Segoe Print","Chalkboard SE","Comic Sans MS",cursive', italic: false },
  { label: 'Formal', family: '"Times New Roman",Georgia,serif', italic: true },
  { label: 'Plain', family: 'Helvetica,Arial,sans-serif', italic: true },
];

const INKS = [
  { label: 'Black', value: '#111111' },
  { label: 'Blue', value: '#0b3d91' },
];

/** Trim transparent margins; returns null if nothing was drawn. */
function cropToContent(src: HTMLCanvasElement, pad = 8): HTMLCanvasElement | null {
  const ctx = src.getContext('2d')!;
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const w = maxX - minX + 1 + pad * 2;
  const hgt = maxY - minY + 1 + pad * 2;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = hgt;
  out.getContext('2d')!.drawImage(src, minX, minY, w - pad * 2, hgt - pad * 2, pad, pad, w - pad * 2, hgt - pad * 2);
  return out;
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (b) => (b ? resolve(new Uint8Array(await b.arrayBuffer())) : reject(new Error('PNG export failed'))), 'image/png');
  });
}

/** Modal dialog to create a signature by typing or drawing. Resolves null if cancelled. */
export function createSignature(): Promise<Signature | null> {
  return new Promise((resolve) => {
    let tab: 'type' | 'draw' = 'type';
    let ink = INKS[0].value;
    let styleIdx = 0;

    // --- type tab
    const nameInput = h('input', { type: 'text', class: 'text wide', placeholder: 'Type your name', 'aria-label': 'Your name', oninput: () => paintTyped() });
    const styleSel = h(
      'select',
      { class: 'text', 'aria-label': 'Signature style', onchange: () => ((styleIdx = Number(styleSel.value)), paintTyped()) },
      ...STYLES.map((s, i) => h('option', { value: String(i) }, s.label)),
    );
    const typed = h('canvas', { class: 'sig-canvas', width: 1200, height: 300 });
    function paintTyped() {
      const ctx = typed.getContext('2d')!;
      ctx.clearRect(0, 0, typed.width, typed.height);
      const text = nameInput.value.trim();
      if (!text) return;
      const s = STYLES[styleIdx];
      let size = 150;
      const font = (px: number) => `${s.italic ? 'italic ' : ''}${px}px ${s.family}`;
      ctx.font = font(size);
      while (ctx.measureText(text).width > typed.width - 60 && size > 24) {
        size -= 6;
        ctx.font = font(size);
      }
      ctx.fillStyle = ink;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(text, 30, typed.height * 0.68);
    }

    // --- draw tab
    const pad = h('canvas', { class: 'sig-canvas draw', width: 1200, height: 360 });
    let drawing = false;
    let last: { x: number; y: number } | null = null;
    const pos = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * pad.width, y: ((e.clientY - r.top) / r.height) * pad.height };
    };
    pad.addEventListener('pointerdown', (e) => {
      drawing = true;
      pad.setPointerCapture(e.pointerId);
      last = pos(e);
      const ctx = pad.getContext('2d')!;
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
    pad.addEventListener('pointermove', (e) => {
      if (!drawing || !last) return;
      const p = pos(e);
      const ctx = pad.getContext('2d')!;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.quadraticCurveTo(last.x, last.y, (last.x + p.x) / 2, (last.y + p.y) / 2);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
    });
    const endDraw = () => {
      drawing = false;
      last = null;
    };
    pad.addEventListener('pointerup', endDraw);
    pad.addEventListener('pointercancel', endDraw);

    const inkSel = h(
      'select',
      {
        class: 'text',
        'aria-label': 'Ink colour',
        onchange: () => {
          ink = inkSel.value;
          paintTyped();
        },
      },
      ...INKS.map((i) => h('option', { value: i.value }, i.label)),
    );

    const typePane = h('div', { class: 'sig-pane' }, h('div', { class: 'row' }, nameInput, styleSel), typed);
    const drawPane = h(
      'div',
      { class: 'sig-pane', hidden: true },
      h('p', { class: 'muted small-text' }, 'Draw with your mouse, finger or stylus.'),
      pad,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small', onclick: () => pad.getContext('2d')!.clearRect(0, 0, pad.width, pad.height) }, 'Clear')),
    );

    const err = h('p', { class: 'status error', hidden: true });
    const tabBtn = (id: 'type' | 'draw', text: string) =>
      h('button', { type: 'button', class: 'tab-btn', role: 'tab', 'aria-selected': String(id === tab), onclick: () => setTab(id) }, text);
    const tabType = tabBtn('type', 'Type');
    const tabDraw = tabBtn('draw', 'Draw');
    function setTab(t: 'type' | 'draw') {
      tab = t;
      typePane.hidden = t !== 'type';
      drawPane.hidden = t !== 'draw';
      tabType.setAttribute('aria-selected', String(t === 'type'));
      tabDraw.setAttribute('aria-selected', String(t === 'draw'));
      err.hidden = true;
    }

    const dialog = h('dialog', { class: 'sig-dialog' });
    const finish = (value: Signature | null) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };

    const useBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn primary',
        onclick: async () => {
          const src = tab === 'type' ? typed : pad;
          const cropped = cropToContent(src);
          if (!cropped) {
            err.hidden = false;
            err.textContent = tab === 'type' ? 'Type your name first.' : 'Draw your signature first.';
            return;
          }
          const png = await canvasToPng(cropped);
          finish({ png, dataUrl: cropped.toDataURL('image/png'), aspect: cropped.width / cropped.height });
        },
      },
      'Use signature',
    );

    dialog.append(
      h('h3', null, 'Create a signature'),
      h('div', { class: 'tab-row', role: 'tablist' }, tabType, tabDraw, h('span', { class: 'grow' }), h('label', { class: 'inline' }, 'Ink ', inkSel)),
      typePane,
      drawPane,
      err,
      h('p', { class: 'muted small-text' }, 'Signatures are kept in memory for this visit only and are never saved or uploaded. A typed or drawn image is not a certificate-based digital signature.'),
      h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn', onclick: () => finish(null) }, 'Cancel'), useBtn),
    );
    dialog.addEventListener('cancel', () => finish(null));
    document.body.appendChild(dialog);
    dialog.showModal();
    nameInput.focus();
  });
}
