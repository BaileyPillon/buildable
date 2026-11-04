// Per-fixture accuracy: every synthetic bank export is parsed, run through findRecurring with the TEST KB
// (fixtures/test-kb.json, not src/kb) and scored against its .expected.json ground truth.
import { describe, expect, it } from 'vitest';
import { parseFiles } from './parse';
import { findRecurring } from './recurring';
import { TEST_KB, readExpected, readStatement, score } from './testkit';

const FIXTURES = [
  'chase-credit.csv', 'chase-checking.csv', 'amex.csv', 'bofa-checking.csv', 'capitalone.csv', 'wellsfargo.csv',
  'citi.csv', 'discover.csv', 'apple-card.csv', 'usbank.csv', 'monzo.csv', 'revolut-eu.csv', 'generic.qfx',
];

const summary: string[] = [];

describe.each(FIXTURES)('fixture %s', (file) => {
  const name = file.replace(/\.[a-z]+$/, '');
  const expected = readExpected(name);
  const all = [...expected.active, ...expected.inactive];

  it('parses with the right row count and no unexpected warnings', async () => {
    const { txns, warnings } = await parseFiles([{ name: file, text: readStatement(file) }]);
    // a REVERTED Revolut row is deliberately skipped, so allow it to be one short
    expect(txns.length).toBeGreaterThanOrEqual(expected.rows - 1);
    expect(txns.length).toBeLessThanOrEqual(expected.rows);
    const bad = warnings.filter((w) => !/amounts look like|dropped/i.test(w));
    expect(bad).toEqual([]);
    expect(txns.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date) && Number.isFinite(t.amount))).toBe(true);
    const dates = txns.map((t) => t.date).sort();
    expect(dates[0]).toBe(expected.statementStart);
    expect(dates[dates.length - 1]).toBe(expected.statementEnd);
  });

  it('finds the subscriptions: recall >= 0.95, precision >= 0.9, right cadence, amount and flags', async () => {
    const { txns } = await parseFiles([{ name: file, text: readStatement(file) }]);
    const series = findRecurring(txns, TEST_KB);
    const sc = score(series, all);
    summary.push(`${file.padEnd(18)} expected ${String(sc.expected).padStart(2)}  detected ${String(sc.detected).padStart(2)}  recall ${sc.recall.toFixed(2)}  precision ${sc.precision.toFixed(2)}`);
    const why = `missed: ${sc.missed.map((m) => `${m.key}@${m.currentAmount}`).join(', ') || 'none'}; extra: ${sc.extra.map((s) => `${s.key}(${s.cadence} ${s.currentAmount})`).join(', ') || 'none'}`;
    expect(sc.recall, why).toBeGreaterThanOrEqual(0.95);
    expect(sc.precision, why).toBeGreaterThanOrEqual(0.9);
    for (const { e, s } of sc.pairs) {
      expect(s.cadence, `${e.key} cadence`).toBe(e.cadence);
      expect(s.active, `${e.key} active`).toBe(e.active);
      expect(s.confidence).toBeGreaterThanOrEqual(0.5);
      expect(s.annualCost).toBeGreaterThan(0);
      expect(s.charges.length, `${e.key} charge count`).toBe(e.charges);
      expect(s.firstSeen <= s.lastSeen).toBe(true);
      expect(s.descriptors.length).toBeGreaterThan(0);
      expect(s.descriptors.length).toBeLessThanOrEqual(5);
    }
  });

  it('detects price changes exactly where they happened', async () => {
    const { txns } = await parseFiles([{ name: file, text: readStatement(file) }]);
    const sc = score(findRecurring(txns, TEST_KB), all);
    for (const { e, s } of sc.pairs) {
      const want = (e.priceChanges ?? []).map((p) => `${p.from}->${p.to}`);
      const got = s.priceChanges.map((p) => `${p.from}->${p.to}`);
      expect(got, `${e.key} price changes`).toEqual(want);
    }
  });

  it('marks cancelled subscriptions inactive and keeps them out of the active set', async () => {
    const { txns } = await parseFiles([{ name: file, text: readStatement(file) }]);
    const sc = score(findRecurring(txns, TEST_KB), all);
    for (const e of expected.inactive) {
      const hit = sc.pairs.find((p) => p.e === e);
      expect(hit, `${e.key} should be detected`).toBeTruthy();
      expect(hit!.s.active).toBe(false);
    }
    for (const e of expected.active) {
      const hit = sc.pairs.find((p) => p.e === e);
      if (hit) expect(hit.s.active).toBe(true);
    }
  });

  it('gives App Store / Google Play bundles their own series with candidates', async () => {
    const { txns } = await parseFiles([{ name: file, text: readStatement(file) }]);
    const sc = score(findRecurring(txns, TEST_KB), all);
    for (const { e, s } of sc.pairs.filter((p) => p.e.candidates)) {
      expect(s.merchantId).toBeNull();
      expect(s.displayName).toBe(e.displayName);
      expect(s.candidates).toEqual(e.candidates);
    }
  });
});

describe('fixture accuracy summary', () => {
  it('prints the table', () => {
    process.stderr.write(`\n${summary.join('\n')}\n`);
    expect(summary.length).toBeGreaterThan(0);
  });
});
