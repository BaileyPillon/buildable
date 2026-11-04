// The UI view-model and exporters against the REAL knowledge base: every merchant (null typicalMonthly, missing
// optional plans, no alternatives, store-billed bundles) in every verdict it offers must flow through
// assess -> derive -> receipt model -> plan export -> build kit without throwing or printing undefined / NaN.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Assessment, Context, RecurringSeries, Verdict } from '../types';
import { MERCHANTS } from '../kb';
import { DEFAULT_CONTEXT, assess, findRecurring, parseFiles, statementRange } from './data';
import { derive } from './derive';
import { askClaudePrompt, buildKit, buildKitFilename, planMarkdown, planPrompt, verdictOptions } from './exporters';
import { buildReceiptModel } from './receiptModel';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BAD = /undefined|NaN|\[object|null\b/;

function fakeSeries(id: string, name: string, amount: number): RecurringSeries {
  return {
    key: id,
    displayName: name,
    descriptors: [name.toUpperCase()],
    cadence: 'monthly',
    charges: [{ date: '2026-09-01', amount }, { date: '2026-10-01', amount }],
    currentAmount: amount,
    annualCost: Math.round(amount * 12 * 100) / 100,
    firstSeen: '2026-09-01',
    lastSeen: '2026-10-01',
    active: true,
    priceChanges: [],
    confidence: 0.9,
    merchantId: id,
  };
}

const everything: Context = {
  ...DEFAULT_CONTEXT,
  devices: ['old-laptop', 'spare-pc', 'raspberry-pi', 'nas', 'old-android', 'old-iphone', 'old-ipad', 'kindle'],
};

describe('real KB through the UI data layer', () => {
  it('every merchant, in every verdict it offers, produces finite numbers and clean export text', () => {
    const problems: string[] = [];
    for (const m of MERCHANTS) {
      const amount = m.typicalMonthly ?? 9.99; // typicalMonthly may be null in the real KB
      const series = [fakeSeries(m.id, m.name, amount)];
      const base = assess(series, MERCHANTS, everything, { statementStart: '2025-09-01', statementEnd: '2026-10-31' }).items[0];
      const options: Verdict[] = verdictOptions(base);
      if (!options.length) problems.push(`${m.id}: no verdict options`);
      for (const v of new Set<Verdict>([...options, 'cancel', 'keep'])) {
        const ctx: Context = { ...everything, verdictOverrides: { [m.id]: v } };
        const { items, summary } = assess(series, MERCHANTS, ctx, { statementStart: '2025-09-01', statementEnd: '2026-10-31' });
        const it: Assessment = items[0];
        const where = `${m.id}/${v}`;
        for (const n of [it.savingsYear, it.hours, summary.totalYear, summary.savingsYear, summary.buildHours]) {
          if (!Number.isFinite(n)) problems.push(`${where}: non-finite number`);
        }
        if (it.savingsYear < 0) problems.push(`${where}: negative savings`);
        const d = derive(items, summary);
        const model = buildReceiptModel(d, summary.statementStart, summary.statementEnd);
        if (model.lines.length !== 1) problems.push(`${where}: receipt lines`);
        const md = planMarkdown({ derived: d, ctx, start: summary.statementStart, end: summary.statementEnd, fileCount: 1 });
        const kit = buildKit(it, ctx);
        const prompt = planPrompt(it);
        for (const [label, text] of [['plan', md], ['kit', kit ?? ''], ['prompt', prompt ?? ''], ['reason', it.reason]] as const) {
          const hit = BAD.exec(text);
          if (hit) problems.push(`${where} ${label}: "${text.slice(Math.max(0, hit.index - 30), hit.index + 30).replace(/\n/g, ' ')}"`);
        }
        if (kit) expect(buildKitFilename(it)).toMatch(/^build-kit-[a-z0-9-]+\.md$/);
      }
    }
    expect(problems).toEqual([]);
  });

  it('the sample statement end to end: view-model sections add up and nothing renders as undefined', async () => {
    const text = fs.readFileSync(path.join(ROOT, 'public', 'sample-statement.csv'), 'utf8');
    const { txns } = await parseFiles([{ name: 'sample-statement.csv', text }]);
    const series = findRecurring(txns, MERCHANTS);
    const range = statementRange(txns);
    const { items, summary } = assess(series, MERCHANTS, DEFAULT_CONTEXT, { statementStart: range.start, statementEnd: range.end });
    const d = derive(items, summary);

    expect(d.active.length + d.inactive.length).toBe(series.length);
    expect(d.needsPick.length).toBe(2); // the two APPLE.COM/BILL charges wait for the user to pick an app
    expect(d.unrecognized).toEqual([]);
    expect(d.inactive.map((i) => i.series.merchantId)).toEqual(['paramount-plus']);
    expect(d.totals.totalYear).toBeCloseTo(summary.totalYear, 2);
    expect(d.totals.keepYear).toBeGreaterThan(1000);

    const model = buildReceiptModel(d, summary.statementStart, summary.statementEnd);
    expect(model.lines).toHaveLength(d.active.length);
    expect(model.lines.reduce((n, l) => n + l.amount, 0)).toBeCloseTo(model.totalYear, 2);

    const md = planMarkdown({ derived: d, ctx: DEFAULT_CONTEXT, start: range.start, end: range.end, fileCount: 1 });
    expect(BAD.exec(md)?.[0]).toBeUndefined();
    expect(md).toContain('# My Buildable plan');
    for (const c of d.queue.filter((q) => !q.blocked)) expect(md).toContain(c.series.displayName);

    // the store-billed bundles name their candidates, which all exist in the KB
    for (const it of d.needsPick) {
      expect(it.series.candidates!.length).toBeGreaterThan(0);
      for (const id of it.series.candidates!) expect(MERCHANTS.some((m) => m.id === id), id).toBe(true);
    }
    expect(BAD.exec(askClaudePrompt(d.needsPick))?.[0]).toBeUndefined();
  });
});
