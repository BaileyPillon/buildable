// KB matching (SPEC.md "Normalization": patterns match the NORMALIZED descriptor, then the raw uppercase
// descriptor as a fallback) and candidate lookup for APPLE.COM/BILL and GOOGLE * bundles.
import type { Cadence, Merchant } from '../types';

const perMerchant = new WeakMap<Merchant, RegExp[]>();
const annualCache = new WeakMap<Merchant[], Merchant[]>();

function regexesOf(m: Merchant): RegExp[] {
  let res = perMerchant.get(m);
  if (!res) {
    res = [];
    for (const p of m.match?.patterns ?? []) {
      try {
        res.push(new RegExp(p, 'i'));
      } catch {
        // a broken KB pattern must never break the engine; validate-kb reports it
      }
    }
    perMerchant.set(m, res);
  }
  return res;
}

const combinedCache = new WeakMap<Merchant[], RegExp | null>();

/**
 * One regex that matches if ANY merchant in `list` could match. Most descriptors (groceries, restaurants) match
 * no merchant at all, so a single test rejects them instead of testing every pattern. Null when the list is
 * small, or when a pattern cannot be safely joined (back-references, named groups).
 */
function combinedOf(list: Merchant[]): RegExp | null {
  if (list.length < 12) return null;
  const hit = combinedCache.get(list);
  if (hit !== undefined) return hit;
  const parts: string[] = [];
  let ok = true;
  for (const m of list) {
    for (const p of m.match?.patterns ?? []) {
      try {
        new RegExp(p, 'i');
      } catch {
        continue;
      }
      if (/\\[1-9k]|\(\?<[A-Za-z]/.test(p)) ok = false;
      parts.push(`(?:${p})`);
    }
  }
  let re: RegExp | null = null;
  if (ok && parts.length) {
    try {
      re = new RegExp(parts.join('|'), 'i');
    } catch {
      re = null;
    }
  }
  combinedCache.set(list, re);
  return re;
}

/** Distance from `amount` to the nearest priceHint of `m`; Infinity when it has none. 0 when no amount is known. */
function hintDistance(m: Merchant, amount: number | undefined): number {
  if (amount === undefined || !Number.isFinite(amount)) return 0;
  const hints = m.match?.priceHints;
  if (!hints || !hints.length) return Infinity;
  let best = Infinity;
  for (const h of hints) {
    const d = Math.abs(amount - h.amount);
    if (d < best) best = d;
  }
  return best;
}

/**
 * The merchants of `list` whose pattern match covers the LONGEST span of `text`, in KB order (empty when nothing
 * matches). A merchant's span is its best pattern's match length, so "MICROSOFT 365 PERSONAL" beats a bare
 * "MICROSOFT". Usually one merchant; several only for sibling plans that share a descriptor.
 */
function longestSpan(list: Merchant[], text: string): Merchant[] {
  let group: Merchant[] = [];
  let bestSpan = -1;
  for (const m of list) {
    let span = -1;
    for (const re of regexesOf(m)) {
      const r = re.exec(text);
      if (r && r[0].length > span) span = r[0].length;
    }
    if (span < 0 || span < bestSpan) continue;
    if (span > bestSpan) {
      group = [m];
      bestSpan = span;
    } else group.push(m);
  }
  return group;
}

/** Tie-break: the merchant with the priceHint closest to `amount` (when known); equal distance keeps KB order. */
function pickByAmount(group: Merchant[], amount: number | undefined): Merchant | null {
  if (group.length <= 1 || amount === undefined) return group[0] ?? null;
  let best = group[0];
  let bestDist = hintDistance(best, amount);
  for (let i = 1; i < group.length; i++) {
    const d = hintDistance(group[i], amount);
    if (d < bestDist) {
      best = group[i];
      bestDist = d;
    }
  }
  return best;
}

/**
 * Everything amount-independent about matching a descriptor: the longest-span group for the normalized descriptor,
 * else for the raw uppercase one. Callers that see many charges of one descriptor compute this once and then
 * call `pickByAmount` per charge.
 */
export function matchGroup(list: Merchant[], normalized: string, rawUpper: string): Merchant[] {
  const any = combinedOf(list);
  const tryRaw = !!rawUpper && rawUpper !== normalized;
  if (any && !any.test(normalized) && !(tryRaw && any.test(rawUpper))) return [];
  const hit = longestSpan(list, normalized);
  if (hit.length) return hit;
  return tryRaw ? longestSpan(list, rawUpper) : [];
}

export { pickByAmount };

/**
 * Best merchant of `list` for the normalized descriptor, else for the raw uppercase one: the longest regex span
 * wins; ties go to the priceHint closest to `amount` (when known), then to KB order.
 */
export function matchAmong(list: Merchant[], normalized: string, rawUpper: string, amount?: number): Merchant | null {
  return pickByAmount(matchGroup(list, normalized, rawUpper), amount);
}

/** Best KB merchant for a descriptor (see `matchAmong`). */
export function matchMerchant(kb: Merchant[], normalized: string, rawUpper: string, amount?: number): Merchant | null {
  return matchAmong(kb, normalized, rawUpper, amount);
}

/** Merchants that have an `annual` price hint, for the single-charge rule. */
export function annualMerchants(kb: Merchant[]): Merchant[] {
  let a = annualCache.get(kb);
  if (!a) {
    a = kb.filter((m) => m.match?.priceHints?.some((h) => h.cadence === 'annual'));
    annualCache.set(kb, a);
  }
  return a;
}

/** True if `amount` equals an annual priceHint of the merchant within +-3%. */
export function matchesAnnualHint(m: Merchant, amount: number): boolean {
  return !!m.match?.priceHints?.some((h) => h.cadence === 'annual' && Math.abs(amount - h.amount) <= h.amount * 0.03 + 0.005);
}

/** The store's own services are the likeliest source of a charge billed under the store's name. */
const FIRST_PARTY: Record<'apple' | 'google', RegExp> = {
  apple: /^(?:apple-|icloud)/,
  google: /^(?:google-|youtube)/,
};

/**
 * Merchants a bundled charge (APPLE.COM/BILL, GOOGLE *) could be: same `billedVia` and a priceHint within
 * $0.02 of the amount (max 6). Cadence-matching hints rank first, then the store's own services (iCloud+,
 * Apple Music, YouTube Premium), then closer prices, then KB order.
 * If nothing is within $0.02, hints up to 10% below the amount are accepted (sales tax on top of the list price).
 */
export function bundleCandidates(kb: Merchant[], via: 'apple' | 'google', amount: number, cadence: Cadence): string[] {
  const cents = Math.round(amount * 100);
  const scan = (maxExtraPct: number) => {
    const found: { id: string; diff: number; cad: boolean; own: boolean; index: number }[] = [];
    kb.forEach((m, index) => {
      if (m.match?.billedVia !== via || !m.match.priceHints) return;
      let best = Infinity;
      let cad = false;
      for (const h of m.match.priceHints) {
        const hc = Math.round(h.amount * 100);
        const diff = maxExtraPct === 0 ? Math.abs(cents - hc) : cents - hc;
        const ok = maxExtraPct === 0 ? diff <= 2 : diff >= 0 && diff <= hc * maxExtraPct;
        if (!ok) continue;
        if (diff < best) best = diff;
        if (h.cadence === cadence) cad = true;
      }
      if (best !== Infinity) found.push({ id: m.id, diff: best, cad, own: FIRST_PARTY[via].test(m.id), index });
    });
    return found;
  };
  let found = scan(0);
  if (!found.length) found = scan(0.1);
  found.sort((a, b) => Number(b.cad) - Number(a.cad) || Number(b.own) - Number(a.own) || a.diff - b.diff || a.index - b.index);
  return found.slice(0, 6).map((f) => f.id);
}
