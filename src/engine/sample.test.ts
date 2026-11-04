// public/sample-statement.csv is the demo persona. These tests make sure the landing page's "Try a sample
// statement" button lands on a believable, fully parseable result.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assess } from './assess';
import { DEFAULT_CONTEXT, statementRange } from './index';
import { parseFiles } from './parse';
import { findRecurring } from './recurring';
import { ROOT, TEST_KB, readExpected, score } from './testkit';

const text = fs.readFileSync(path.join(ROOT, 'public', 'sample-statement.csv'), 'utf8');

describe('public/sample-statement.csv', () => {
  it('is a Chase-card style export, 14 months ending 2026-10-31, roughly 400-500 rows', async () => {
    expect(text.split('\n')[0]).toBe('Transaction Date,Post Date,Description,Category,Type,Amount,Memo');
    const { txns, warnings } = await parseFiles([{ name: 'sample-statement.csv', text }]);
    expect(warnings).toEqual([]);
    expect(txns.length).toBeGreaterThanOrEqual(380);
    expect(txns.length).toBeLessThanOrEqual(520);
    const range = statementRange(txns);
    expect(range.start >= '2025-09-01' && range.start <= '2025-09-10').toBe(true);
    expect(range.end).toBe('2026-10-31');
  });

  it('uses descriptors that look like real statement lines', () => {
    for (const d of ['NETFLIX.COM 866-579-7172 CA', 'OPENAI *CHATGPT SUBSCR', 'APPLE.COM/BILL 866-712-7753 CA', 'COMCAST CABLE COMM 800-COMCAST PA']) {
      expect(text).toContain(d);
    }
  });

  it('has purchases negative and payments positive, like a Chase card', () => {
    const rows = text.trim().split('\n').slice(1);
    const pay = rows.filter((r) => /Payment Thank You-Web/.test(r));
    expect(pay.length).toBeGreaterThanOrEqual(12);
    expect(pay.every((r) => /,Payment,\d+\.\d\d,$/.test(r))).toBe(true);
    expect(rows.filter((r) => /,Sale,-\d/.test(r)).length).toBeGreaterThan(300);
  });

  it('is detected as the expected ~30 recurring series (recall >= 0.95, precision >= 0.9)', async () => {
    const { txns } = await parseFiles([{ name: 'sample-statement.csv', text }]);
    const expected = readExpected('sample');
    const series = findRecurring(txns, TEST_KB);
    const sc = score(series, [...expected.active, ...expected.inactive]);
    const why = `missed: ${sc.missed.map((m) => m.key).join(', ') || 'none'}; extra: ${sc.extra.map((s) => s.key).join(', ') || 'none'}`;
    expect(sc.expected).toBeGreaterThanOrEqual(28);
    expect(sc.recall, why).toBeGreaterThanOrEqual(0.95);
    expect(sc.precision, why).toBeGreaterThanOrEqual(0.9);
    for (const { e, s } of sc.pairs) {
      expect(s.cadence, e.key).toBe(e.cadence);
      expect(s.active, e.key).toBe(e.active);
      expect(s.priceChanges.map((p) => `${p.from}->${p.to}`), e.key).toEqual((e.priceChanges ?? []).map((p) => `${p.from}->${p.to}`));
    }
  });

  it('shows the story the demo needs: a Netflix hike, two App Store charges, a cancelled Paramount+, annuals', async () => {
    const { txns } = await parseFiles([{ name: 'sample-statement.csv', text }]);
    const s = findRecurring(txns, TEST_KB);
    const get = (id: string) => s.find((x) => x.merchantId === id)!;
    expect(get('netflix').priceChanges).toEqual([{ date: '2026-04-05', from: 17.99, to: 19.99 }]);
    const apple = s.filter((x) => x.key.startsWith('apple-bill'));
    expect(apple.map((a) => a.currentAmount).sort((a, b) => a - b)).toEqual([0.99, 9.99]);
    expect(get('paramount-plus').active).toBe(false);
    expect(get('grammarly')).toMatchObject({ cadence: 'annual', annualCost: 144 });
    expect(get('nordvpn')).toMatchObject({ cadence: 'annual', annualCost: 71.88 });
    expect(get('ynab')).toMatchObject({ cadence: 'annual', annualCost: 109, charges: [{ date: '2025-09-03', amount: 109 }, { date: '2026-09-03', amount: 109 }] });
    expect(get('amazon-prime')).toMatchObject({ cadence: 'annual', annualCost: 139 });
    expect(get('claude-pro')).toMatchObject({ cadence: 'monthly', currentAmount: 20 });
    expect(get('xfinity').cadence).toBe('monthly');
    expect(get('verizon').cadence).toBe('monthly');
    // Amazon marketplace noise and everyday spend never show up
    expect(s.some((x) => /AMZN MKTP|TRADER JOE|UBER/i.test(x.descriptors.join(' ')))).toBe(false);
  });

  it('assesses end to end for a persona who already pays for Claude Pro', async () => {
    const { txns } = await parseFiles([{ name: 'sample-statement.csv', text }]);
    const series = findRecurring(txns, TEST_KB);
    const range = statementRange(txns);
    const { items, summary } = assess(series, TEST_KB, { ...DEFAULT_CONTEXT, claudePlan: 'pro' }, { statementStart: range.start, statementEnd: range.end });
    expect(items).toHaveLength(series.length);
    expect(summary.statementEnd).toBe('2026-10-31');
    expect(summary.totalYear).toBeGreaterThan(3000);
    expect(summary.claudeCostYear).toBe(0);
    expect(summary.savingsYear).toBeGreaterThan(500);
    expect(summary.buildHours).toBeGreaterThan(10);
    expect(summary.netSavingsYear).toBe(summary.savingsYear);
  });
});
