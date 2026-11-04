import { describe, expect, it } from 'vitest';
import type { Merchant, RecurringSeries, Txn } from '../types';
import { dayNum, findRecurring } from './recurring';
import { TEST_KB, every, monthly, on, sortTxns } from './testkit';

const run = (txns: Txn[], kb: Merchant[] = TEST_KB): RecurringSeries[] => findRecurring(sortTxns(txns), kb);
/** A grocery run on the statement's last day so "active" is judged against 2026-10-31. */
const END: Txn = { date: '2026-10-31', description: 'TRADER JOE\'S #552 CAMBRIDGE MA', amount: 31.42 };
const byId = (s: RecurringSeries[], id: string) => s.filter((x) => x.merchantId === id);

describe('rule 1: exclusions', () => {
  it('ignores person-to-person payments, transfers, ATM, fees, interest, taxes, loans', () => {
    const txns = [
      ...monthly('Zelle payment to JANE SMITH 1234567890', 50, '2026-01-10', 10),
      ...monthly('VENMO PAYMENT 1034582937', 25, '2026-01-07', 10),
      ...monthly('ATM WITHDRAWAL 0302 MAIN ST BOSTON MA', 100, '2026-01-09', 10),
      ...monthly('Online Banking transfer to SAV 1234', 200, '2026-01-25', 10),
      ...monthly('MONTHLY MAINTENANCE FEE', 12, '2026-01-03', 10),
      ...monthly('INTEREST CHARGE ON PURCHASES', 18.4, '2026-01-28', 10),
      ...monthly('IRS USATAXPYMT', 300, '2026-01-15', 10),
      ...monthly('STUDENT LOAN PAYMENT', 220, '2026-01-12', 10),
      ...monthly('MORTGAGE PMT', 380, '2026-01-01', 10),
      ...monthly('CHASE CREDIT CRD AUTOPAY', 150, '2026-01-20', 10),
      END,
    ];
    expect(run(txns)).toEqual([]);
  });

  it('ignores rent and any unmatched single charge above $400', () => {
    const txns = [
      ...monthly('ACME PROPERTIES RENT', 1850, '2026-01-01', 10),
      ...monthly('MYSTERY CLUB MEMBERSHIP', 450, '2026-01-05', 10),
      END,
    ];
    expect(run(txns)).toEqual([]);
  });

  it('keeps a KB-matched charge above $400', () => {
    const s = run([...monthly('PELOTON MEMBERSHIP 866-679-9129 NY', 449.99, '2026-01-05', 8), END]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ merchantId: 'peloton-app', currentAmount: 449.99 });
  });

  it('a KB match beats the keyword filter ("PLANET FITNESS MONTHLY FEE")', () => {
    const s = run([...monthly('PLANET FITNESS MONTHLY FEE', 24.99, '2026-01-01', 10), END]);
    expect(s.map((x) => x.merchantId)).toEqual(['planet-fitness']);
  });

  it('ignores money in (refunds, payroll, payments)', () => {
    expect(run([...monthly('NETFLIX.COM', -15.49, '2026-01-05', 10), END])).toEqual([]);
  });

  it('a refund on a subscription does not break the series', () => {
    const s = run([...monthly('NETFLIX.COM 866-579-7172 CA', 15.49, '2026-01-05', 10), { date: '2026-04-20', description: 'NETFLIX.COM 866-579-7172 CA', amount: -15.49 }, END]);
    expect(s).toHaveLength(1);
    expect(s[0].charges).toHaveLength(10);
  });

  it('everyday merchants that repeat (coffee every Tuesday) are not subscriptions', () => {
    expect(run([...every('STARBUCKS STORE 12345 BOSTON MA', 5.75, '2026-01-06', 7, 40), END])).toEqual([]);
  });
});

describe('rule 2: grouping by KB merchant', () => {
  it('merges descriptor variants into one series with the KB name', () => {
    const txns = [
      ...monthly('NETFLIX.COM 866-579-7172 CA', 15.49, '2026-01-05', 3),
      ...monthly('NETFLIX.COM LOS GATOS CA', 15.49, '2026-04-05', 3),
      ...monthly('PAYPAL *NETFLIX 4029357733', 15.49, '2026-07-05', 3),
      END,
    ];
    const s = run(txns);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ merchantId: 'netflix', key: 'netflix', displayName: 'Netflix', cadence: 'monthly' });
    expect(s[0].charges).toHaveLength(9);
    expect(s[0].descriptors.length).toBeGreaterThanOrEqual(3);
    expect(s[0].descriptors.length).toBeLessThanOrEqual(5);
    expect(new Set(s[0].descriptors).size).toBe(s[0].descriptors.length);
  });

  it('PayPal-processed subscriptions resolve to the merchant', () => {
    const s = run([...monthly('PAYPAL *SPOTIFYUSA 402-935-7733 CA', 11.99, '2026-01-08', 8), END]);
    expect(s.map((x) => x.merchantId)).toEqual(['spotify']);
  });

  it('two simultaneous plans at one merchant stay separate with distinct keys', () => {
    const s = run([...monthly('SPOTIFY P3F8A2B91C', 11.99, '2026-01-08', 8), ...monthly('SPOTIFY P3F8A2B92D', 16.99, '2026-01-20', 8), END]);
    expect(s).toHaveLength(2);
    expect(new Set(s.map((x) => x.key)).size).toBe(2);
    expect(s.map((x) => x.currentAmount).sort()).toEqual([11.99, 16.99]);
  });

  it('unmatched merchants get a stable key from the name and amount', () => {
    const s = run([...monthly('IRON FORGE FITNESS BOSTON MA', 39, '2026-01-01', 10), END]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ merchantId: null, key: 'iron-forge-fitness@39.00', displayName: 'Iron Forge Fitness' });
    expect(s[0].candidates).toBeUndefined();
  });
});

describe('Amazon', () => {
  it('marketplace purchases are never subscriptions, even at a fixed amount each month', () => {
    const txns = [
      ...monthly('AMZN MKTP US*2K4XY7ZQ0', 24.99, '2026-01-11', 10),
      ...monthly('AMAZON.COM*AB12CD34E AMZN.COM/BILL WA', 12.99, '2026-01-04', 10),
      ...monthly('AMAZON.CO.UK*F9KHE7CE2 AMZN.CO.UK/PMTS GB', 9.99, '2026-01-06', 10),
      END,
    ];
    expect(run(txns)).toEqual([]);
  });
  it('Prime is a KB subscription', () => {
    const s = run([...monthly('AMAZON PRIME*XX1AB2CD3 AMZN.COM/BILL WA', 14.99, '2026-03-02', 8), END]);
    expect(s.map((x) => x.merchantId)).toEqual(['amazon-prime']);
  });
  it('Audible resolves even with a reference id glued after a star', () => {
    const s = run([...monthly('AUDIBLE*TK4AB5C21 AMZN.COM/BILL WA', 14.95, '2026-03-02', 8), END]);
    expect(s.map((x) => x.merchantId)).toEqual(['audible']);
  });
});

describe('rule 4: cadence and acceptance', () => {
  it('weekly (KB)', () => {
    const s = run([...every('HELLOFRESH.COM NEW YORK NY', 59.94, '2026-01-06', 7, 40), END]);
    expect(s[0]).toMatchObject({ merchantId: 'hellofresh', cadence: 'weekly', annualCost: 3116.88 });
  });
  it('biweekly (unmatched, needs five charges)', () => {
    const s = run([...every('GREEN THUMB LAWN CARE', 45, '2026-01-02', 14, 12), END]);
    expect(s[0]).toMatchObject({ cadence: 'biweekly', currentAmount: 45, annualCost: 1170 });
    expect(run([...every('GREEN THUMB LAWN CARE', 45, '2026-01-02', 14, 4), END])).toEqual([]);
  });
  it('monthly', () => {
    const s = run([...monthly('IRON FORGE FITNESS BOSTON MA', 39, '2026-01-01', 10), END]);
    expect(s[0]).toMatchObject({ cadence: 'monthly', annualCost: 468 });
  });
  it('quarterly (unmatched, needs four charges)', () => {
    const s = run([...every('PEST CONTROL PLUS', 79, '2025-12-01', 91, 4), END]);
    expect(s[0]).toMatchObject({ cadence: 'quarterly', annualCost: 316 });
    expect(run([...every('PEST CONTROL PLUS', 79, '2026-03-01', 91, 3), END])).toEqual([]);
  });
  it('semiannual', () => {
    const s = run([...every('DENTAL PLAN CO', 120, '2024-12-01', 182, 4), END]);
    expect(s[0]).toMatchObject({ cadence: 'semiannual', annualCost: 240 });
  });
  it('annual: two charges a year apart with a KB match', () => {
    const s = run([...every('GRAMMARLY INC GRAMMARLY.COM CA', 144, '2025-10-08', 365, 2), END]);
    expect(s[0]).toMatchObject({ merchantId: 'grammarly', cadence: 'annual', annualCost: 144, active: true });
  });
  it('annual without a KB match needs three charges', () => {
    expect(run([...every('NEIGHBORHOOD ASSOCIATION DUES', 95, '2025-02-01', 365, 2), END])).toEqual([]);
    const s = run([...every('NEIGHBORHOOD ASSOCIATION DUES', 95, '2024-02-01', 365, 3), END]);
    expect(s[0]).toMatchObject({ cadence: 'annual', annualCost: 95 });
  });
  it('tolerates a missed month (regularity >= 0.6)', () => {
    const dates = ['2026-01-05', '2026-02-05', '2026-03-05', '2026-05-05', '2026-06-05', '2026-07-05', '2026-08-05'];
    const s = run([...on('IRON FORGE FITNESS BOSTON MA', 39, dates), END]);
    expect(s).toHaveLength(1);
    expect(s[0].cadence).toBe('monthly');
  });
  it('rejects irregular spending even at one amount', () => {
    const dates = ['2026-01-03', '2026-01-19', '2026-03-28', '2026-04-02', '2026-07-30', '2026-08-04'];
    expect(run([...on('CORNER DELI REGULARS', 12, dates), END])).toEqual([]);
  });
  it('rejects three charges whose gaps do not repeat', () => {
    expect(run([...on('IRON FORGE FITNESS BOSTON MA', 39, ['2026-01-05', '2026-02-05', '2026-04-20']), END])).toEqual([]);
  });
});

describe('rule 4: short series and the KB', () => {
  it('two charges a month apart count when KB-matched', () => {
    const s = run([...monthly('NETFLIX.COM 866-579-7172 CA', 15.49, '2026-09-05', 2), END]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ merchantId: 'netflix', cadence: 'monthly' });
  });
  it('two charges do not count without a KB match', () => {
    expect(run([...monthly('IRON FORGE FITNESS BOSTON MA', 39, '2026-09-05', 2), END])).toEqual([]);
  });
  it('two KB charges at an interval that is not a cadence do not count', () => {
    expect(run([...on('NETFLIX.COM 866-579-7172 CA', 15.49, ['2026-08-01', '2026-09-15']), END])).toEqual([]);
  });
  it('a single charge counts only when it equals an annual priceHint within 3%', () => {
    const single = (amount: number, desc = 'GRAMMARLY INC GRAMMARLY.COM CA') => run([{ date: '2026-03-02', description: desc, amount }, END]);
    expect(single(144)).toHaveLength(1);
    expect(single(144)[0]).toMatchObject({ merchantId: 'grammarly', cadence: 'annual', annualCost: 144, active: true });
    expect(single(140)).toHaveLength(1); // 2.8% under
    expect(single(150)).toHaveLength(0); // 4.2% over
    expect(single(15.49, 'NETFLIX.COM 866-579-7172 CA')).toHaveLength(0); // monthly merchant, monthly price
    expect(single(139, 'SOME UNKNOWN SHOP')).toHaveLength(0); // unmatched
    expect(single(59.88, 'NORDVPN.COM NORDSEC')[0]).toMatchObject({ merchantId: 'nordvpn' });
    expect(single(71.88, 'NORDVPN.COM NORDSEC')[0]).toMatchObject({ merchantId: 'nordvpn' });
  });
  it('confidence stays within 0.5..1 and grows with evidence', () => {
    const lots = run([...monthly('NETFLIX.COM 866-579-7172 CA', 15.49, '2026-01-05', 10), END])[0];
    const few = run([...monthly('NETFLIX.COM 866-579-7172 CA', 15.49, '2026-09-05', 2), END])[0];
    const unmatched = run([...monthly('IRON FORGE FITNESS BOSTON MA', 39, '2026-01-01', 10), END])[0];
    for (const s of [lots, few, unmatched]) {
      expect(s.confidence).toBeGreaterThanOrEqual(0.5);
      expect(s.confidence).toBeLessThanOrEqual(1);
    }
    expect(lots.confidence).toBeGreaterThan(few.confidence);
    expect(lots.confidence).toBeGreaterThan(unmatched.confidence);
  });
});

describe('rule 6: price changes', () => {
  it('a hike that persists is reported once, and the series keeps going', () => {
    const txns = [...monthly('NETFLIX.COM 866-579-7172 CA', 15.49, '2025-10-05', 6), ...monthly('NETFLIX.COM 866-579-7172 CA', 17.99, '2026-04-05', 7), END];
    const s = run(txns);
    expect(s).toHaveLength(1);
    expect(s[0].charges).toHaveLength(13);
    expect(s[0].currentAmount).toBe(17.99);
    expect(s[0].priceChanges).toEqual([{ date: '2026-04-05', from: 15.49, to: 17.99 }]);
    expect(s[0].annualCost).toBe(215.88);
  });
  it('a hike on the latest charge still counts', () => {
    const s = run([...monthly('NETFLIX.COM 866-579-7172 CA', 15.49, '2026-02-05', 8), { date: '2026-10-05', description: 'NETFLIX.COM 866-579-7172 CA', amount: 17.99 }, END]);
    expect(s[0].priceChanges).toEqual([{ date: '2026-10-05', from: 15.49, to: 17.99 }]);
    expect(s[0].currentAmount).toBe(17.99);
  });
  it('a one-off blip (proration) that returns to the old price is not a price change', () => {
    const amounts = [15.49, 15.49, 15.49, 15.49, 15.49, 5.3, 15.49, 15.49, 15.49, 15.49];
    const txns = amounts.map((amount, i) => monthly('NETFLIX.COM 866-579-7172 CA', amount, '2026-01-05', i + 1)[i]);
    const s = run([...txns, END]);
    expect(s[0].priceChanges).toEqual([]);
    expect(s[0].currentAmount).toBe(15.49);
  });
  it('two successive hikes are both reported', () => {
    const txns = [...monthly('SPOTIFY P3F8A2B91C', 10.99, '2025-11-08', 4), ...monthly('SPOTIFY P3F8A2B91C', 11.99, '2026-03-08', 4), ...monthly('SPOTIFY P3F8A2B91C', 12.99, '2026-07-08', 4), END];
    const s = run(txns);
    expect(s).toHaveLength(1);
    expect(s[0].priceChanges.map((p) => `${p.from}->${p.to}`)).toEqual(['10.99->11.99', '11.99->12.99']);
  });
  it('uses a 2% threshold', () => {
    const small = run([...monthly('SPOTIFY P3F8A2B91C', 9.99, '2026-01-08', 5), ...monthly('SPOTIFY P3F8A2B91C', 10.09, '2026-06-08', 5), END]);
    expect(small[0].priceChanges).toEqual([]);
    const bigger = run([...monthly('SPOTIFY P3F8A2B91C', 9.99, '2026-01-08', 5), ...monthly('SPOTIFY P3F8A2B91C', 10.29, '2026-06-08', 5), END]);
    expect(bigger[0].priceChanges).toHaveLength(1);
  });
  it('works for unrecognized merchants too', () => {
    const s = run([...monthly('IRON FORGE FITNESS BOSTON MA', 39, '2026-01-01', 6), ...monthly('IRON FORGE FITNESS BOSTON MA', 42, '2026-07-01', 4), END]);
    expect(s).toHaveLength(1);
    expect(s[0].priceChanges).toEqual([{ date: '2026-07-01', from: 39, to: 42 }]);
    expect(s[0].key).toBe('iron-forge-fitness@39.00'); // keyed on the first price so it stays stable across a hike
  });
  it('a tripling is a different product, not a price change: two series, no price change on either', () => {
    const s = run([...monthly('IRON FORGE FITNESS BOSTON MA', 20, '2026-01-01', 4), ...monthly('IRON FORGE FITNESS BOSTON MA', 60, '2026-05-01', 6), END]);
    expect(s.map((x) => x.currentAmount).sort((a, b) => a - b)).toEqual([20, 60]);
    expect(s.every((x) => x.priceChanges.length === 0)).toBe(true);
  });
});

describe('rule 7: active / inactive', () => {
  const lastCharge = (last: string) => {
    const dates = [] as string[];
    let [y, m] = [+last.slice(0, 4), +last.slice(5, 7)];
    const d = last.slice(8, 10);
    for (let i = 0; i < 8; i++) {
      dates.unshift(`${y}-${String(m).padStart(2, '0')}-${d}`);
      m--;
      if (m === 0) { m = 12; y--; }
    }
    return run([...on('NETFLIX.COM 866-579-7172 CA', 15.49, dates), END])[0];
  };
  it('monthly is active up to 1.5 periods (45 days) after the last charge', () => {
    const s = lastCharge('2026-09-16'); // 45 days before 2026-10-31
    expect(dayNum('2026-10-31') - dayNum('2026-09-16')).toBe(45);
    expect(s.active).toBe(true);
  });
  it('and inactive one day later', () => {
    const s = lastCharge('2026-09-15');
    expect(dayNum('2026-10-31') - dayNum('2026-09-15')).toBe(46);
    expect(s.active).toBe(false);
  });
  it('a cancelled subscription is detected and marked inactive', () => {
    const s = run([...monthly('PARAMOUNT+ 877-274-7228 NY', 7.99, '2025-10-18', 8), END]);
    expect(s[0]).toMatchObject({ merchantId: 'paramount-plus', active: false, lastSeen: '2026-05-18' });
  });
  it('statement end comes from ALL rows, including payroll deposits', () => {
    const s = run([...monthly('NETFLIX.COM 866-579-7172 CA', 15.49, '2025-10-05', 8), { date: '2026-10-31', description: 'ACME CORP DES:PAYROLL', amount: -1880.15 }]);
    expect(s[0].active).toBe(false);
  });
  it('an annual subscription charged 500 days ago is still active (1.5 x 365)', () => {
    const s = run([...on('GRAMMARLY INC GRAMMARLY.COM CA', 144, ['2024-06-18', '2025-06-18']), { date: '2026-10-31', description: 'KROGER', amount: 10 }]);
    expect(s[0].cadence).toBe('annual');
    expect(s[0].active).toBe(true);
  });
});

describe('variable bills (telecom-utilities-finance)', () => {
  it('keeps varying amounts together and reports a median-ish current amount', () => {
    const amounts = [79.99, 84.5, 91.2, 76, 88.3, 82.1, 95.4, 80.2, 86.7, 90.1];
    const txns = amounts.map((a, i) => monthly('COMCAST CABLE COMM 800-COMCAST PA', a, '2026-01-14', i + 1)[i]);
    const s = run([...txns, END]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ merchantId: 'xfinity', cadence: 'monthly' });
    expect(s[0].charges).toHaveLength(10);
    expect(s[0].currentAmount).toBeGreaterThan(80);
    expect(s[0].currentAmount).toBeLessThan(92);
    expect(s[0].priceChanges).toEqual([]);
  });
  it('a flat bill that rises once still shows the new price and a price change', () => {
    const s = run([...monthly('COMCAST CABLE COMM 800-COMCAST PA', 79.99, '2026-01-14', 7), ...monthly('COMCAST CABLE COMM 800-COMCAST PA', 84.99, '2026-08-14', 3), END]);
    expect(s[0].currentAmount).toBe(84.99);
    expect(s[0].priceChanges).toEqual([{ date: '2026-08-14', from: 79.99, to: 84.99 }]);
  });
});

describe('rule 8: APPLE.COM/BILL and GOOGLE * bundles', () => {
  const apple = (amount: number, first: string, n = 8) => monthly('APPLE.COM/BILL 866-712-7753 CA', amount, first, n);

  it('every amount cluster is its own series with candidates from the KB', () => {
    const s = run([...apple(9.99, '2026-01-09'), ...apple(0.99, '2026-01-16'), END]);
    expect(s).toHaveLength(2);
    const big = s.find((x) => x.currentAmount === 9.99)!;
    const small = s.find((x) => x.currentAmount === 0.99)!;
    expect(big.displayName).toBe('App Store subscription ($9.99/mo)');
    expect(small.displayName).toBe('App Store subscription ($0.99/mo)');
    expect(big).toMatchObject({ merchantId: null, key: 'apple-bill@9.99', cadence: 'monthly' });
    expect(big.candidates).toEqual(['icloud-plus', 'apple-tv-plus']);
    expect(small.candidates).toEqual(['icloud-plus']);
  });
  it('candidates must be billed via Apple and within $0.02 of the amount', () => {
    const s = run([...apple(10.99, '2026-01-09'), END]);
    expect(s[0].candidates).toEqual(['apple-music']); // not YouTube Premium (Google) or Netflix (direct)
    const off = run([...apple(10.95, '2026-01-09'), END]);
    expect(off[0].candidates).not.toContain('apple-music'); // 4 cents under its price: not an exact match
    expect(off[0].candidates).toEqual(['icloud-plus', 'apple-tv-plus']); // so the sales-tax fallback (hint + up to 10%) applies
    const none = run([...apple(4.99, '2026-01-09'), END]);
    expect(none[0].candidates).toEqual([]);
    expect(none[0].displayName).toBe('App Store subscription ($4.99/mo)');
  });
  it('allows for sales tax on top of the list price when nothing matches exactly', () => {
    const s = run([...apple(10.79, '2026-01-09'), END]); // 9.99 + 8%
    expect(s[0].candidates).toEqual(['icloud-plus', 'apple-tv-plus']);
  });
  it('caps candidates at six and ranks cadence matches first', () => {
    const base = TEST_KB[0];
    const hint = (cadence: 'monthly' | 'annual') => ({ amount: 4.99, cadence, plan: 'x' });
    const kb: Merchant[] = [];
    for (let i = 0; i < 8; i++) kb.push({ ...base, id: `app-${i}`, match: { patterns: [`ZZAPP${i}`], examples: [], billedVia: 'apple', priceHints: [hint(i === 0 ? 'annual' : 'monthly')] } });
    const s = run([...apple(4.99, '2026-01-09'), END], kb);
    expect(s[0].candidates).toHaveLength(6);
    expect(s[0].candidates![0]).toBe('app-1'); // monthly series: the annual-only hint (app-0) is demoted
    expect(s[0].candidates).not.toContain('app-0');
  });
  it('one-off App Store purchases at assorted prices are not subscriptions', () => {
    const odd = ['2026-01-04', '2026-02-19', '2026-04-02', '2026-04-30', '2026-07-15', '2026-09-09'];
    const amounts = [4.99, 0.99, 2.99, 9.99, 1.99, 14.99];
    const txns = odd.map((date, i) => ({ date, description: 'APPLE.COM/BILL 866-712-7753 CA', amount: amounts[i] }));
    expect(run([...txns, END])).toEqual([]);
  });
  it('a GOOGLE * charge the KB recognises resolves to the merchant (YouTube Premium)', () => {
    const s = run([...monthly('GOOGLE *YouTubePremium g.co/helppay#', 13.99, '2026-01-03', 8), END]);
    expect(s[0]).toMatchObject({ merchantId: 'youtube-premium', displayName: 'YouTube Premium' });
    expect(s[0].candidates).toBeUndefined();
  });
  it('an unrecognised GOOGLE * charge becomes a Google Play bundle with candidates', () => {
    const s = run([...monthly('GOOGLE *LUMOSITY g.co/helppay#', 12.99, '2026-01-12', 8), END]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ merchantId: null, displayName: 'Google Play subscription ($12.99/mo)', candidates: ['duolingo'] });
    expect(s[0].key).toBe('google-play-google-lumosity@12.99');
  });
  it('annual Apple subscriptions are labelled /yr', () => {
    const s = run([...every('APPLE.COM/BILL 866-712-7753 CA', 29.99, '2023-04-01', 365, 3), END]);
    expect(s[0]).toMatchObject({ cadence: 'annual', displayName: 'App Store subscription ($29.99/yr)' });
  });
});

describe('series shape', () => {
  const s = run([...monthly('NETFLIX.COM 866-579-7172 CA', 15.49, '2026-01-05', 10), END])[0];
  it('has ascending charges, matching first/last seen and annualCost = amount x periods', () => {
    const dates = s.charges.map((c) => c.date);
    expect([...dates].sort()).toEqual(dates);
    expect(s.firstSeen).toBe(dates[0]);
    expect(s.lastSeen).toBe(dates[dates.length - 1]);
    expect(s.annualCost).toBe(185.88);
    expect(s.currentAmount).toBe(15.49);
  });
  it('collapses same-day duplicates (pending + posted)', () => {
    const txns = [...monthly('NETFLIX.COM 866-579-7172 CA', 15.49, '2026-01-05', 10), { date: '2026-03-05', description: 'NETFLIX.COM 866-579-7172 CA', amount: 15.49 }, END];
    expect(run(txns)[0].charges).toHaveLength(10);
  });
  it('returns [] for no transactions and for charges only', () => {
    expect(findRecurring([], TEST_KB)).toEqual([]);
    expect(run([END])).toEqual([]);
  });
  it('never mutates its input', () => {
    const txns = sortTxns([...monthly('NETFLIX.COM 866-579-7172 CA', 15.49, '2026-01-05', 10), END]);
    const copy = JSON.stringify(txns);
    findRecurring(txns, TEST_KB);
    expect(JSON.stringify(txns)).toBe(copy);
  });
  it('survives an empty KB and a KB with a broken pattern', () => {
    const txns = [...monthly('IRON FORGE FITNESS BOSTON MA', 39, '2026-01-01', 10), END];
    expect(findRecurring(txns, [])).toHaveLength(1);
    const broken: Merchant[] = [{ ...TEST_KB[0], match: { patterns: ['(unclosed', 'IRON FORGE'], examples: [] } }];
    expect(findRecurring(txns, broken)).toHaveLength(1);
  });
});

describe('unrecognized merchants: the evidence bar is higher', () => {
  it('rejects amounts that merely cluster', () => {
    const wobble = [21.5, 22.9, 21.9, 23.4, 22.1, 21.7, 23.0, 22.4];
    const txns = wobble.map((a, i) => monthly('CORNER BISTRO BOSTON MA', a, '2026-01-09', i + 1)[i]);
    expect(run([...txns, END])).toEqual([]);
  });
  it('rejects a merchant where the repeating amount explains under 60% of the charges', () => {
    const regular = monthly('BOSTON SPORTS CLUB 0412 BOSTON MA', 89, '2026-01-03', 6);
    const extras = [14.2, 31.8, 6.5, 52.0, 9.75, 28.4, 17.1, 44.0, 12.6].map((a, i) => ({ date: `2026-0${(i % 9) + 1}-1${i % 9}`, description: 'BOSTON SPORTS CLUB 0412 BOSTON MA', amount: a }));
    expect(run([...regular, ...extras, END])).toEqual([]);
  });
  it('still finds a club that also charges a one-off fee now and then', () => {
    const regular = monthly('BOSTON SPORTS CLUB 0412 BOSTON MA', 89, '2026-01-03', 10);
    const s = run([...regular, { date: '2026-05-20', description: 'BOSTON SPORTS CLUB 0412 BOSTON MA', amount: 15 }, END]);
    expect(s).toHaveLength(1);
    expect(s[0].charges).toHaveLength(10);
  });
});
