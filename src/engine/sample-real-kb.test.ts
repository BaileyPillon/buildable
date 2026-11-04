// The demo statement (public/sample-statement.csv) run through the REAL pipeline: parseFiles -> findRecurring ->
// assess with the real knowledge base (src/kb), not the test KB. Every series in fixtures/statements/sample.expected.json
// must be found AND matched to the right real-KB merchant id (kbMerchantId).
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Assessment, RecurringSeries, Txn, Verdict } from '../types';
import { MERCHANTS } from '../kb';
import { CLAUDE_PRO_MONTHLY, assess, buildQueue } from './assess';
import { DEFAULT_CONTEXT, statementRange } from './index';
import { parseFiles } from './parse';
import { findRecurring } from './recurring';
import { ROOT, readExpected, type ExpectedEntry } from './testkit';

const text = fs.readFileSync(path.join(ROOT, 'public', 'sample-statement.csv'), 'utf8');
const expected = readExpected('sample');
const all: ExpectedEntry[] = [...expected.active, ...expected.inactive];

let txns: Txn[];
let series: RecurringSeries[];
const range = () => statementRange(txns);

beforeAll(async () => {
  ({ txns } = await parseFiles([{ name: 'sample-statement.csv', text }]));
  series = findRecurring(txns, MERCHANTS);
});

/** The detected series that corresponds to an expected entry (same real-KB id / bundle, same amount). */
function find(e: ExpectedEntry): RecurringSeries | undefined {
  const tol = e.variable ? e.currentAmount * 0.15 : 0.011;
  return series.find((s) => {
    const same = e.kbMerchantId ? s.merchantId === e.kbMerchantId : s.merchantId === null && s.key.startsWith('apple-bill');
    return same && Math.abs(s.currentAmount - e.currentAmount) <= tol;
  });
}

describe('sample statement with the real KB', () => {
  it('parses cleanly', () => {
    expect(txns.length).toBe(expected.rows);
    expect(range()).toEqual({ start: expected.statementStart, end: expected.statementEnd });
  });

  it('declares a real-KB id for every expected series, and every id exists in the KB', () => {
    const ids = new Set(MERCHANTS.map((m) => m.id));
    for (const e of all) {
      expect(e.kbMerchantId !== undefined, `${e.key} kbMerchantId`).toBe(true);
      if (e.kbMerchantId) expect(ids.has(e.kbMerchantId), `${e.key} -> ${e.kbMerchantId}`).toBe(true);
    }
  });

  it('finds every expected series, matched to the right merchant, with the right shape', () => {
    const missing: string[] = [];
    for (const e of all) {
      const s = find(e);
      if (!s) {
        missing.push(`${e.key} (${e.kbMerchantId ?? 'app store'} @ ${e.currentAmount})`);
        continue;
      }
      const label = `${e.kbMerchantId ?? 'app store'} @ ${e.currentAmount}`;
      expect(s.cadence, label).toBe(e.cadence);
      expect(s.active, label).toBe(e.active);
      expect(s.charges.length, label).toBe(e.charges);
      expect(s.priceChanges.map((p) => `${p.from}->${p.to}`), label).toEqual((e.priceChanges ?? []).map((p) => `${p.from}->${p.to}`));
      if (e.kbCandidatesInclude) {
        expect(s.candidates, label).toBeDefined();
        expect(s.candidates!.length, label).toBeLessThanOrEqual(6);
        for (const c of e.kbCandidatesInclude) expect(s.candidates, label).toContain(c);
      }
    }
    expect(missing).toEqual([]);
  });

  it('finds nothing else (no false subscriptions in the everyday noise)', () => {
    const wanted = new Set(all.map(find));
    const extra = series.filter((s) => !wanted.has(s)).map((s) => `${s.key} ${s.cadence} ${s.currentAmount} ${s.descriptors[0]}`);
    expect(extra).toEqual([]);
    expect(series).toHaveLength(all.length);
  });

  it('tells the demo story: Netflix hike, Paramount+ already gone, annual renewals, bundled App Store charges', () => {
    const get = (id: string) => series.find((s) => s.merchantId === id)!;
    expect(get('netflix').priceChanges).toEqual([{ date: '2026-04-05', from: 17.99, to: 19.99 }]);
    expect(get('paramount-plus').active).toBe(false);
    for (const id of ['grammarly-pro', 'nordvpn', 'ynab', 'amazon-prime']) expect(get(id).cadence, id).toBe('annual');
    const apple = series.filter((s) => s.merchantId === null);
    expect(apple.map((s) => s.currentAmount).sort((a, b) => a - b)).toEqual([0.99, 9.99]);
  });

  it('assesses end to end for a Claude Pro subscriber', () => {
    const r = range();
    const { items, summary } = assess(series, MERCHANTS, { ...DEFAULT_CONTEXT, claudePlan: 'pro' }, { statementStart: r.start, statementEnd: r.end });
    expect(items).toHaveLength(series.length);
    expect(summary.statementStart).toBe(expected.statementStart);
    expect(summary.statementEnd).toBe(expected.statementEnd);
    expect(summary.totalYear).toBeGreaterThan(3000);
    expect(summary.claudeCostYear).toBe(0);
    expect(summary.savingsYear).toBeGreaterThan(500);
    expect(summary.buildHours).toBeGreaterThan(10);
    expect(summary.netSavingsYear).toBe(summary.savingsYear);

    // a real-KB merchant for every series except the two App Store bundles, and a believable verdict mix
    const unmatched = items.filter((i) => !i.merchant);
    expect(unmatched.map((i) => i.series.merchantId)).toEqual([null, null]);
    const mix: Partial<Record<Verdict, number>> = {};
    for (const i of items) if (i.series.active) mix[i.verdict] = (mix[i.verdict] ?? 0) + 1;
    expect((mix.absorb ?? 0) + (mix.rebuild ?? 0) + (mix.selfhost ?? 0)).toBeGreaterThanOrEqual(5);
    expect(Object.keys(mix).length).toBeGreaterThanOrEqual(4);
    for (const i of items) {
      expect(Number.isFinite(i.savingsYear) && i.savingsYear >= 0, i.series.key).toBe(true);
      expect(i.reason.length, i.series.key).toBeGreaterThan(0);
    }
    const queue = buildQueue(items);
    expect(queue.length).toBeGreaterThan(3);
  });

  it('adds the Claude Pro cost once when the user has no Claude plan yet', () => {
    const r = range();
    const { summary } = assess(series, MERCHANTS, { ...DEFAULT_CONTEXT, claudePlan: 'none' }, { statementStart: r.start, statementEnd: r.end });
    expect(summary.byVerdict.absorb.count).toBeGreaterThan(0);
    expect(summary.claudeCostYear).toBe(CLAUDE_PRO_MONTHLY * 12);
  });

  it('CLAUDE_PRO_MONTHLY is the KB price of Claude Pro', () => {
    const claudePro = MERCHANTS.find((m) => m.id === 'claude-pro')!;
    expect(claudePro.typicalMonthly).toBe(CLAUDE_PRO_MONTHLY);
    expect(claudePro.sources).toContain('https://claude.com/pricing');
  });

  it('lets the user pick an App Store candidate, and the pick is assessed as that merchant', () => {
    const bundle = series.find((s) => s.merchantId === null && s.currentAmount === 0.99)!;
    const pick = bundle.candidates![0];
    const r = range();
    const { items } = assess(series, MERCHANTS, { ...DEFAULT_CONTEXT, merchantOverrides: { [bundle.key]: pick } }, { statementStart: r.start, statementEnd: r.end });
    const it = items.find((i) => i.series.key === bundle.key) as Assessment;
    expect(it.merchant?.id).toBe(pick);
  });
});
