import { describe, expect, it } from 'vitest';
import type { Assessment, Cadence, Context, Device, Merchant, RecurringSeries, Verdict } from '../types';
import { CLAUDE_PRO_MONTHLY, assess, blockedMessage, buildQueue, netOfTime } from './assess';
import { DEFAULT_CONTEXT, statementRange } from './index';
import { TEST_KB } from './testkit';

const PERIODS: Record<Cadence, number> = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, semiannual: 2, annual: 1 };

function series(over: Partial<RecurringSeries> & { key: string }): RecurringSeries {
  const cadence = over.cadence ?? 'monthly';
  const currentAmount = over.currentAmount ?? 10;
  return {
    displayName: over.key,
    descriptors: [over.key.toUpperCase()],
    cadence,
    charges: [{ date: '2026-10-01', amount: currentAmount }],
    currentAmount,
    annualCost: Math.round(currentAmount * PERIODS[cadence] * 100) / 100,
    firstSeen: '2026-01-01',
    lastSeen: '2026-10-01',
    active: true,
    priceChanges: [],
    confidence: 0.9,
    merchantId: null,
    ...over,
  };
}
const forMerchant = (id: string, amount: number, over: Partial<RecurringSeries> = {}) =>
  series({ key: id, merchantId: id, displayName: id, currentAmount: amount, ...over });

const ctx = (over: Partial<Context> = {}): Context => ({ ...DEFAULT_CONTEXT, ...over });
const one = (s: RecurringSeries, c: Context = ctx()): Assessment => assess([s], TEST_KB, c).items[0];

describe('verdict selection', () => {
  it("starts from the merchant's primary verdict", () => {
    expect(one(forMerchant('netflix', 17.99)).verdict).toBe('rotate');
    expect(one(forMerchant('chatgpt-plus', 20)).verdict).toBe('absorb');
    expect(one(forMerchant('otter-ai', 16.99)).verdict).toBe('rebuild');
    expect(one(forMerchant('xfinity', 85)).verdict).toBe('haggle');
    expect(one(forMerchant('spotify', 11.99)).verdict).toBe('keep');
  });

  it('unmatched series are `keep` with the catalog reason and no savings', () => {
    const a = one(series({ key: 'iron-forge-fitness@39.00', currentAmount: 39 }));
    expect(a).toMatchObject({ verdict: 'keep', merchant: null, savingsYear: 0, hours: 0, roiPerHour: null, reason: 'Not in our catalog yet' });
  });

  it('an unmatched App Store bundle explains that the app must be picked', () => {
    const a = one(series({ key: 'apple-bill@9.99', currentAmount: 9.99, candidates: ['icloud-plus', 'apple-tv-plus'] }));
    expect(a.verdict).toBe('keep');
    expect(a.reason).toMatch(/^Not in our catalog yet/);
    expect(a.reason).toMatch(/Pick which app/);
  });

  it('"barely use this" turns any verdict into cancel', () => {
    const s = forMerchant('otter-ai', 16.99);
    const a = one(s, ctx({ unused: [s.key] }));
    expect(a.verdict).toBe('cancel');
    expect(a.savingsYear).toBe(s.annualCost);
    expect(a.hours).toBe(0.25);
    expect(a.roiPerHour).toBe(Math.round((s.annualCost / 0.25) * 100) / 100);
    expect(a.reason).toMatch(/barely use/);
  });

  it('works for unmatched series too (cancel needs no catalog entry)', () => {
    const s = series({ key: 'iron-forge-fitness@39.00', currentAmount: 39 });
    const a = one(s, ctx({ unused: [s.key] }));
    expect(a).toMatchObject({ verdict: 'cancel', savingsYear: 468, hours: 0.25, merchant: null });
  });

  it('a user-chosen verdict override wins over the default and over "unused"', () => {
    const s = forMerchant('netflix', 17.99);
    expect(one(s, ctx({ verdictOverrides: { [s.key]: 'keep' } })).verdict).toBe('keep');
    expect(one(s, ctx({ verdictOverrides: { [s.key]: 'cancel' } })).verdict).toBe('cancel');
    expect(one(s, ctx({ unused: [s.key], verdictOverrides: { [s.key]: 'rotate' } })).verdict).toBe('rotate');
  });

  it('ignores an override the merchant has no plan for', () => {
    const s = forMerchant('netflix', 17.99); // no rebuild plan in the KB
    expect(one(s, ctx({ verdictOverrides: { [s.key]: 'rebuild' } })).verdict).toBe('rotate');
    const un = series({ key: 'x@5.00' });
    expect(one(un, ctx({ verdictOverrides: { [un.key]: 'absorb' } })).verdict).toBe('keep');
  });

  it('a picked merchant (merchantOverrides) turns an App Store bundle into a real assessment', () => {
    const s = series({ key: 'apple-bill@9.99', currentAmount: 9.99, candidates: ['icloud-plus', 'apple-tv-plus'] });
    const a = one(s, ctx({ merchantOverrides: { [s.key]: 'apple-tv-plus' } }));
    expect(a.merchant?.id).toBe('apple-tv-plus');
    expect(a.verdict).toBe('rotate');
    expect(a.savingsYear).toBe(Math.round(((s.annualCost * 8) / 12) * 100) / 100);
    expect(one(s, ctx({ merchantOverrides: { [s.key]: 'no-such-merchant' } })).merchant).toBeNull();
  });
});

describe('savings math (first year)', () => {
  const annual = (id: string, amount: number) => forMerchant(id, amount).annualCost;

  it('cancel = annual cost', () => {
    const s = forMerchant('netflix', 17.99);
    const a = one(s, ctx({ verdictOverrides: { [s.key]: 'cancel' } }));
    expect(a).toMatchObject({ verdict: 'cancel', savingsYear: annual('netflix', 17.99), hours: 0.25 });
  });

  it('absorb = annual cost, 0.5 hours', () => {
    const a = one(forMerchant('chatgpt-plus', 20));
    expect(a).toMatchObject({ verdict: 'absorb', savingsYear: 240, hours: 0.5, roiPerHour: 480 });
  });

  it('rebuild = annual cost minus ongoing cost, plan hours', () => {
    const a = one(forMerchant('otter-ai', 16.99));
    expect(a).toMatchObject({ verdict: 'rebuild', savingsYear: 203.88, hours: 8 });
    expect(a.roiPerHour).toBe(25.49);
    const custom: Merchant = { ...TEST_KB.find((m) => m.id === 'otter-ai')!, id: 'otter-paid', plans: { cancel: { howTo: 'x' }, rebuild: { whatYouBuild: 'x', hours: 10, runsOn: 'x', ongoingCostYear: 60, youLose: 'x', prompt: 'x' } } };
    const s = forMerchant('otter-paid', 16.99);
    const b = assess([s], [custom], ctx()).items[0];
    expect(b.savingsYear).toBe(143.88);
  });

  it('selfhost = annual cost minus power cost, plan hours (with a device)', () => {
    const a = one(forMerchant('dropbox', 11.99), ctx({ devices: ['old-laptop'] }));
    expect(a).toMatchObject({ verdict: 'selfhost', savingsYear: 121.88, hours: 4 });
    expect(a.blocked).toBeUndefined();
    expect(a.roiPerHour).toBe(30.47);
  });

  it('haggle = annual cost x midpoint of the expected discount, 0.5 hours', () => {
    const a = one(forMerchant('xfinity', 85)); // [10, 25] -> 17.5 %
    expect(a).toMatchObject({ verdict: 'haggle', hours: 0.5 });
    expect(a.savingsYear).toBe(178.5);
    const nyt = one(forMerchant('nytimes', 25)); // [20, 50] -> 35 %
    expect(nyt.savingsYear).toBe(105);
  });

  it('rotate = annual cost x months off / 12, 0.25 hours', () => {
    const a = one(forMerchant('netflix', 17.99)); // 4 months off
    expect(a).toMatchObject({ verdict: 'rotate', hours: 0.25 });
    expect(a.savingsYear).toBe(71.96);
  });

  it('keep = 0 savings, 0 hours, no ROI', () => {
    const a = one(forMerchant('spotify', 11.99));
    expect(a).toMatchObject({ verdict: 'keep', savingsYear: 0, hours: 0, roiPerHour: null });
  });

  it('savings never go negative', () => {
    const base = TEST_KB.find((m) => m.id === 'otter-ai')!;
    const kb: Merchant[] = [
      { ...base, id: 'dear-rebuild', plans: { cancel: { howTo: 'x' }, rebuild: { ...base.plans.rebuild!, ongoingCostYear: 1000 } } },
    ];
    const a = assess([forMerchant('dear-rebuild', 5)], kb, ctx()).items[0];
    expect(a.verdict).toBe('rebuild');
    expect(a.savingsYear).toBe(0);
  });

  it('annual cost follows cadence (quarterly series)', () => {
    const s = forMerchant('xfinity', 85, { cadence: 'quarterly' });
    expect(s.annualCost).toBe(340);
    expect(one(s).savingsYear).toBe(59.5);
  });

  it('falls back to keep rather than invent savings when the KB lacks the plan its verdict needs', () => {
    const base = TEST_KB.find((m) => m.id === 'otter-ai')!;
    const kb: Merchant[] = [{ ...base, id: 'broken', plans: { cancel: { howTo: 'x' } } }];
    const a = assess([forMerchant('broken', 5)], kb, ctx()).items[0];
    expect(a).toMatchObject({ verdict: 'keep', savingsYear: 0 });
  });
});

describe('selfhost needs a device', () => {
  it('blocked without devices: verdict stays selfhost, message names the hardware, savings leave the totals', () => {
    const s = forMerchant('dropbox', 11.99);
    const { items, summary } = assess([s], TEST_KB, ctx({ devices: [] }));
    expect(items[0].verdict).toBe('selfhost');
    expect(items[0].blocked).toBe('Needs an old laptop, spare PC, Raspberry Pi or NAS');
    expect(summary.savingsYear).toBe(0);
    expect(summary.byVerdict.selfhost).toMatchObject({ count: 1, costYear: s.annualCost, savingsYear: 0 });
    expect(summary.buildHours).toBe(0);
  });
  it('the exact SPEC wording for old laptop / Raspberry Pi / NAS', () => {
    expect(blockedMessage(['old-laptop', 'raspberry-pi', 'nas'])).toBe('Needs an old laptop, Raspberry Pi or NAS');
    expect(blockedMessage(['raspberry-pi'])).toBe('Needs a Raspberry Pi');
    expect(blockedMessage(['old-ipad', 'kindle'])).toBe('Needs an old iPad or Kindle');
  });
  it('a device that cannot run it does not unblock it; one that can does', () => {
    const s = forMerchant('dropbox', 11.99);
    expect(one(s, ctx({ devices: ['kindle', 'old-iphone'] })).blocked).toBeTruthy();
    for (const d of ['old-laptop', 'spare-pc', 'raspberry-pi', 'nas'] as Device[]) {
      const { items, summary } = assess([s], TEST_KB, ctx({ devices: [d] }));
      expect(items[0].blocked).toBeUndefined();
      expect(summary.savingsYear).toBe(121.88);
      expect(summary.buildHours).toBe(4);
    }
  });
  it('picking a different verdict chip clears the block', () => {
    const s = forMerchant('dropbox', 11.99);
    expect(one(s, ctx({ verdictOverrides: { [s.key]: 'cancel' } })).blocked).toBeUndefined();
  });
});

describe('summary', () => {
  const fleet = () => [
    forMerchant('netflix', 17.99), // rotate: 215.88 -> 71.96
    forMerchant('chatgpt-plus', 20), // absorb: 240 -> 240, 0.5 h
    forMerchant('otter-ai', 16.99), // rebuild: 203.88 -> 203.88, 8 h
    forMerchant('dropbox', 11.99), // selfhost: 143.88 -> 121.88, 4 h (needs a device)
    forMerchant('xfinity', 85), // haggle: 1020 -> 178.5, 0.5 h
    forMerchant('spotify', 11.99), // keep: 143.88
    series({ key: 'iron-forge-fitness@39.00', currentAmount: 39 }), // unmatched keep: 468
    forMerchant('paramount-plus', 7.99, { active: false, lastSeen: '2026-05-18' }), // gone
  ];

  it('totals count active series only', () => {
    const { summary, items } = assess(fleet(), TEST_KB, ctx({ devices: ['nas'] }));
    expect(items).toHaveLength(8);
    expect(summary.totalYear).toBeCloseTo(215.88 + 240 + 203.88 + 143.88 + 1020 + 143.88 + 468, 2);
    expect(summary.byVerdict.keep.count).toBe(2);
    expect(summary.byVerdict.keep.costYear).toBeCloseTo(143.88 + 468, 2);
    expect(summary.byVerdict.keep.savingsYear).toBe(0);
    expect(Object.values(summary.byVerdict).reduce((n, v) => n + v.count, 0)).toBe(7);
  });

  it('savings and build hours add up (devices present)', () => {
    const { summary } = assess(fleet(), TEST_KB, ctx({ devices: ['nas'] }));
    expect(summary.byVerdict.rotate.savingsYear).toBe(71.96);
    expect(summary.byVerdict.absorb.savingsYear).toBe(240);
    expect(summary.byVerdict.rebuild.savingsYear).toBe(203.88);
    expect(summary.byVerdict.selfhost.savingsYear).toBe(121.88);
    expect(summary.byVerdict.haggle.savingsYear).toBe(178.5);
    expect(summary.savingsYear).toBeCloseTo(71.96 + 240 + 203.88 + 121.88 + 178.5, 2);
    expect(summary.buildHours).toBe(0.5 + 8 + 4);
  });

  it('without devices the selfhost item drops out of savings and hours', () => {
    const { summary } = assess(fleet(), TEST_KB, ctx({ devices: [] }));
    expect(summary.byVerdict.selfhost.count).toBe(1);
    expect(summary.byVerdict.selfhost.savingsYear).toBe(0);
    expect(summary.savingsYear).toBeCloseTo(71.96 + 240 + 203.88 + 178.5, 2);
    expect(summary.buildHours).toBe(0.5 + 8);
  });

  it('claudeCostYear: added once when the user has no Claude plan and any absorb, rebuild or selfhost is counted', () => {
    const none = assess(fleet(), TEST_KB, ctx({ claudePlan: 'none' })).summary;
    expect(CLAUDE_PRO_MONTHLY).toBe(20);
    expect(none.claudeCostYear).toBe(240);
    expect(none.netSavingsYear).toBe(Math.round((none.savingsYear - 240) * 100) / 100);
    // two absorb items still add it only once
    const two = assess([...fleet(), forMerchant('grammarly', 12)], TEST_KB, ctx({ claudePlan: 'none' })).summary;
    expect(two.byVerdict.absorb.count).toBe(2);
    expect(two.claudeCostYear).toBe(240);
  });

  it('claudeCostYear also covers rebuild-only and selfhost-only statements: Claude Code needs a plan too', () => {
    // R8: a user with no Claude plan whose only build item is a REBUILD used to see full savings and no Claude cost
    const rebuild = assess([forMerchant('otter-ai', 16.99)], TEST_KB, ctx({ claudePlan: 'none' })).summary;
    expect(rebuild.byVerdict.rebuild.count).toBe(1);
    expect(rebuild.byVerdict.absorb.count).toBe(0);
    expect(rebuild.claudeCostYear).toBe(240);
    expect(rebuild.netSavingsYear).toBe(Math.round((rebuild.savingsYear - 240) * 100) / 100);

    const selfhost = assess([forMerchant('dropbox', 11.99)], TEST_KB, ctx({ claudePlan: 'none', devices: ['nas'] })).summary;
    expect(selfhost.byVerdict.selfhost.count).toBe(1);
    expect(selfhost.claudeCostYear).toBe(240);

    // a selfhost item that is blocked for lack of a device is not a counted build, so it adds no Claude cost
    const blocked = assess([forMerchant('dropbox', 11.99)], TEST_KB, ctx({ claudePlan: 'none', devices: [] })).summary;
    expect(blocked.claudeCostYear).toBe(0);

    // absorb + rebuild + selfhost together still add it once; Pro and Max users never pay it
    const all = assess(fleet(), TEST_KB, ctx({ claudePlan: 'none', devices: ['nas'] })).summary;
    expect(all.claudeCostYear).toBe(240);
    expect(assess([forMerchant('otter-ai', 16.99)], TEST_KB, ctx({ claudePlan: 'max' })).summary.claudeCostYear).toBe(0);
  });

  it('claudeCostYear is 0 for Pro / Max users, and when nothing is built', () => {
    for (const plan of ['pro', 'max'] as const) {
      const s = assess(fleet(), TEST_KB, ctx({ claudePlan: plan })).summary;
      expect(s.claudeCostYear).toBe(0);
      expect(s.netSavingsYear).toBe(s.savingsYear);
    }
    const noAbsorb = assess([forMerchant('netflix', 17.99), forMerchant('spotify', 11.99)], TEST_KB, ctx({ claudePlan: 'none' })).summary;
    expect(noAbsorb.claudeCostYear).toBe(0);
    // the only absorb item was switched away from absorb by the user
    const s = forMerchant('chatgpt-plus', 20);
    const moved = assess([s], TEST_KB, ctx({ claudePlan: 'none', verdictOverrides: { [s.key]: 'cancel' } })).summary;
    expect(moved.claudeCostYear).toBe(0);
  });

  it('the statement range comes from the caller, or falls back to the series', () => {
    const f = fleet();
    expect(assess(f, TEST_KB, ctx(), { statementStart: '2025-09-01', statementEnd: '2026-10-31' }).summary).toMatchObject({ statementStart: '2025-09-01', statementEnd: '2026-10-31' });
    const inferred = assess(f, TEST_KB, ctx()).summary;
    expect(inferred.statementStart).toBe('2026-01-01');
    expect(inferred.statementEnd).toBe('2026-10-01');
    expect(statementRange([{ date: '2026-02-01', description: 'a', amount: 1 }, { date: '2025-12-31', description: 'b', amount: 1 }])).toEqual({ start: '2025-12-31', end: '2026-02-01' });
  });

  it('inactive series are listed but cost nothing and save nothing', () => {
    const gone = assess([forMerchant('paramount-plus', 7.99, { active: false })], TEST_KB, ctx());
    expect(gone.items[0]).toMatchObject({ verdict: 'keep', savingsYear: 0, hours: 0 });
    expect(gone.items[0].reason).toMatch(/^Already gone/);
    expect(gone.summary.totalYear).toBe(0);
    expect(Object.values(gone.summary.byVerdict).every((v) => v.count === 0)).toBe(true);
  });

  it('an empty statement gives an all-zero summary', () => {
    const { items, summary } = assess([], TEST_KB, ctx());
    expect(items).toEqual([]);
    expect(summary).toMatchObject({ totalYear: 0, savingsYear: 0, buildHours: 0, claudeCostYear: 0, netSavingsYear: 0 });
  });

  it('has an entry for every verdict', () => {
    const { summary } = assess([], TEST_KB, ctx());
    const verdicts: Verdict[] = ['absorb', 'rebuild', 'selfhost', 'haggle', 'rotate', 'cancel', 'keep'];
    expect(Object.keys(summary.byVerdict).sort()).toEqual([...verdicts].sort());
  });
});

describe('build queue', () => {
  it('lists absorb + rebuild + selfhost, unblocked first, by savings per hour', () => {
    const { items } = assess(
      [forMerchant('otter-ai', 16.99), forMerchant('chatgpt-plus', 20), forMerchant('dropbox', 11.99), forMerchant('netflix', 17.99), forMerchant('paramount-plus', 7.99, { active: false })],
      TEST_KB,
      ctx({ devices: [] }),
    );
    const q = buildQueue(items);
    expect(q.map((i) => i.series.key)).toEqual(['chatgpt-plus', 'otter-ai', 'dropbox']); // 480/h, 25.49/h, then the blocked one
    expect(q[2].blocked).toBeTruthy();
    const withNas = buildQueue(assess([forMerchant('otter-ai', 16.99), forMerchant('dropbox', 11.99), forMerchant('chatgpt-plus', 20)], TEST_KB, ctx({ devices: ['nas'] })).items);
    expect(withNas.map((i) => i.series.key)).toEqual(['chatgpt-plus', 'dropbox', 'otter-ai']); // 480, 30.47, 25.49
  });
});

describe('time value', () => {
  it('netOfTime subtracts hours x hourlyValue', () => {
    const a = one(forMerchant('otter-ai', 16.99)); // 203.88 saved, 8 h
    expect(netOfTime(a, ctx({ hourlyValue: 25 }))).toBe(3.88);
    expect(netOfTime(a, ctx({ hourlyValue: 50 }))).toBe(-196.12);
  });
});

describe('reasons', () => {
  it('uses the merchant "why" for its primary verdict and a generated sentence otherwise', () => {
    const s = forMerchant('netflix', 17.99);
    expect(one(s).reason).toBe('Netflix test reason.');
    expect(one(s, ctx({ verdictOverrides: { [s.key]: 'cancel' } })).reason).toMatch(/Cancelling Netflix saves \$216 a year/);
    expect(one(s, ctx({ verdictOverrides: { [s.key]: 'keep' } })).reason).toBeTruthy();
  });
});
