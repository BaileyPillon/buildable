// Assessment (SPEC.md "Assessment rules"): series + KB merchant + Context -> verdict, savings, hours.
import type {
  Assessment, Context, Device, Merchant, RecurringSeries, Summary, Verdict,
} from '../types';

/**
 * Claude Pro list price, USD per month, used for Summary.claudeCostYear when the user does not pay for
 * Claude yet (claudeCostYear = CLAUDE_PRO_MONTHLY * 12, i.e. the month-to-month price, deliberately not the
 * cheaper yearly plan, so net savings are never overstated).
 *
 * Reconciled with the knowledge base: the `claude-pro` entry in src/kb/categories/ai.json has
 * typicalMonthly 20 (pricesCheckedAt 2026-11; yearly billing is $200 upfront, about $17 a month). Sources
 * that entry cites: https://claude.com/pricing (plans and prices),
 * https://support.claude.com/en/articles/8325617-cancel-your-pro-max-or-ultra-subscription (billing and
 * cancellation), https://support.claude.com/en/articles/12386328-request-a-refund-for-a-paid-claude-plan,
 * https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-max-or-ultra-plan.
 * assess.test.ts checks this constant against the real KB entry, so a KB price change cannot drift silently.
 */
export const CLAUDE_PRO_MONTHLY = 20;

export const VERDICTS: Verdict[] = ['absorb', 'rebuild', 'selfhost', 'haggle', 'rotate', 'cancel', 'keep'];
const BUILD_VERDICTS: Verdict[] = ['absorb', 'rebuild', 'selfhost'];

const DEVICE_NOUN: Record<Device, { withArticle: string; bare: string }> = {
  'old-laptop': { withArticle: 'an old laptop', bare: 'old laptop' },
  'spare-pc': { withArticle: 'a spare PC', bare: 'spare PC' },
  'raspberry-pi': { withArticle: 'a Raspberry Pi', bare: 'Raspberry Pi' },
  nas: { withArticle: 'a NAS', bare: 'NAS' },
  'old-android': { withArticle: 'an old Android phone', bare: 'old Android phone' },
  'old-iphone': { withArticle: 'an old iPhone', bare: 'old iPhone' },
  'old-ipad': { withArticle: 'an old iPad', bare: 'old iPad' },
  kindle: { withArticle: 'a Kindle', bare: 'Kindle' },
};

/** "Needs an old laptop, Raspberry Pi or NAS" */
export function blockedMessage(hardware: Device[]): string {
  const names = hardware.map((d, i) => (i === 0 ? DEVICE_NOUN[d]?.withArticle : DEVICE_NOUN[d]?.bare) ?? d);
  if (names.length === 0) return 'Needs a spare device';
  if (names.length === 1) return `Needs ${names[0]}`;
  return `Needs ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

function planHours(merchant: Merchant, verdict: Verdict): number {
  switch (verdict) {
    case 'absorb': return 0.5;
    case 'rebuild': return merchant.plans.rebuild?.hours ?? 0;
    case 'selfhost': return merchant.plans.selfhost?.hours ?? 0;
    case 'haggle': return 0.5;
    case 'rotate': return 0.25;
    case 'cancel': return 0.25;
    case 'keep': return 0;
  }
}

function savingsFor(verdict: Verdict, annual: number, merchant: Merchant | null): number {
  let s = 0;
  switch (verdict) {
    case 'cancel':
    case 'absorb':
      s = annual;
      break;
    case 'rebuild':
      s = annual - (merchant?.plans.rebuild?.ongoingCostYear ?? 0);
      break;
    case 'selfhost':
      s = annual - (merchant?.plans.selfhost?.powerCostYear ?? 0);
      break;
    case 'haggle': {
      const d = merchant?.plans.haggle?.expectedDiscountPct;
      s = d ? (annual * (d[0] + d[1])) / 2 / 100 : 0;
      break;
    }
    case 'rotate':
      s = (annual * (merchant?.plans.rotate?.monthsOffPerYear ?? 0)) / 12;
      break;
    case 'keep':
      s = 0;
  }
  return Math.max(0, round2(s));
}

/** A verdict is usable for a merchant only if the plan it needs exists (cancel and keep always work). */
function feasible(merchant: Merchant | null, verdict: Verdict): boolean {
  if (verdict === 'keep' || verdict === 'cancel') return true;
  if (!merchant) return false;
  return !!merchant.plans[verdict];
}

function reasonFor(
  verdict: Verdict,
  merchant: Merchant | null,
  series: RecurringSeries,
  unused: boolean,
  primary: boolean,
  savings: number,
  hours: number,
): string {
  if (!merchant) {
    return series.candidates && series.candidates.length
      ? 'Not in our catalog yet. Pick which app this is to see options.'
      : 'Not in our catalog yet';
  }
  if (unused && verdict === 'cancel') return `You said you barely use it, so cancelling saves ${money(series.annualCost)} a year.`;
  if (primary && merchant.why) return merchant.why;
  const name = merchant.name;
  switch (verdict) {
    case 'absorb': return `Claude can do this job, so ${name} is a cost you can drop.`;
    case 'rebuild': return `Claude Code can build you a free version of ${name} in about ${hours} hours.`;
    case 'selfhost': return `You can run ${merchant.plans.selfhost?.software[0] ?? 'an open-source alternative'} yourself in about ${hours} hours.`;
    case 'haggle': {
      const d = merchant.plans.haggle?.expectedDiscountPct;
      return d ? `Ask for a better rate: ${d[0]} to ${d[1]} percent off is a realistic target.` : 'Ask for a better rate.';
    }
    case 'rotate': return `Subscribe only when you will use it; about ${merchant.plans.rotate?.monthsOffPerYear ?? 0} months off a year.`;
    case 'cancel': return `Cancelling ${name} saves ${money(savings)} a year.`;
    case 'keep': return `Worth keeping as it is.`;
  }
}

export type AssessOptions = { statementStart?: string; statementEnd?: string };

/**
 * Assess every series. Inactive series ("Already gone") are returned too, with verdict `keep`, no savings and
 * no weight in the summary. `opts` lets the caller pass the true statement range (from the transactions);
 * without it the range is inferred from the series.
 */
export function assess(
  series: RecurringSeries[],
  kb: Merchant[],
  ctx: Context,
  opts: AssessOptions = {},
): { items: Assessment[]; summary: Summary } {
  const byId = new Map<string, Merchant>();
  for (const m of kb) byId.set(m.id, m);
  const devices = new Set(ctx.devices);
  const unusedSet = new Set(ctx.unused);

  const items: Assessment[] = [];
  for (const s of series) {
    const picked = ctx.merchantOverrides?.[s.key];
    const merchant = (picked ? byId.get(picked) : undefined) ?? (s.merchantId ? byId.get(s.merchantId) ?? null : null);

    if (!s.active) {
      items.push({
        series: s, merchant, verdict: 'keep', savingsYear: 0, hours: 0, roiPerHour: null,
        reason: `Already gone: last charged ${s.lastSeen}.`,
      });
      continue;
    }

    // verdict: merchant default, then "barely use" -> cancel, then an explicit user choice wins
    let verdict: Verdict = merchant ? merchant.verdict : 'keep';
    let primary = !!merchant;
    const isUnused = unusedSet.has(s.key);
    if (isUnused) {
      verdict = 'cancel';
      primary = false;
    }
    const override = ctx.verdictOverrides?.[s.key];
    if (override && VERDICTS.includes(override) && feasible(merchant, override)) {
      verdict = override;
      primary = !!merchant && override === merchant.verdict;
    }
    if (!feasible(merchant, verdict)) {
      // KB entry lacks the plan its verdict needs: do not claim savings we cannot back
      verdict = 'keep';
      primary = false;
    }

    let blocked: string | undefined;
    if (verdict === 'selfhost' && merchant?.plans.selfhost) {
      const hw = merchant.plans.selfhost.hardware;
      if (!hw.some((d) => devices.has(d))) blocked = blockedMessage(hw);
    }

    const hours = verdict === 'keep' ? 0 : verdict === 'cancel' ? 0.25 : merchant ? planHours(merchant, verdict) : 0;
    const savingsYear = merchant || verdict === 'cancel' ? savingsFor(verdict, s.annualCost, merchant) : 0;
    const a: Assessment = {
      series: s,
      merchant,
      verdict,
      savingsYear,
      hours,
      roiPerHour: hours > 0 ? round2(savingsYear / hours) : null,
      reason: reasonFor(verdict, merchant, s, isUnused, primary, savingsYear, hours),
    };
    if (blocked) a.blocked = blocked;
    items.push(a);
  }

  const emptyBy = () => ({ count: 0, costYear: 0, savingsYear: 0 });
  const byVerdict = Object.fromEntries(VERDICTS.map((v) => [v, emptyBy()])) as Summary['byVerdict'];
  let totalYear = 0, savingsYear = 0, buildHours = 0, anyBuild = false;
  let start = opts.statementStart ?? '';
  let end = opts.statementEnd ?? '';
  for (const s of series) {
    if (!opts.statementStart && (!start || s.firstSeen < start)) start = s.firstSeen;
    if (!opts.statementEnd && (!end || s.lastSeen > end)) end = s.lastSeen;
  }
  for (const it of items) {
    if (!it.series.active) continue;
    totalYear += it.series.annualCost;
    const b = byVerdict[it.verdict];
    b.count++;
    b.costYear += it.series.annualCost;
    if (it.blocked) continue; // blocked items are not savings you can bank today
    b.savingsYear += it.savingsYear;
    savingsYear += it.savingsYear;
    if (BUILD_VERDICTS.includes(it.verdict)) {
      buildHours += it.hours;
      anyBuild = true;
    }
  }
  for (const v of VERDICTS) {
    byVerdict[v].costYear = round2(byVerdict[v].costYear);
    byVerdict[v].savingsYear = round2(byVerdict[v].savingsYear);
  }
  // Every build verdict needs Claude: ABSORB is Claude itself, and every REBUILD / SELFHOST prompt is written for
  // Claude Code, which needs a paid plan or API credits. So the plan is a first-year cost as soon as one unblocked
  // absorb, rebuild or selfhost item is counted, counted once however many there are.
  const claudeCostYear = ctx.claudePlan === 'none' && anyBuild ? CLAUDE_PRO_MONTHLY * 12 : 0;
  const summary: Summary = {
    statementStart: start,
    statementEnd: end,
    totalYear: round2(totalYear),
    byVerdict,
    savingsYear: round2(savingsYear),
    buildHours: round2(buildHours),
    claudeCostYear,
    netSavingsYear: round2(savingsYear - claudeCostYear),
  };
  return { items, summary };
}

/** Build queue: absorb + rebuild + selfhost items of active series, unblocked first, by savings per hour. */
export function buildQueue(items: Assessment[]): Assessment[] {
  return items
    .filter((i) => i.series.active && BUILD_VERDICTS.includes(i.verdict))
    .sort((a, b) => {
      const ab = a.blocked ? 1 : 0, bb = b.blocked ? 1 : 0;
      if (ab !== bb) return ab - bb;
      const ar = a.roiPerHour ?? -1, br = b.roiPerHour ?? -1;
      return br - ar || b.savingsYear - a.savingsYear;
    });
}

/** Net value of following a verdict once the user's time is priced in (savings minus hours * hourlyValue). */
export function netOfTime(item: Assessment, ctx: Context): number {
  return round2(item.savingsYear - item.hours * ctx.hourlyValue);
}
