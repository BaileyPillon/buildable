import type { BabyEvent, Child, Units } from './types';
import { addDays, formatAge, formatDuration } from './time';
import { summarizeRange, type RangeSummary } from './summary';

const ML_PER_OZ = 29.5735;

export function mlToUnits(ml: number, units: Units): number {
  return units === 'oz' ? ml / ML_PER_OZ : ml;
}
export function unitsToMl(v: number, units: Units): number {
  return units === 'oz' ? v * ML_PER_OZ : v;
}
export function formatAmount(ml: number | undefined, units: Units): string {
  if (ml == null || ml <= 0) return '';
  if (units === 'oz') return `${Math.round((ml / ML_PER_OZ) * 10) / 10} oz`;
  return `${Math.round(ml)} ml`;
}

export interface ShareModel {
  childName: string;
  age: string;
  firstDay: number;
  dayCount: number;
  rangeLabel: string;
  units: Units;
  summary: RangeSummary;
  /** sleeps clipped to the single day, as fractions 0..1 of the day (only for dayCount === 1) */
  daySleepSegments: { from: number; to: number }[];
  notes: string[];
  generatedAt: number;
}

const dShort = (ms: number) => new Date(ms).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const dLong = (ms: number) => new Date(ms).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });

export function buildShareModel(
  child: Child,
  events: BabyEvent[],
  firstDay: number,
  dayCount: number,
  units: Units,
  now = Date.now(),
): ShareModel {
  const mine = events.filter((e) => e.childId === child.id);
  const summary = summarizeRange(mine, firstDay, dayCount, now);
  const lastDay = addDays(firstDay, dayCount - 1);
  const rangeLabel =
    dayCount === 1
      ? new Date(firstDay).toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
      : `${dShort(firstDay)} to ${dLong(lastDay)} (${dayCount} days)`;
  const dayEnd = addDays(firstDay, dayCount);
  const segments: { from: number; to: number }[] = [];
  if (dayCount === 1) {
    for (const e of mine) {
      if (e.type !== 'sleep') continue;
      const from = Math.max(e.start, firstDay);
      const to = Math.min(e.end ?? now, dayEnd);
      if (to > from) segments.push({ from: (from - firstDay) / (dayEnd - firstDay), to: (to - firstDay) / (dayEnd - firstDay) });
    }
  }
  const notes = mine
    .filter((e) => e.notes && e.start >= firstDay && e.start < dayEnd)
    .sort((a, b) => a.start - b.start)
    .map((e) => `${new Date(e.start).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ${e.type}: ${e.notes}`)
    .slice(0, 12);
  return {
    childName: child.name,
    age: formatAge(child.birthdate, now),
    firstDay,
    dayCount,
    rangeLabel,
    units,
    summary,
    daySleepSegments: segments,
    notes,
    generatedAt: now,
  };
}

function feedLine(t: { breastFeeds: number; bottleFeeds: number; breastMs: number; bottleMl: number }, units: Units): string {
  const parts: string[] = [];
  if (t.breastFeeds) parts.push(`${t.breastFeeds} breast (${formatDuration(t.breastMs)})`);
  if (t.bottleFeeds) parts.push(`${t.bottleFeeds} bottle${t.bottleMl ? ` (${formatAmount(t.bottleMl, units)})` : ''}`);
  return parts.join(', ');
}

export function buildShareText(m: ShareModel): string {
  const s = m.summary;
  const lines: string[] = [];
  lines.push(`${m.childName}${m.age ? ` (${m.age})` : ''}`);
  lines.push(m.rangeLabel);
  lines.push('');
  if (m.dayCount === 1) {
    const d = s.days[0];
    lines.push(`Sleep: ${formatDuration(d.sleepMs)} total, ${d.sleepCount} sleep${d.sleepCount === 1 ? '' : 's'} (${d.napCount} nap${d.napCount === 1 ? '' : 's'}), longest stretch ${formatDuration(d.longestSleepMs)}`);
    lines.push(`Feeds: ${d.feeds}${d.feeds ? ' - ' + feedLine(d, m.units) : ''}`);
    lines.push(`Diapers: ${d.diapers} (${d.pee} wet, ${d.poo} dirty${d.dry ? `, ${d.dry} dry` : ''})`);
    if (d.pumps) lines.push(`Pumping: ${d.pumps} session${d.pumps === 1 ? '' : 's'}${d.pumpMl ? `, ${formatAmount(d.pumpMl, m.units)}` : ''}`);
  } else {
    lines.push(`Daily average (${s.daysWithData} day${s.daysWithData === 1 ? '' : 's'} with data)`);
    lines.push(`Sleep: ${formatDuration(s.avg.sleepMs)} per day, ${s.avg.napCount.toFixed(1)} naps, avg longest stretch ${formatDuration(s.avg.longestSleepMs)}, longest overall ${formatDuration(s.longestSleepMs)}`);
    lines.push(`Feeds: ${s.avg.feeds.toFixed(1)} per day (${s.totals.feeds} total${s.totals.bottleMl ? `, bottle ${formatAmount(s.totals.bottleMl, m.units)} total` : ''})`);
    lines.push(`Diapers: ${s.avg.diapers.toFixed(1)} per day (${s.totals.diapers} total)`);
    if (s.totals.pumpMl) lines.push(`Pumped: ${formatAmount(s.totals.pumpMl, m.units)} total`);
    lines.push('');
    lines.push('Day by day');
    for (const d of s.days) {
      lines.push(`${dShort(d.dayStart)}: sleep ${formatDuration(d.sleepMs)}, longest ${formatDuration(d.longestSleepMs)}, feeds ${d.feeds}, diapers ${d.diapers}`);
    }
  }
  if (m.notes.length) {
    lines.push('');
    lines.push('Notes');
    for (const n of m.notes) lines.push('- ' + n);
  }
  lines.push('');
  lines.push(`Generated ${new Date(m.generatedAt).toLocaleString()} by Nestlog`);
  return lines.join('\n');
}

/* ------------------------------ PNG ------------------------------ */

const C = {
  bg: '#fbf7f1',
  card: '#ffffff',
  line: '#e6dccd',
  ink: '#2b2a3a',
  mute: '#716a7d',
  sleep: '#5b5fc7',
  feed: '#d9822b',
  diaper: '#3f9a6c',
  pump: '#b0508f',
};

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export const PNG_WIDTH = 1080;

export function drawSharePng(canvas: HTMLCanvasElement, m: ShareModel): void {
  const s = m.summary;
  const W = PNG_WIDTH;
  const pad = 56;
  const chartH = 300;
  const noteLines = m.notes.slice(0, 6).length;
  const H = pad + 20 + 150 + 2 * 190 + 40 + chartH + 40 + (noteLines ? 60 + noteLines * 38 : 0) + 100;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser');
  const font = (px: number, weight = 400) => `${weight} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  let y = pad + 20;
  ctx.fillStyle = C.ink;
  ctx.font = font(64, 700);
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(m.childName + (m.age ? `  ·  ${m.age}` : ''), pad, y + 40);
  ctx.font = font(32, 400);
  ctx.fillStyle = C.mute;
  ctx.fillText(m.rangeLabel, pad, y + 90);
  y += 150;

  const one = m.dayCount === 1;
  const d0 = s.days[0];
  const tiles: { label: string; value: string; sub: string; color: string }[] = one
    ? [
        { label: 'Total sleep', value: formatDuration(d0.sleepMs), sub: `${d0.sleepCount} sleep${d0.sleepCount === 1 ? '' : 's'}, ${d0.napCount} nap${d0.napCount === 1 ? '' : 's'}`, color: C.sleep },
        { label: 'Longest stretch', value: formatDuration(d0.longestSleepMs), sub: 'single sleep', color: C.sleep },
        { label: 'Feeds', value: String(d0.feeds), sub: feedLine(d0, m.units) || 'none logged', color: C.feed },
        { label: 'Diapers', value: String(d0.diapers), sub: `${d0.pee} wet, ${d0.poo} dirty`, color: C.diaper },
      ]
    : [
        { label: 'Avg sleep per day', value: formatDuration(s.avg.sleepMs), sub: `${s.avg.napCount.toFixed(1)} naps per day`, color: C.sleep },
        { label: 'Longest stretch', value: formatDuration(s.longestSleepMs), sub: `avg ${formatDuration(s.avg.longestSleepMs)} per day`, color: C.sleep },
        { label: 'Avg feeds per day', value: s.avg.feeds.toFixed(1), sub: `${s.totals.feeds} in ${m.dayCount} days`, color: C.feed },
        { label: 'Avg diapers per day', value: s.avg.diapers.toFixed(1), sub: `${s.totals.diapers} in ${m.dayCount} days`, color: C.diaper },
      ];
  const tw = (W - pad * 2 - 24) / 2;
  tiles.forEach((t, i) => {
    const x = pad + (i % 2) * (tw + 24);
    const ty = y + Math.floor(i / 2) * 190;
    ctx.fillStyle = C.card;
    rr(ctx, x, ty, tw, 166, 24);
    ctx.fill();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = t.color;
    ctx.fillRect(x, ty + 26, 8, 114);
    ctx.fillStyle = C.mute;
    ctx.font = font(26, 500);
    ctx.fillText(t.label, x + 32, ty + 52);
    ctx.fillStyle = C.ink;
    ctx.font = font(60, 700);
    ctx.fillText(t.value, x + 32, ty + 110);
    ctx.fillStyle = C.mute;
    ctx.font = font(24, 400);
    ctx.fillText(t.sub.length > 44 ? t.sub.slice(0, 43) + '…' : t.sub, x + 32, ty + 146);
  });
  y += 2 * 190 + 40;

  // chart
  ctx.fillStyle = C.card;
  rr(ctx, pad, y, W - pad * 2, chartH, 24);
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.stroke();
  ctx.fillStyle = C.ink;
  ctx.font = font(28, 600);
  const cx = pad + 32;
  const cw = W - pad * 2 - 64;
  if (one) {
    ctx.fillText('Sleep across the day', cx, y + 52);
    const by = y + 90;
    ctx.fillStyle = '#efe8dc';
    rr(ctx, cx, by, cw, 90, 12);
    ctx.fill();
    ctx.fillStyle = C.sleep;
    for (const seg of m.daySleepSegments) ctx.fillRect(cx + seg.from * cw, by, Math.max(2, (seg.to - seg.from) * cw), 90);
    ctx.fillStyle = C.mute;
    ctx.font = font(22, 400);
    [0, 6, 12, 18, 24].forEach((h) => {
      const label = h === 0 || h === 24 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`;
      const tx = cx + (h / 24) * cw;
      ctx.textAlign = h === 0 ? 'left' : h === 24 ? 'right' : 'center';
      ctx.fillText(label, tx, by + 126);
    });
    ctx.textAlign = 'left';
  } else {
    ctx.fillText('Sleep per day', cx, y + 52);
    const base = y + chartH - 56;
    const top = y + 90;
    const max = Math.max(1, ...s.days.map((d) => d.sleepMs));
    const gap = 12;
    const bw = (cw - gap * (s.days.length - 1)) / s.days.length;
    s.days.forEach((d, i) => {
      const h = ((base - top) * d.sleepMs) / max;
      const x = cx + i * (bw + gap);
      ctx.fillStyle = C.sleep;
      if (h > 0) rr(ctx, x, base - h, bw, h, Math.min(8, bw / 2));
      if (h > 0) ctx.fill();
      ctx.fillStyle = C.mute;
      ctx.font = font(bw < 50 ? 16 : 20, 400);
      ctx.textAlign = 'center';
      const label = new Date(d.dayStart).toLocaleDateString([], { weekday: 'short' }) + (s.days.length > 7 ? '' : '');
      ctx.fillText(s.days.length > 10 ? String(new Date(d.dayStart).getDate()) : label, x + bw / 2, base + 30);
      if (d.sleepMs > 0 && bw >= 50) {
        ctx.fillStyle = C.ink;
        ctx.font = font(20, 600);
        ctx.fillText(formatDuration(d.sleepMs), x + bw / 2, base - h - 10);
      }
    });
    ctx.textAlign = 'left';
  }
  y += chartH + 40;

  if (noteLines) {
    ctx.fillStyle = C.ink;
    ctx.font = font(28, 600);
    ctx.fillText('Notes', pad, y + 20);
    ctx.font = font(24, 400);
    ctx.fillStyle = C.mute;
    m.notes.slice(0, 6).forEach((n, i) => ctx.fillText(n.length > 80 ? n.slice(0, 79) + '…' : n, pad, y + 62 + i * 38));
    y += 60 + noteLines * 38;
  }

  ctx.fillStyle = C.mute;
  ctx.font = font(22, 400);
  ctx.fillText(`Generated ${new Date(m.generatedAt).toLocaleDateString()} by Nestlog. Tracked by a parent, not a medical record.`, pad, H - 48);
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the PNG'))), 'image/png');
  });
}
