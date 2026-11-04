// Draws the receipt to a canvas and returns a PNG. Mirrors the on-screen receipt; colors are read
// from the live CSS variables so the image matches the current theme.
import type { Verdict } from '../types';
import { money } from './format';
import type { ReceiptModel } from './receiptModel';

const MONO = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';

type Palette = {
  bg: string;
  paper: string;
  ink: string;
  ink2: string;
  line: string;
  accent: string;
  verdict: Record<Verdict, string>;
};

function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string): string => cs.getPropertyValue(name).trim();
  return {
    bg: v('--bg') || '#f6f4ef',
    paper: v('--paper') || '#fffdf7',
    ink: v('--ink') || '#1d1b17',
    ink2: v('--ink-2') || '#5c574d',
    line: v('--ink-2') || '#5c574d',
    accent: v('--accent') || '#c96442',
    verdict: {
      absorb: v('--v-absorb') || '#c2410c',
      rebuild: v('--v-rebuild') || '#0f766e',
      selfhost: v('--v-selfhost') || '#4f46e5',
      haggle: v('--v-haggle') || '#a16207',
      rotate: v('--v-rotate') || '#1d4ed8',
      cancel: v('--v-cancel') || '#b91c1c',
      keep: v('--v-keep') || '#57534e',
    },
  };
}

type Ctx2D = CanvasRenderingContext2D & { letterSpacing?: string };

function fit(ctx: Ctx2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

const W = 560; // paper width, a multiple of the tooth so the zigzag ends cleanly
const M = 44; // margin around the paper
const P = 34; // inner padding
const ROW = 27;
const TOOTH = 20;

/** Paints the receipt text and barcode starting at `y0`; returns the y where it ends. */
function paintContent(
  ctx: Ctx2D,
  pal: Palette,
  model: ReceiptModel,
  hideNames: boolean,
  y0: number,
): number {
  const left = M;
  const right = M + W;
  const cx = left + W / 2;
  const x0 = left + P;
  const x1 = right - P;
  let y = y0;

  const text = (
    s: string,
    x: number,
    yy: number,
    o: { size?: number; weight?: number; color?: string; align?: CanvasTextAlign; spacing?: number } = {},
  ): void => {
    ctx.font = `${o.weight ?? 400} ${o.size ?? 15}px ${MONO}`;
    ctx.fillStyle = o.color ?? pal.ink;
    ctx.textAlign = o.align ?? 'left';
    ctx.textBaseline = 'alphabetic';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${o.spacing ?? 0}px`;
    ctx.fillText(s, x, yy);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  };

  const rule = (yy: number, double = false): void => {
    ctx.save();
    ctx.strokeStyle = pal.ink2;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.setLineDash(double ? [] : [4, 4]);
    const draw = (y2: number): void => {
      ctx.beginPath();
      ctx.moveTo(x0, y2);
      ctx.lineTo(x1, y2);
      ctx.stroke();
    };
    draw(yy);
    if (double) draw(yy + 4);
    ctx.restore();
  };

  const row = (
    label: string,
    amount: string,
    o: { size?: number; weight?: number; color?: string; leader?: boolean } = {},
  ): void => {
    const size = o.size ?? 15;
    ctx.font = `${o.weight ?? 400} ${size}px ${MONO}`;
    const aw = ctx.measureText(amount).width;
    const shown = fit(ctx, label, x1 - x0 - aw - 24);
    const lw = ctx.measureText(shown).width;
    text(shown, x0, y, { size, weight: o.weight, color: o.color });
    text(amount, x1, y, { size, weight: o.weight, color: o.color, align: 'right' });
    if (o.leader !== false) {
      ctx.save();
      ctx.strokeStyle = pal.ink2;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([1.5, 4]);
      ctx.beginPath();
      ctx.moveTo(x0 + lw + 8, y - 3);
      ctx.lineTo(x1 - aw - 8, y - 3);
      ctx.stroke();
      ctx.restore();
    }
  };

  // header
  text('SUBSCRIPTION TAX', cx, y, { size: 21, weight: 500, align: 'center', spacing: 3 });
  y += 26;
  text(model.range, cx, y, { size: 12, color: pal.ink2, align: 'center', spacing: 1.5 });
  y += 18;
  rule(y);
  y += 28;

  // one line per subscription
  model.lines.forEach((l, i) => {
    row(hideNames ? l.hiddenLabel : l.label, `${money(l.amount, 'always')}/yr`, { size: 14 });
    if (i < model.lines.length - 1) y += ROW;
  });
  rule(y + 14);
  y += 14 + 30;

  // totals
  row('TOTAL / YEAR', money(model.totalYear, 'always'), { size: 17, weight: 500, leader: false });
  y += 26;
  row('PER MONTH', money(model.perMonth, 'always'), { size: 14, color: pal.ink2, leader: false });
  rule(y + 16);
  y += 16 + 28;

  // where the savings come from
  const groups = model.groups.map((g) => ({ label: g.label, amount: `${money(g.amount, 'always')}/yr`, dim: false }));
  if (model.claudeCostYear > 0) {
    groups.push({ label: 'LESS CLAUDE PRO', amount: `-${money(model.claudeCostYear, 'always')}/yr`, dim: true });
  }
  groups.forEach((g, i) => {
    row(g.label, g.amount, { size: 13, color: g.dim ? pal.ink2 : pal.ink, leader: false });
    if (i < groups.length - 1) y += 25;
  });
  rule(y + 14, true);
  y += 14 + 38;

  text('YOU COULD KEEP', cx, y, { size: 13, weight: 500, align: 'center', spacing: 3, color: pal.ink2 });
  y += 42;
  text(`${money(model.keepYear, 'never')}/yr`, cx, y, { size: 38, weight: 500, align: 'center', color: pal.accent });
  y += 28;
  text(`for about ${Math.round(model.hours * 10) / 10} hours of building`, cx, y, {
    size: 13,
    align: 'center',
    color: pal.ink2,
  });
  y += 24;

  // barcode, colored by where the money goes
  const unit = (W - P * 2) / model.barUnits;
  for (const b of model.bars) {
    ctx.fillStyle = pal.verdict[b.verdict];
    ctx.fillRect(x0 + b.x * unit, y, Math.max(1, b.w * unit), 44);
  }
  y += 44 + 22;
  text('KEEP THE CHANGE.', cx, y, { size: 11, align: 'center', color: pal.ink2, spacing: 3 });
  return y;
}

export async function renderReceiptPng(model: ReceiptModel, opts: { hideNames: boolean }): Promise<Blob> {
  try {
    await Promise.all([document.fonts.load(`400 15px ${MONO}`), document.fonts.load(`500 15px ${MONO}`)]);
  } catch {
    // fall back to whatever monospace the system has
  }
  const pal = readPalette();
  const scale = 2;
  const top = M;
  const firstBaseline = top + 40;

  // Pass 1: measure on a scratch canvas so the paper is exactly as tall as its content.
  const scratch = document.createElement('canvas').getContext('2d') as Ctx2D | null;
  if (!scratch) throw new Error('Canvas is not available in this browser.');
  const endY = paintContent(scratch, pal, model, opts.hideNames, firstBaseline);
  const bottom = endY + 30; // paper bottom, where the teeth begin
  const totalH = bottom + TOOTH + M;

  const canvas = document.createElement('canvas');
  canvas.width = (W + M * 2) * scale;
  canvas.height = Math.ceil(totalH * scale);
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  ctx.scale(scale, scale);

  // table
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W + M * 2, totalH);

  // paper with a zigzag bottom and a soft shadow
  const left = M;
  const right = M + W;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.18)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = pal.paper;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(right, top);
  ctx.lineTo(right, bottom);
  for (let x = right; x > left; x -= TOOTH) {
    ctx.lineTo(x - TOOTH / 2, bottom + TOOTH / 2);
    ctx.lineTo(x - TOOTH, bottom);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Pass 2: the real thing.
  paintContent(ctx, pal, model, opts.hideNames, firstBaseline);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image.'))), 'image/png');
  });
}
