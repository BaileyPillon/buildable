// One model feeds both the on-screen receipt and the PNG export, so they can never disagree.
import type { Verdict } from '../types';
import type { Derived } from './derive';
import { rangeLabel, pad2 } from './format';
import { VERDICTS } from './verdicts';

export type ReceiptLine = { label: string; hiddenLabel: string; amount: number };
export type ReceiptGroup = {
  key: 'build' | 'haggle' | 'rotate' | 'cancel';
  label: string;
  amount: number;
};
export type Bar = { x: number; w: number; verdict: Verdict };

export type ReceiptModel = {
  range: string;
  lines: ReceiptLine[];
  totalYear: number;
  perMonth: number;
  groups: ReceiptGroup[];
  claudeCostYear: number;
  keepYear: number;
  hours: number;
  bars: Bar[];
  barUnits: number;
};

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A decorative barcode. Widths are pseudo-random but fixed; colors follow where the money goes. */
export function makeBars(weights: Partial<Record<Verdict, number>>, count = 54): { bars: Bar[]; units: number } {
  const entries = VERDICTS.map((v) => [v, Math.max(0, weights[v] ?? 0)] as const).filter(([, w]) => w > 0);
  const total = entries.reduce((n, [, w]) => n + w, 0) || 1;
  const rand = lcg(20261103);
  const bars: Bar[] = [];
  let x = 0;
  for (let i = 0; i < count; i++) {
    let pick = rand() * total;
    let verdict: Verdict = entries[0]?.[0] ?? 'keep';
    for (const [v, w] of entries) {
      pick -= w;
      if (pick <= 0) {
        verdict = v;
        break;
      }
    }
    const w = 1 + Math.floor(rand() * rand() * 4);
    bars.push({ x, w, verdict });
    x += w + 1 + (rand() < 0.3 ? 1 : 0);
  }
  return { bars, units: x };
}

export function buildReceiptModel(d: Derived, start: string, end: string): ReceiptModel {
  const sorted = [...d.active].sort((a, b) => b.series.annualCost - a.series.annualCost);
  const lines: ReceiptLine[] = sorted.map((a, i) => ({
    label: a.series.displayName,
    hiddenLabel: `Subscription ${pad2(i + 1)}`,
    amount: a.series.annualCost,
  }));
  const weights: Partial<Record<Verdict, number>> = {};
  for (const a of d.active) weights[a.verdict] = (weights[a.verdict] ?? 0) + a.series.annualCost;
  const { bars, units } = makeBars(weights);
  const t = d.totals;
  return {
    range: rangeLabel(start, end).toUpperCase(),
    lines,
    totalYear: t.totalYear,
    perMonth: t.perMonth,
    groups: [
      { key: 'build', label: 'BUILDABLE (absorb+rebuild+selfhost)', amount: t.build },
      { key: 'haggle', label: 'HAGGLE', amount: t.haggle },
      { key: 'rotate', label: 'ROTATE', amount: t.rotate },
      { key: 'cancel', label: 'CANCEL', amount: t.cancel },
    ],
    claudeCostYear: t.claudeCostYear,
    keepYear: t.keepYear,
    hours: t.buildHours,
    bars,
    barUnits: units,
  };
}

/** Static example used as the decorative receipt on the landing page. Generic, no brand names. */
export function sampleReceiptModel(): ReceiptModel {
  const rows: [string, number, Verdict][] = [
    ['Home internet', 959.88, 'haggle'],
    ['Mobile plan', 1020, 'haggle'],
    ['Video streaming x3', 636.0, 'rotate'],
    ['Cloud storage', 143.88, 'selfhost'],
    ['AI chat, second seat', 240, 'absorb'],
    ['Baby sleep tracker', 179.88, 'rebuild'],
    ['Transcription app', 203.88, 'rebuild'],
    ['Calorie counter', 239.88, 'cancel'],
    ['Booking page', 144, 'rebuild'],
    ['Writing assistant', 139.95, 'absorb'],
  ];
  const sorted = [...rows].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((n, r) => n + r[1], 0);
  const sum = (vs: Verdict[]): number =>
    sorted.filter((r) => vs.includes(r[2])).reduce((n, r) => n + r[1] * (r[2] === 'haggle' ? 0.2 : r[2] === 'rotate' ? 0.6 : 0.85), 0);
  const weights: Partial<Record<Verdict, number>> = {};
  for (const r of sorted) weights[r[2]] = (weights[r[2]] ?? 0) + r[1];
  const { bars, units } = makeBars(weights);
  const build = Math.round(sum(['absorb', 'rebuild', 'selfhost']));
  const haggle = Math.round(sum(['haggle']));
  const rotate = Math.round(sum(['rotate']));
  const cancel = Math.round(sum(['cancel']));
  return {
    range: 'SAMPLE · 12 MONTHS',
    lines: sorted.map((r, i) => ({ label: r[0], hiddenLabel: `Subscription ${pad2(i + 1)}`, amount: r[1] })),
    totalYear: Math.round(total * 100) / 100,
    perMonth: Math.round((total / 12) * 100) / 100,
    groups: [
      { key: 'build', label: 'BUILDABLE (absorb+rebuild+selfhost)', amount: build },
      { key: 'haggle', label: 'HAGGLE', amount: haggle },
      { key: 'rotate', label: 'ROTATE', amount: rotate },
      { key: 'cancel', label: 'CANCEL', amount: cancel },
    ],
    claudeCostYear: 0,
    keepYear: build + haggle + rotate + cancel,
    hours: 31,
    bars,
    barUnits: units,
  };
}
