// Pure view-model derivation from assess() output. No React in here.
import type { Assessment, Summary, Verdict } from '../types';
import { BUILD_VERDICTS, OTHER_VERDICTS, isBuild } from './verdicts';

export type Group = {
  verdict: Verdict;
  items: Assessment[];
  costYear: number;
  savingsYear: number;
};

export type Totals = {
  totalYear: number;
  perMonth: number;
  /** Savings by route, unblocked and active only. */
  build: number;
  haggle: number;
  rotate: number;
  cancel: number;
  savingsYear: number;
  buildHours: number;
  claudeCostYear: number;
  /** savingsYear minus claudeCostYear, never below zero. */
  keepYear: number;
  activeCount: number;
};

export type Derived = {
  active: Assessment[];
  inactive: Assessment[];
  queue: Assessment[];
  /** Store bundles (APPLE.COM/BILL etc.) waiting for the user to pick the app. */
  needsPick: Assessment[];
  groups: Group[];
  unrecognized: Assessment[];
  totals: Totals;
};

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const r2 = (n: number): number => Math.round(n * 100) / 100;

export function derive(items: Assessment[], summary: Summary): Derived {
  const active = items.filter((i) => i.series.active);
  const inactive = items
    .filter((i) => !i.series.active)
    .sort((a, b) => b.series.lastSeen.localeCompare(a.series.lastSeen));

  const needsPick: Assessment[] = [];
  const unrecognized: Assessment[] = [];
  const queue: Assessment[] = [];
  const byVerdict = new Map<Verdict, Assessment[]>();

  for (const it of active) {
    if (!it.merchant) {
      if (it.series.candidates && it.series.candidates.length > 0) needsPick.push(it);
      else unrecognized.push(it);
    } else if (isBuild(it.verdict)) {
      queue.push(it);
    } else {
      const list = byVerdict.get(it.verdict) ?? [];
      list.push(it);
      byVerdict.set(it.verdict, list);
    }
  }

  queue.sort((a, b) => {
    const ba = a.blocked ? 1 : 0;
    const bb = b.blocked ? 1 : 0;
    if (ba !== bb) return ba - bb;
    const ra = a.roiPerHour ?? -1;
    const rb = b.roiPerHour ?? -1;
    if (ra !== rb) return rb - ra;
    return b.savingsYear - a.savingsYear;
  });
  needsPick.sort((a, b) => b.series.annualCost - a.series.annualCost);
  unrecognized.sort((a, b) => b.series.annualCost - a.series.annualCost);

  const groups: Group[] = [];
  for (const v of OTHER_VERDICTS) {
    const list = byVerdict.get(v);
    if (!list || list.length === 0) continue;
    list.sort((a, b) => b.savingsYear - a.savingsYear || b.series.annualCost - a.series.annualCost);
    groups.push({
      verdict: v,
      items: list,
      costYear: r2(sum(list.map((i) => i.series.annualCost))),
      savingsYear: r2(sum(list.filter((i) => !i.blocked).map((i) => i.savingsYear))),
    });
  }

  const saved = (pred: (i: Assessment) => boolean): number =>
    r2(sum(active.filter((i) => !i.blocked && pred(i)).map((i) => i.savingsYear)));
  const build = saved((i) => BUILD_VERDICTS.includes(i.verdict));
  const haggle = saved((i) => i.verdict === 'haggle');
  const rotate = saved((i) => i.verdict === 'rotate');
  const cancel = saved((i) => i.verdict === 'cancel');
  const savingsYear = r2(build + haggle + rotate + cancel);
  const totalYear = r2(sum(active.map((i) => i.series.annualCost)));
  const claudeCostYear = summary.claudeCostYear;

  return {
    active,
    inactive,
    queue,
    needsPick,
    groups,
    unrecognized,
    totals: {
      totalYear,
      perMonth: r2(totalYear / 12),
      build,
      haggle,
      rotate,
      cancel,
      savingsYear,
      buildHours: sum(
        active.filter((i) => !i.blocked && BUILD_VERDICTS.includes(i.verdict)).map((i) => i.hours),
      ),
      claudeCostYear,
      keepYear: Math.max(0, r2(savingsYear - claudeCostYear)),
      activeCount: active.length,
    },
  };
}

/** Net price rise across the series, for the badge. Null when prices did not go up. */
export function priceHike(a: Assessment): { amount: number; since: string } | null {
  const changes = a.series.priceChanges;
  if (changes.length === 0) return null;
  const first = changes[0]!;
  const last = changes[changes.length - 1]!;
  const net = Math.round((last.to - first.from) * 100) / 100;
  if (net <= 0) return null;
  return { amount: net, since: first.date };
}

/** The name a card shows. A store-billed charge the user has identified reads "iCloud+ (billed via App Store)". */
export function cardName(a: Assessment): string {
  const s = a.series;
  if (a.merchant && s.candidates && s.candidates.length > 0) {
    const store = /^Google Play/.test(s.displayName) ? 'Google Play' : 'App Store';
    return `${a.merchant.name} (billed via ${store})`;
  }
  return s.displayName;
}

/** Where a card sits on the results page, so a change that moves it can be announced. */
export function locationOf(d: Derived, key: string): { id: string; label: string } | null {
  if (d.queue.some((i) => i.series.key === key)) return { id: 'queue', label: 'the build queue' };
  if (d.needsPick.some((i) => i.series.key === key)) return { id: 'pick', label: 'Everything else, under Pick the app' };
  for (const g of d.groups) {
    if (g.items.some((i) => i.series.key === key)) {
      const label = g.verdict.charAt(0).toUpperCase() + g.verdict.slice(1);
      return { id: `else:${g.verdict}`, label: `Everything else, under ${label}` };
    }
  }
  if (d.unrecognized.some((i) => i.series.key === key)) return { id: 'unrecognized', label: 'Unrecognized' };
  if (d.inactive.some((i) => i.series.key === key)) return { id: 'gone', label: 'Already gone' };
  return null;
}
