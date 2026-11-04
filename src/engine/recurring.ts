// Recurring-charge detection (SPEC.md "Recurrence rules").
//
// Pipeline: charges -> pre-group by merchant key -> KB match -> exclusions -> amount clusters ->
// chain price levels together -> cadence + regularity -> confidence -> RecurringSeries[].
import type { Cadence, Merchant, RecurringSeries, Txn } from '../types';
import { achPurpose, bundleOf, merchantKey, normalizeDescriptor, slug, titleCase } from './normalize';
import { bundleCandidates, matchGroup, matchesAnnualHint, pickByAmount } from './match';

export const PERIODS_PER_YEAR: Record<Cadence, number> = {
  weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, semiannual: 2, annual: 1,
};
export const CADENCE_DAYS: Record<Cadence, number> = {
  weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, semiannual: 182, annual: 365,
};
/** Median-interval ranges in days (inclusive), SPEC rule 4. */
const RANGES: [Cadence, number, number][] = [
  ['weekly', 6, 8], ['biweekly', 13, 16], ['monthly', 26, 35],
  ['quarterly', 85, 97], ['semiannual', 175, 190], ['annual', 350, 380],
];
const CADENCE_SUFFIX: Record<Cadence, string> = {
  weekly: '/wk', biweekly: '/2wk', monthly: '/mo', quarterly: '/qtr', semiannual: '/6mo', annual: '/yr',
};

// Non-subscription keywords (SPEC rule 1). Applied to the normalized descriptor of UNMATCHED charges only:
// a KB match always wins ("PLANET FITNESS MONTHLY FEE" is a subscription).
const EXCLUDE_RE =
  /\b(?:ZELLE|VENMO|CASH ?APP|TRANSFER|XFER|ATM|WITHDRAWAL|THANK YOU|AUTOPAY|INTEREST|FEES?|IRS|TAX|TREASURY|LOAN|NELNET|NAVIENT|MOHELA|AIDVANTAGE|GREAT LAKES|SALLIE MAE|SOFI LOAN|MORTGAGE|INSTALLMENTS?|RENT|PAYROLL|DIRECT ?DEP|DEPOSIT|OVERDRAFT|WIRE|REFUND|CRD|SERVICE CHARGE|MAINTENANCE|CHECK \d*|NSF)\b/;
// Normalization cuts a bank's ACH blob down to the originator ("ORIG CO NAME:NELNET ... CO ENTRY DESCR:LOAN PMT"
// becomes "NELNET"), which drops the field that says what the payment is. EXCLUDE_RE therefore also runs over the
// blob's purpose field, with a narrower list: a generic purpose such as AUTOPAY or MEMBER FEE is how real
// subscriptions (a storage unit, a gym) are billed by ACH, so those words must not exclude here.
const EXCLUDE_PURPOSE_RE =
  /\b(?:LOANS?|MORTGAGE|PAYROLL|DIRECT ?DEP|DEPOSIT|TAX|IRS|TREASURY|TRANSFER|XFER|INTEREST|REFUND|WIRE|RENT|ZELLE|VENMO|CASH ?APP|INSTALLMENTS?)\b/;
// Everyday spending that repeats without being a subscription. Also unmatched-only.
const NOISE_RE =
  /\b(?:STARBUCKS|DUNKIN|MCDONALD'?S?|WENDY'?S?|BURGER KING|CHIPOTLE|SUBWAY|TACO BELL|CHICK-?FIL-?A|PANERA|DOMINO'?S?|PAPA JOHN|PIZZA|WHOLE ?FOODS?|TRADER JOE'?S?|KROGER|SAFEWAY|PUBLIX|WEGMANS|ALDI|COSTCO|WALMART|WAL-MART|TARGET|CVS|WALGREENS|RITE AID|SHELL|CHEVRON|EXXON|MOBIL|SUNOCO|7-?ELEVEN|WAWA|SHEETZ|SPEEDWAY|HOME ?DEPOT|LOWE'?S|IKEA|BEST BUY|AMZN ?MKTP|AMZNMKTPLACE|AMAZON ?MKTPLACE|AMAZON MARKETPLACE|AMAZON EU|AMAZON\.(?:COM|CO\.UK|DE|FR|ES|IT|CA|NL)|DOORDASH|GRUBHUB|INSTACART|LYFT|PARKING|PARKMOBILE|TOLLS?|UBER(?! ONE))\b/;

const MAX_UNMATCHED_CHARGE = 400;

// ---------------------------------------------------------------------------------------------
// Small helpers

/** Days since 1970-01-01 for a YYYY-MM-DD string (no Date allocation). */
export function dayNum(date: string): number {
  const y = +date.slice(0, 4), m = +date.slice(5, 7), d = +date.slice(8, 10);
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  if (!n) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function cadenceOf(med: number): Cadence | null {
  const m = Math.round(med);
  for (const [c, lo, hi] of RANGES) if (m >= lo && m <= hi) return c;
  return null;
}
function rangeOf(c: Cadence): [number, number] {
  const r = RANGES.find((x) => x[0] === c)!;
  return [r[1], r[2]];
}

type Item = { date: string; day: number; amount: number; raw: string; norm: string; used?: boolean };
type Pre = { raw: string; upper: string; norm: string; key: string; bundle: 'apple' | 'google' | null; purpose: string; group?: Merchant[] };
type Ctx = {
  merchant: Merchant | null;
  bundle: 'apple' | 'google' | null;
  hasCandidates: boolean;
  variable: boolean;
  /** charges at this merchant key, all amounts: an unrecognized series must explain most of them */
  groupSize?: number;
};
type Built = Omit<RecurringSeries, 'key' | 'displayName'> & { items: Item[]; levelAmount: number };

// ---------------------------------------------------------------------------------------------
// Clustering

/** Group charges whose amounts sit within a tolerance of the cluster's lowest amount. */
function clusterAmounts(items: Item[], bundle: boolean): Item[][] {
  const sorted = [...items].sort((a, b) => a.amount - b.amount || a.day - b.day);
  const out: Item[][] = [];
  let cur: Item[] = [];
  let lo = 0;
  for (const it of sorted) {
    if (!cur.length) {
      cur = [it];
      lo = it.amount;
      continue;
    }
    // bundles carry exact price points (0.99 vs 1.99), so they cluster much tighter than the spec's $1/8%
    const tol = bundle ? Math.max(0.02, lo * 0.015) : Math.max(1, lo * 0.08);
    if (it.amount - lo <= tol + 1e-9) cur.push(it);
    else {
      out.push(cur);
      cur = [it];
      lo = it.amount;
    }
  }
  if (cur.length) out.push(cur);
  for (const c of out) c.sort((a, b) => a.day - b.day);
  return out;
}

function segmentCadenceGuess(seg: Item[], other: Item[], gap: number): Cadence | null {
  const meds = (s: Item[]) => {
    const iv: number[] = [];
    for (let i = 1; i < s.length; i++) if (s[i].day - s[i - 1].day > 3) iv.push(s[i].day - s[i - 1].day);
    return iv.length ? median(iv) : null;
  };
  const m = meds(seg) ?? meds(other) ?? gap;
  return cadenceOf(m);
}

/** Cadence implied by a segment's own charge-to-charge gaps; null when it has fewer than two distinct charges. */
function ownCadence(seg: Item[]): Cadence | null {
  const iv: number[] = [];
  for (let i = 1; i < seg.length; i++) if (seg[i].day - seg[i - 1].day > 3) iv.push(seg[i].day - seg[i - 1].day);
  return iv.length ? cadenceOf(median(iv)) : null;
}

/** Price jump (ratio) up to which two adjacent levels are always treated as one subscription. */
const CHAIN_RATIO = 1.8;
/**
 * KB-matched merchants may chain across a much bigger rise: intro offers ($1 or $4 a month for the first months)
 * jump 5x or more to the regular price. Such a jump only chains when it goes UP (a big drop is a plan change),
 * the gap is exactly one billing period and every multi-charge segment bills on that same cadence.
 */
export const KB_CHAIN_RATIO = 8;

/**
 * A price hike splits one subscription into two amount clusters that never overlap in time.
 * Chain such clusters back together when the gap between them looks like one billing period.
 * `maxJump` is the largest rise (new level / old level) that still chains when the cadence agrees.
 */
function chainMerge(segs: Item[][], maxJump = CHAIN_RATIO): Item[][] {
  if (segs.length < 2) return segs;
  const list = segs
    .map((s) => ({ s, first: s[0].day, last: s[s.length - 1].day, amt: median(s.map((i) => i.amount)) }))
    .sort((a, b) => a.first - b.first || a.last - b.last);
  const out: Item[][] = [];
  let cur = list[0];
  for (let i = 1; i < list.length; i++) {
    const nx = list[i];
    let merge = false;
    if (nx.first > cur.last) {
      const gap = nx.first - cur.last;
      const cad = segmentCadenceGuess(cur.s, nx.s, gap);
      const ratio = Math.max(cur.amt, nx.amt) / Math.max(0.01, Math.min(cur.amt, nx.amt));
      if (cad) {
        const [lo, hi] = rangeOf(cad);
        const periodGap = gap >= lo - 3 && gap <= hi + 6;
        const bigRise =
          maxJump > CHAIN_RATIO && nx.amt > cur.amt && ratio <= maxJump &&
          [ownCadence(cur.s), ownCadence(nx.s)].every((c) => c === null || c === cad);
        merge = periodGap && (ratio <= CHAIN_RATIO || bigRise);
      }
    }
    if (merge) cur = { s: cur.s.concat(nx.s), first: cur.first, last: nx.last, amt: nx.amt };
    else {
      out.push(cur.s);
      cur = nx;
    }
  }
  out.push(cur.s);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Evaluate a segment

function detectPriceChanges(ch: { date: string; amount: number }[]): RecurringSeries['priceChanges'] {
  const out: RecurringSeries['priceChanges'] = [];
  const near = (a: number, b: number) => Math.abs(a - b) <= b * 0.02 + 0.004;
  for (let i = 1; i < ch.length; i++) {
    const prev = ch[i - 1].amount, cur = ch[i].amount;
    if (near(cur, prev)) continue;
    const next = ch[i + 1];
    if (next && near(next.amount, prev)) {
      i++; // one-off blip (proration, tax quirk) that returns to the old level: not a price change
      continue;
    }
    if (!next || near(next.amount, cur)) out.push({ date: ch[i].date, from: round2(prev), to: round2(cur) });
  }
  return out;
}

/**
 * Share of charge-to-charge gaps that are 1x, 2x or 3x the billing period of cadence `c`. Monthly and quarterly
 * subscriptions with a "skip this month" option (meal kits, VIP memberships) leave 2x and 3x gaps that are still
 * the same subscription. Other cadences have no skip-a-cycle pattern, so only 1x counts for them.
 */
function skipTolerantRegularity(iv: number[], c: Cadence): number {
  const [lo, hi] = rangeOf(c);
  const maxK = c === 'monthly' || c === 'quarterly' ? 3 : 1;
  const ok = iv.filter((d) => {
    for (let k = 1; k <= maxK; k++) if (d >= k * lo && d <= k * hi) return true;
    return false;
  });
  return ok.length / iv.length;
}

function confidenceOf(n: number, reg: number, stab: number, kb: number): number {
  const countScore = Math.min(1, (n - 1) / 6);
  const c = 0.1 + 0.25 * countScore + 0.25 * reg + 0.2 * stab + 0.2 * kb;
  return Math.round(Math.min(1, c) * 100) / 100;
}

function evaluate(raw: Item[], ctx: Ctx, endDay: number): Built | null {
  const sorted = [...raw].sort((a, b) => a.day - b.day);
  // drop near-duplicates (retries, pending + posted pairs): a charge within 3 days of the previous kept one
  const items: Item[] = [];
  for (const it of sorted) {
    if (items.length && it.day - items[items.length - 1].day <= 3) continue;
    items.push(it);
  }
  const n = items.length;
  if (!n) return null;
  const m = ctx.merchant;
  const charges = items.map((i) => ({ date: i.date, amount: round2(i.amount) }));
  const last = items[n - 1];

  const amounts = items.map((i) => i.amount);
  let stable = 0;
  for (let i = 1; i < n; i++) if (Math.abs(amounts[i] - amounts[i - 1]) <= amounts[i - 1] * 0.02 + 0.004) stable++;
  const stableShare = n > 1 ? stable / (n - 1) : 1;
  const stab = ctx.variable ? 0.5 : stableShare;

  let cadence: Cadence;
  let reg: number;
  // true when skipped billing cycles (2x / 3x gaps) explain the gaps that fall outside the cadence range
  let skips = false;
  if (n === 1) {
    // SPEC rule 4: a lone charge counts only if KB-matched AND equal to an annual priceHint (+-3%)
    if (!m || !matchesAnnualHint(m, last.amount)) return null;
    cadence = 'annual';
    reg = 0.5;
  } else {
    const iv: number[] = [];
    for (let i = 1; i < n; i++) iv.push(items[i].day - items[i - 1].day);
    const c = cadenceOf(median(iv));
    if (!c) return null;
    cadence = c;
    const [lo, hi] = rangeOf(c);
    reg = iv.filter((d) => d >= lo && d <= hi).length / iv.length;
    if (n >= 3) {
      // Skipped cycles: when gaps of two or three periods lift the share of "on-period" gaps to 0.6 or more,
      // that is the same subscription with months skipped. A KB match is enough evidence for that. Without one
      // the series must also be flat (every amount within 2%), long (6+ charges) and anchored by mostly
      // single-period gaps, so that scattered same-price purchases still do not pass.
      const rs = skipTolerantRegularity(iv, c);
      skips = rs > reg && rs >= 0.6 && (m ? true : n >= 6 && stable === n - 1 && reg >= 0.5);
      if (reg < 0.6 && !skips) return null;
      // without a KB match, frequent cadences need more evidence: a coffee shop visited 3 times at
      // 14-day gaps is not a biweekly subscription
      if (!m && n < (c === 'weekly' ? 6 : c === 'biweekly' ? 5 : c === 'quarterly' ? 4 : 3)) return null;
    } else {
      // two charges: matching interval AND a KB match (or a bundle, whose candidates play the KB role)
      if (!(m || ctx.hasCandidates) || reg < 1) return null;
    }
  }

  if (!m) {
    // Without a KB match the evidence has to be stronger, or random spend that happens to cluster by amount
    // and land on regular-ish dates would show up as a subscription: near-identical amounts (at most one
    // persisting price change, and only with 4+ charges) and a tighter regularity.
    let tight = 0;
    for (let i = 1; i < n; i++) if (Math.abs(amounts[i] - amounts[i - 1]) <= amounts[i - 1] * 0.035 + 0.004) tight++;
    const unstable = n - 1 - tight;
    if (unstable > 1 || (unstable === 1 && n < 4)) return null;
    if (n >= 4 && reg < 0.75 && !skips) return null;
    // a gym that charges 39.00 monthly explains nearly all of its charges; a grocer whose visits happen to
    // repeat an amount does not
    if (ctx.groupSize && n / ctx.groupSize < 0.6) return null;
  }

  let currentAmount = round2(last.amount);
  let priceChanges: RecurringSeries['priceChanges'] = [];
  if (ctx.variable) {
    // variable bills (ISP, utilities, wireless): median of recent charges; last charge if two in a row agree
    const tail = amounts.slice(-6);
    const l = amounts[n - 1];
    const stableTail = n >= 2 && Math.abs(amounts[n - 2] - l) <= l * 0.02 + 0.004;
    currentAmount = round2(stableTail ? l : median(tail));
    // only a bill that is mostly flat can show a price change; a genuinely variable one cannot
    if (stableShare >= 0.7) priceChanges = detectPriceChanges(charges);
  } else {
    priceChanges = detectPriceChanges(charges);
  }

  const kbWeight = m ? 1 : ctx.hasCandidates ? 0.5 : 0;
  const confidence = confidenceOf(n, reg, stab, kbWeight);
  if (confidence < 0.5) return null;

  const active = last.day >= endDay - 1.5 * CADENCE_DAYS[cadence];
  return {
    descriptors: [],
    cadence,
    charges,
    currentAmount,
    annualCost: round2(currentAmount * PERIODS_PER_YEAR[cadence]),
    firstSeen: items[0].date,
    lastSeen: last.date,
    active,
    priceChanges,
    confidence,
    merchantId: m ? m.id : null,
    items,
    levelAmount: round2(items[0].amount),
  };
}

function topDescriptors(items: Item[]): string[] {
  const count = new Map<string, number>();
  for (const i of items) count.set(i.raw, (count.get(i.raw) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map((e) => e[0]);
}

// ---------------------------------------------------------------------------------------------
// Main

export function findRecurring(txns: Txn[], kb: Merchant[]): RecurringSeries[] {
  if (!txns.length) return [];

  // 1. charges + statement end
  let endDay = -Infinity;
  const pre = new Map<string, Pre>();
  const items: (Item & { key: string; bundle: 'apple' | 'google' | null; upper: string; p: Pre })[] = [];
  const keyCount = new Map<string, number>();
  for (const t of txns) {
    const day = dayNum(t.date);
    if (day > endDay) endDay = day;
    if (!(t.amount > 0) || !Number.isFinite(day)) continue;
    let p = pre.get(t.description);
    if (!p) {
      const raw = t.description.replace(/\s+/g, ' ').trim();
      const norm = normalizeDescriptor(raw);
      p = { raw, upper: raw.toUpperCase(), norm, key: merchantKey(norm), bundle: bundleOf(norm), purpose: achPurpose(raw) };
      pre.set(t.description, p);
    }
    items.push({ date: t.date, day, amount: t.amount, raw: p.raw, norm: p.norm, key: p.key, bundle: p.bundle, upper: p.upper, p });
    keyCount.set(p.key, (keyCount.get(p.key) ?? 0) + 1);
  }

  // 2. KB matching for EVERY charge, before any grouping. A reference id that normalization leaves behind (a
  // "*REF" with fewer than two digits, a "SPOTIFY P<ref>" tail) makes the grouping key unique per charge; if
  // matching waited for a shared key, those charges would never reach their merchant. The expensive part
  // (patterns against the descriptor) is cached per normalized descriptor, and per raw descriptor for the
  // raw-uppercase fallback; the amount only breaks ties between sibling plans (Plus vs Pro).
  const merchantGroups = new Map<string, { m: Merchant; items: Item[] }>();
  const appleItems: Item[] = [];
  const googleGroups = new Map<string, Item[]>();
  const unmatched = new Map<string, Item[]>();
  const normMatches = new Map<string, Merchant[]>();
  const groupOf = (p: Pre): Merchant[] => {
    if (p.group) return p.group;
    let g = normMatches.get(p.norm);
    if (!g) {
      g = matchGroup(kb, p.norm, '');
      normMatches.set(p.norm, g);
    }
    if (!g.length && p.upper !== p.norm) g = matchGroup(kb, p.norm, p.upper);
    p.group = g;
    return g;
  };

  for (const it of items) {
    if (it.bundle === 'apple') {
      if (it.amount <= MAX_UNMATCHED_CHARGE) appleItems.push(it);
      continue;
    }
    const m = pickByAmount(groupOf(it.p), it.amount);
    if (m) {
      // A lone charge of a merchant is dropped later by the single-charge rule (it must equal an annual
      // priceHint), which is applied per merchant group in evaluate(), not per descriptor key.
      const grp = merchantGroups.get(m.id);
      if (grp) grp.items.push(it);
      else merchantGroups.set(m.id, { m, items: [it] });
      continue;
    }
    // unmatched: a descriptor key seen once cannot form a series
    if ((keyCount.get(it.key) ?? 0) < 2) continue;
    if (it.bundle === 'google') {
      if (it.amount <= MAX_UNMATCHED_CHARGE) {
        const gg = googleGroups.get(it.key);
        if (gg) gg.push(it);
        else googleGroups.set(it.key, [it]);
      }
      continue;
    }
    if (it.amount > MAX_UNMATCHED_CHARGE) continue;
    if (NOISE_RE.test(it.norm) || EXCLUDE_RE.test(it.norm) || EXCLUDE_PURPOSE_RE.test(it.p.purpose)) continue;
    const u = unmatched.get(it.key);
    if (u) u.push(it);
    else unmatched.set(it.key, [it]);
  }

  const series: RecurringSeries[] = [];
  const usedKeys = new Set<string>();
  const uniqueKey = (base: string, amount: number): string => {
    let k = base;
    if (usedKeys.has(k)) k = `${base}@${amount.toFixed(2)}`;
    let i = 2;
    while (usedKeys.has(k)) k = `${base}@${amount.toFixed(2)}#${i++}`;
    usedKeys.add(k);
    return k;
  };
  const push = (b: Built, key: string, displayName: string, candidates?: string[]) => {
    const { items: its, levelAmount: _l, ...rest } = b;
    void _l;
    const s: RecurringSeries = { ...rest, key, displayName, descriptors: topDescriptors(its) };
    if (candidates) s.candidates = candidates;
    series.push(s);
    for (const i of its) i.used = true;
  };

  // 3a. KB-matched merchants
  for (const { m, items: its } of merchantGroups.values()) {
    const variable = m.category === 'telecom-utilities-finance';
    const ctx: Ctx = { merchant: m, bundle: null, hasCandidates: false, variable };
    const segs = variable ? [its] : chainMerge(clusterAmounts(its, false), KB_CHAIN_RATIO);
    for (const seg of segs) {
      const b = evaluate(seg, ctx, endDay);
      if (b) push(b, uniqueKey(m.id, b.levelAmount), m.name);
    }
  }

  // 3b/3c. APPLE.COM/BILL and unrecognised GOOGLE * charges: one series per amount cluster; the KB supplies
  // the candidate apps the user can pick from.
  const bundleSeries = (via: 'apple' | 'google', its: Item[], keyBase: string) => {
    for (const seg of clusterAmounts(its, true)) {
      const amt = round2(median(seg.map((i) => i.amount)));
      const hasCandidates = bundleCandidates(kb, via, amt, 'monthly').length > 0;
      const b = evaluate(seg, { merchant: null, bundle: via, hasCandidates, variable: false }, endDay);
      if (!b) continue;
      const cands = bundleCandidates(kb, via, b.currentAmount, b.cadence);
      const label = via === 'apple' ? 'App Store' : 'Google Play';
      push(
        b,
        uniqueKey(`${keyBase}@${b.levelAmount.toFixed(2)}`, b.levelAmount),
        `${label} subscription ($${b.currentAmount.toFixed(2)}${CADENCE_SUFFIX[b.cadence]})`,
        cands,
      );
    }
  };
  if (appleItems.length) bundleSeries('apple', appleItems, 'apple-bill');
  for (const [key, its] of googleGroups) bundleSeries('google', its, `google-play-${slug(key)}`);

  // 3d. unmatched merchants (need >= 3 charges)
  const evalUnmatched = (key: string, its: Item[]) => {
    for (const seg of chainMerge(clusterAmounts(its, false))) {
      const b = evaluate(seg, { merchant: null, bundle: null, hasCandidates: false, variable: false, groupSize: its.length }, endDay);
      if (!b) continue;
      const last = b.items[b.items.length - 1];
      push(b, uniqueKey(`${slug(key)}@${b.levelAmount.toFixed(2)}`, b.levelAmount), titleCase(merchantKey(last.norm, 3)));
    }
  };
  for (const [key, its] of unmatched) evalUnmatched(key, its);

  // 3e. leftovers: the same merchant with a varying tail (city, store number): regroup by the first 2 tokens
  const left = new Map<string, Item[]>();
  for (const its of unmatched.values()) {
    for (const it of its) {
      if (it.used) continue;
      const k2 = merchantKey(it.norm, 2);
      if (!k2.includes(' ') && k2.length < 6) continue;
      const g = left.get(k2);
      if (g) g.push(it);
      else left.set(k2, [it]);
    }
  }
  for (const [k2, its] of left) if (its.length >= 3) evalUnmatched(k2, its);

  series.sort((a, b) => b.annualCost - a.annualCost || (a.key < b.key ? -1 : 1));
  return series;
}
