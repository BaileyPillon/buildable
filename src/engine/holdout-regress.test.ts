// Regression tests for the findings of the holdout / robustness review (HO-xx, R8, ROB-xx). Each block names its
// finding. Where it matters the scenario runs against both the small test KB and the real KB (src/kb), because the
// real descriptors and price hints are what the holdout statements exercised.
import { describe, expect, it } from 'vitest';
import type { Merchant, RecurringSeries, Txn } from '../types';
import { MERCHANTS } from '../kb';
import { achPurpose } from './normalize';
import {
  MAX_COLUMNS, MAX_FILE_CHARS, MAX_ROWS, MAX_TOTAL_CHARS, detectDelimiter, parseDelimited, parseFiles, parseOne, sniffUnreadable,
} from './parse';
import { findRecurring } from './recurring';
import { TEST_KB, monthly, sortTxns } from './testkit';

const run = (txns: Txn[], kb: Merchant[]): RecurringSeries[] => findRecurring(sortTxns(txns), kb);
/** A grocery run on the statement's last day so "active" is judged against 2026-10-31. */
const END: Txn = { date: '2026-10-31', description: "TRADER JOE'S #552 CAMBRIDGE MA", amount: 31.42 };

type KbCase = { label: string; kb: Merchant[]; ids: Record<string, string> };
const KBS: KbCase[] = [
  { label: 'test KB', kb: TEST_KB, ids: { dropbox: 'dropbox', nyt: 'nytimes' } },
  { label: 'real KB', kb: MERCHANTS, ids: { dropbox: 'dropbox-plus', nyt: 'nyt-digital' } },
];

/** `count` monthly charges with a different raw descriptor each month. */
function withRefs(descriptorOf: (i: number) => string, amount: number, first: string, count: number): Txn[] {
  return monthly('x', amount, first, count).map((t, i) => ({ ...t, description: descriptorOf(i) }));
}
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Reference ids that survive normalization: 9 characters with no digit at all, unique per charge. */
const noDigitRef = (i: number) => `${A[i]}${A[(i * 7 + 3) % 26]}${A[(i * 5 + 1) % 26]}QZKLMN`;
/** ... and with exactly one digit. */
const oneDigitRef = (i: number) => `${A[(i * 3 + 2) % 26]}${i % 10}${A[(i * 11 + 4) % 26]}KLMNOP`;
/** A reference id that normalization strips (two or more digits). */
const strippedRef = (i: number) => `AB${10 + i}CD${20 + i}E`;

describe.each(KBS)('HO-01: charges whose reference id survives normalization ($label)', ({ kb, ids }) => {
  const cases: { name: string; id: string; amount: number; make: (ref: (i: number) => string) => (i: number) => string }[] = [
    { name: 'Amazon Prime', id: 'amazon-prime', amount: 14.99, make: (r) => (i) => `AMAZON PRIME*${r(i)} AMZN.COM/BILL WA` },
    { name: 'Audible', id: 'audible', amount: 14.95, make: (r) => (i) => `AUDIBLE*${r(i)} AMZN.COM/BILL NJ` },
    { name: 'Dropbox', id: ids.dropbox, amount: 11.99, make: (r) => (i) => `DROPBOX*${r(i)} DROPBOX.COM CA` },
    { name: 'Spotify (descriptor drifts to "SPOTIFY P<ref>")', id: 'spotify', amount: 18.99, make: (r) => (i) => `SPOTIFY P${r(i).slice(0, 8)}` },
  ];

  for (const c of cases) {
    it(`${c.name}: the latest charge has a 0-digit ref, so it used to be dropped and the series went inactive`, () => {
      const descriptorOf = c.make((i) => (i === 11 ? 'ABCDEFGHI' : strippedRef(i)));
      const s = run([...withRefs(descriptorOf, c.amount, '2025-11-12', 12), END], kb).filter((x) => x.merchantId === c.id);
      expect(s).toHaveLength(1);
      expect(s[0].charges).toHaveLength(12);
      expect(s[0].lastSeen).toBe('2026-10-12');
      expect(s[0].active).toBe(true);
    });

    it(`${c.name}: every charge has a unique 0-digit ref`, () => {
      const s = run([...withRefs(c.make(noDigitRef), c.amount, '2025-11-12', 12), END], kb).filter((x) => x.merchantId === c.id);
      expect(s).toHaveLength(1);
      expect(s[0].charges).toHaveLength(12);
      expect(s[0].active).toBe(true);
    });

    it(`${c.name}: every charge has a unique 1-digit ref`, () => {
      const s = run([...withRefs(c.make(oneDigitRef), c.amount, '2025-11-12', 12), END], kb).filter((x) => x.merchantId === c.id);
      expect(s).toHaveLength(1);
      expect(s[0].charges).toHaveLength(12);
      expect(s[0].active).toBe(true);
    });
  }

  it('a lone charge is judged per merchant, not per descriptor key: a one-off at a KB merchant is not a series', () => {
    const lone = run([{ date: '2026-03-04', description: 'DROPBOX*QWERTYUIO DROPBOX.COM CA', amount: 11.99 }, END], kb);
    expect(lone.filter((x) => x.merchantId === ids.dropbox)).toHaveLength(0);
  });

  it('a lone charge that equals an annual priceHint still counts, whatever its unique ref', () => {
    const s = run([{ date: '2026-03-04', description: 'AUDIBLE*QWERTYUIO AMZN.COM/BILL NJ', amount: 149.5 }, END], kb).filter((x) => x.merchantId === 'audible');
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ cadence: 'annual', currentAmount: 149.5 });
    expect(s[0].charges).toHaveLength(1);
  });

  it('a single-charge descriptor key no longer hides a charge from a merchant that also has other keys', () => {
    // 6 months whose refs are stripped by normalization, then 4 months whose refs are not: one merchant, two keys
    const early = withRefs((i) => `AMAZON PRIME*${strippedRef(i)} AMZN.COM/BILL WA`, 14.99, '2026-01-12', 6);
    const late = withRefs((i) => `AMAZON PRIME*${noDigitRef(i)} AMZN.COM/BILL WA`, 14.99, '2026-07-12', 4);
    const s = run([...early, ...late, END], kb).filter((x) => x.merchantId === 'amazon-prime');
    expect(s).toHaveLength(1);
    expect(s[0].charges).toHaveLength(10);
    expect(s[0].active).toBe(true);
  });
});

describe('HO-02: an ACH loan payment is not a subscription, however the bank words it', () => {
  const nelnet = (when: string) =>
    `ORIG CO NAME:NELNET ORIG ID:2265505721 DESC DATE:${when} CO ENTRY DESCR:LOAN PMT SEC:WEB TRACE#:021000126944063 EED:251025 IND ID:84469320 IND NAME:JORDAN LEE TRN: 1858255251TC`;

  it('achPurpose reads what the blob says the payment is for', () => {
    expect(achPurpose(nelnet('102521'))).toBe('LOAN PMT');
    expect(achPurpose('COMCAST CABLE COMM DES:CABLE PYMT ID:123 INDN:JANE DOE CO ID:456 WEB')).toBe('CABLE PYMT');
    expect(achPurpose('NETFLIX.COM 866-579-7172 CA')).toBe('');
  });

  it('the full Chase ACH line for a student loan is excluded', () => {
    const txns = monthly(nelnet('102521'), 312.4, '2026-01-05', 10).map((t) => ({ ...t, description: nelnet(t.date.slice(5, 7) + t.date.slice(8, 10) + '26') }));
    expect(run([...txns, END], TEST_KB)).toEqual([]);
    expect(run([...txns, END], MERCHANTS)).toEqual([]);
  });

  it('the same loan written as plain text, and bare servicer names, are excluded too', () => {
    expect(run([...monthly('NELNET LOAN PMT', 312.4, '2026-01-05', 10), END], TEST_KB)).toEqual([]);
    for (const servicer of ['NELNET', 'NAVIENT', 'MOHELA', 'AIDVANTAGE', 'GREAT LAKES', 'SALLIE MAE']) {
      expect(run([...monthly(`${servicer} 800-555-0100 PA`, 250, '2026-01-05', 10), END], TEST_KB), servicer).toEqual([]);
    }
  });

  it('the exclusion comes from the ACH purpose field, not just from known servicer names', () => {
    const blob = (when: string) =>
      `ORIG CO NAME:HARBOR CREDIT UNION ORIG ID:3057124380 DESC DATE:${when} CO ENTRY DESCR:LOAN PMT SEC:WEB TRACE#:968261555331901 EED:261005 IND ID:718718603 IND NAME:JANE DOE TRN: 6959234675TC`;
    const txns = monthly('x', 310, '2026-01-05', 10).map((t) => ({ ...t, description: blob(t.date.slice(5, 7) + t.date.slice(8, 10) + '26') }));
    expect(run([...txns, END], TEST_KB)).toEqual([]);
  });

  it('BofA-style DES: lines are read the same way', () => {
    const loan = monthly('ACME FINANCE DES:LOAN PMT ID:123 INDN:JANE DOE CO ID:456 WEB', 220, '2026-01-12', 10);
    expect(run([...loan, END], TEST_KB)).toEqual([]);
  });

  it('a generic ACH purpose (AUTOPAY) does not exclude a real subscription such as a storage unit', () => {
    const storage = (i: number) =>
      `ORIG CO NAME:WEST SIDE SELF STORAGE 617-555-0188 MA ORIG ID:39571243${10 + i} DESC DATE:2610${10 + i} CO ENTRY DESCR:AUTOPAY SEC:WEB TRACE#:96826155533190${i} EED:261005 IND ID:718718603 IND NAME:JANE DOE TRN: 6959234675TC`;
    const s = run([...withRefs(storage, 129, '2026-01-05', 10), END], TEST_KB);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ merchantId: null, cadence: 'monthly', currentAmount: 129 });
  });

  it('a KB match still beats the exclusion words', () => {
    const rows = monthly('ORIG CO NAME:PLANET FITNESS ORIG ID:123 CO ENTRY DESCR:LOAN PMT SEC:WEB', 24.99, '2026-01-01', 10);
    expect(run([...rows, END], TEST_KB).map((x) => x.merchantId)).toEqual(['planet-fitness']);
  });
});

describe.each(KBS)('HO-03: intro price to full price chains into one series ($label)', ({ kb, ids }) => {
  const nyt = (amounts: number[], first = '2025-09-14') =>
    monthly('NYTIMES*NYTIMES.COM 800-698-4637 NY', 1, first, amounts.length).map((t, i) => ({ ...t, amount: amounts[i] }));

  it('NYT $4.00 x5 then $25.00 x9 is one series with the price change, and no ghost "gone" series', () => {
    const s = run([...nyt([...Array(5).fill(4), ...Array(9).fill(25)]), END], kb).filter((x) => x.merchantId === ids.nyt);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ cadence: 'monthly', currentAmount: 25, active: true });
    expect(s[0].charges).toHaveLength(14);
    expect(s[0].priceChanges).toEqual([{ date: '2026-02-14', from: 4, to: 25 }]);
  });

  it('a two-step intro ($1, then $4, then $25) chains all the way', () => {
    const s = run([...nyt([1, 1, 4, 4, 4, ...Array(7).fill(25)]), END], kb).filter((x) => x.merchantId === ids.nyt);
    expect(s).toHaveLength(1);
    expect(s[0].charges).toHaveLength(12);
    expect(s[0].priceChanges.map((p) => p.to)).toEqual([4, 25]);
  });

  it('a jump of more than 8x does not chain (that is a different plan, not an intro price)', () => {
    const s = run([...nyt([...Array(4).fill(1), ...Array(9).fill(25)]), END], kb).filter((x) => x.merchantId === ids.nyt);
    expect(s.every((x) => !(x.charges.some((c) => c.amount === 1) && x.charges.some((c) => c.amount === 25)))).toBe(true);
  });

  it('a big drop does not chain (a plan change, not a promo)', () => {
    const s = run([...nyt([...Array(8).fill(25), ...Array(5).fill(4)]), END], kb).filter((x) => x.merchantId === ids.nyt);
    expect(s.every((x) => !(x.charges.some((c) => c.amount === 4) && x.charges.some((c) => c.amount === 25)))).toBe(true);
  });

  it('two annual charges at different prices count as one KB-matched series with the price change', () => {
    const annual: Txn[] = [
      { date: '2025-10-11', description: 'NYTIMES*NYTIMES.COM 800-698-4637 NY', amount: 49.99 },
      { date: '2026-10-11', description: 'NYTIMES*NYTIMES.COM 800-698-4637 NY', amount: 119.99 },
    ];
    const s = run([...annual, END], kb).filter((x) => x.merchantId === ids.nyt);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ cadence: 'annual', currentAmount: 119.99, active: true });
    expect(s[0].priceChanges).toEqual([{ date: '2026-10-11', from: 49.99, to: 119.99 }]);
  });
});

describe('HO-03: Norton 360 first-year promo renewal (real KB)', () => {
  it('$49.99 then $119.99 a year later is one annual series with the price change', () => {
    const norton: Txn[] = [
      { date: '2025-10-11', description: 'NORTON *360 DELUXE 650-527-8000 CA US', amount: 49.99 },
      { date: '2026-10-11', description: 'NORTON *360 DELUXE 650-527-8000 CA US', amount: 119.99 },
    ];
    const s = run([...norton, END], MERCHANTS).filter((x) => x.merchantId === 'norton-360');
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ cadence: 'annual', currentAmount: 119.99, annualCost: 119.99, active: true });
    expect(s[0].priceChanges).toEqual([{ date: '2026-10-11', from: 49.99, to: 119.99 }]);
  });
});

describe('HO-03: unmatched merchants keep the strict 1.8x chain limit', () => {
  it('a gym that goes 10 -> 39 is two separate runs, not one chained series', () => {
    const rows = monthly('IRON FORGE FITNESS TAMPA FL', 10, '2026-01-05', 12).map((t, i) => ({ ...t, amount: i < 5 ? 10 : 39 }));
    const s = run([...rows, END], TEST_KB);
    expect(s.every((x) => !(x.charges.some((c) => c.amount === 10) && x.charges.some((c) => c.amount === 39)))).toBe(true);
  });
});

describe('HO-07: skipped months do not hide a subscription', () => {
  const skip = (gaps: number[], amount = 49.95, desc = 'FABLETICS 877-4333-8442 EL SEGUNDO CA US'): Txn[] => {
    let day = Date.UTC(2025, 9, 9);
    const out: Txn[] = [];
    const push = () => out.push({ date: new Date(day).toISOString().slice(0, 10), description: desc, amount });
    push();
    for (const g of gaps) {
      day += g * 86_400_000;
      push();
    }
    return out;
  };

  it('Fabletics VIP: 10 identical charges over 13 months with 3 skipped months is monthly', () => {
    const txns = skip([31, 61, 31, 28, 61, 31, 61, 31, 30]);
    const s = run([...txns, END], TEST_KB);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ merchantId: null, cadence: 'monthly', currentAmount: 49.95, active: true });
    expect(s[0].charges).toHaveLength(10);
  });

  it('works against the real KB too, and with a 3-month skip', () => {
    const s = run([...skip([31, 92, 61, 30, 61, 31, 92, 30, 31]), END], MERCHANTS);
    expect(s).toHaveLength(1);
    expect(s[0].charges).toHaveLength(10);
  });

  it('needs flat amounts: the same dates with varying amounts are not a subscription', () => {
    const txns = skip([31, 61, 31, 28, 61, 31, 61, 31, 30]).map((t, i) => ({ ...t, amount: 40 + (i % 4) * 7 }));
    expect(run([...txns, END], TEST_KB)).toEqual([]);
  });

  it('scattered same-price purchases (no monthly anchor) are still not a subscription', () => {
    expect(run([...skip([30, 20, 33, 75, 29, 48, 31]), END], TEST_KB)).toEqual([]);
  });

  it('a KB match is enough: a streaming service with skipped months is still found', () => {
    const rows = skip([30, 60, 30, 30, 60, 30, 60], 15.49, 'NETFLIX.COM 866-579-7172 CA');
    const s = run([...rows, END], TEST_KB).filter((x) => x.merchantId === 'netflix');
    expect(s).toHaveLength(1);
    expect(s[0].charges).toHaveLength(8);
  });
});

describe('HO-09: instalment payments on a financed purchase are not subscriptions', () => {
  it('the descriptor alone is excluded by the engine', () => {
    const rows = monthly('APPLE CARD MONTHLY INSTALLMENTS IPHONE 17 PRO', 41.62, '2025-10-26', 13);
    expect(run([...rows, END], TEST_KB)).toEqual([]);
    expect(run([...rows, END], MERCHANTS)).toEqual([]);
    expect(run([...monthly('AFFIRM INSTALLMENT 4 OF 6', 55, '2026-01-10', 6), END], TEST_KB)).toEqual([]);
  });

  const apple = [
    'Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD),Purchased By',
    '10/26/2025,10/27/2025,Monthly plan for the phone,Apple,Shopping,Installment,41.62,Jordan',
    '11/26/2025,11/27/2025,Monthly plan for the phone,Apple,Shopping,Installment,41.62,Jordan',
    '10/20/2025,10/21/2025,NETFLIX.COM,Netflix,Entertainment,Purchase,15.49,Jordan',
    '10/28/2025,10/29/2025,ACH DEPOSIT INTERNET TRANSFER,Apple,Payment,Payment,-500.00,Jordan',
    '10/29/2025,10/30/2025,DAILY CASH ADJUSTMENT,Apple,Credit,Credit,-2.00,Jordan',
  ].join('\n');

  it('the parser leaves out rows whose Type is Installment, says so, and keeps the rest', async () => {
    const { txns, warnings } = await parseFiles([{ name: 'apple-card.csv', text: apple }]);
    expect(txns.map((t) => t.description).sort()).toEqual(['ACH DEPOSIT INTERNET TRANSFER', 'DAILY CASH ADJUSTMENT', 'NETFLIX.COM']);
    expect(warnings).toEqual(['apple-card.csv: left out 2 installment payments (monthly payments on a financed purchase are not subscriptions).']);
    // Payment and Credit rows stay money-in, Purchase stays a charge
    expect(txns.find((t) => t.description === 'NETFLIX.COM')!.amount).toBe(15.49);
    expect(txns.filter((t) => t.amount < 0)).toHaveLength(2);
  });

  it('files without a Type column are untouched', async () => {
    const { txns, warnings } = await parseFiles([{ name: 'x.csv', text: 'Date,Description,Amount\n2026-01-05,INSTALLMENT PLAN,10.00\n' }]);
    expect(txns).toHaveLength(1);
    expect(warnings).toEqual([]);
  });
});

describe('ROB-5: a file with very many identical rows does not overflow the stack', () => {
  it('125,000 identical rows parse', async () => {
    const text = 'Date,Description,Amount\n' + '2026-01-05,NETFLIX,15.49\n'.repeat(125_000);
    const r = await parseFiles([{ name: 'd.csv', text }]);
    expect(r.txns).toHaveLength(125_000);
    expect(r.warnings).toEqual([]);
  }, 60_000);
});

describe('ROB-3: hostile or wrong files are bounded', () => {
  it('parseDelimited keeps at most MAX_COLUMNS cells per row, and later rows are intact', () => {
    const wide = Array.from({ length: 5000 }, (_, i) => `c${i}`).join(',');
    const rows = parseDelimited(`${wide}\n1,2,3\n"a,b",c\n${wide}`, ',');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveLength(MAX_COLUMNS);
    expect(rows[0][0]).toBe('c0');
    expect(rows[0][MAX_COLUMNS - 1]).toBe(`c${MAX_COLUMNS - 1}`);
    expect(rows[1]).toEqual(['1', '2', '3']);
    expect(rows[2]).toEqual(['a,b', 'c']);
    expect(rows[3]).toHaveLength(MAX_COLUMNS);
  });

  it('quotes inside the dropped cells do not swallow the following rows', () => {
    const cells = Array.from({ length: MAX_COLUMNS + 3 }, (_, i) => (i >= MAX_COLUMNS ? '"x,y\nz"' : `v${i}`)).join(',');
    const rows = parseDelimited(`${cells}\nnext,row`, ',');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(['next', 'row']);
  });

  it('parseDelimited stops after maxRows', () => {
    expect(parseDelimited('a,b\nc,d\ne,f\ng,h', ',', 2)).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('a wide header row does not stall column detection', async () => {
    const header = ['Date', 'Description', 'Amount', ...Array.from({ length: 20_000 }, () => 'x')].join(',');
    const t0 = performance.now();
    const r = await parseFiles([{ name: 'wide.csv', text: `${header}\n2026-01-05,NETFLIX,15.49\n` }]);
    expect(r.txns).toHaveLength(1);
    expect(performance.now() - t0).toBeLessThan(3000);
  });

  it('a big file with no line breaks is refused at once with a friendly message', async () => {
    const t0 = performance.now();
    const r = await parseFiles([{ name: 'x.csv', text: 'A,'.repeat(3_000_000) }]);
    expect(r.txns).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/^x\.csv: .*no line breaks/);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('spreadsheets, PDFs and binary files are recognised by their first bytes', async () => {
    const xlsx = await parseFiles([{ name: 's.csv', text: 'PK\u0003\u0004' + 'x'.repeat(2000) }]);
    expect(xlsx.warnings[0]).toMatch(/Excel or zip file/);
    const pdf = await parseFiles([{ name: 's.pdf', text: '%PDF-1.7\n1 0 obj\n' + 'x'.repeat(100) }]);
    expect(pdf.warnings[0]).toMatch(/PDF/);
    const bin = await parseFiles([{ name: 'b.csv', text: 'abc\u0000def\u0001'.repeat(500) }]);
    expect(bin.warnings[0]).toMatch(/binary/);
    const garbled = await parseFiles([{ name: 'g.csv', text: '��\u0002'.repeat(500) }]);
    expect(garbled.warnings[0]).toMatch(/binary/);
    for (const r of [xlsx, pdf, bin, garbled]) expect(r.txns).toEqual([]);
  });

  it('normal statements, and one-line OFX files, are not mistaken for junk', async () => {
    expect(sniffUnreadable('Date,Description,Amount\n2026-01-05,NETFLIX,15.49\n')).toBeNull();
    expect(sniffUnreadable('Date;Beschreibung;Betrag\n05.01.2026;Café Müller;-3,50\n')).toBeNull();
    const trn = (i: number) =>
      `<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260${1 + (i % 9)}05<TRNAMT>-${(10 + i / 100).toFixed(2)}<FITID>${i}<NAME>MERCHANT NUMBER ${i} WITH A LONG NAME<MEMO>${'m'.repeat(40)}</STMTTRN>`;
    const oneLine = '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>' + Array.from({ length: 700 }, (_, i) => trn(i)).join('') + '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>';
    expect(oneLine.length).toBeGreaterThan(65536);
    expect(sniffUnreadable(oneLine)).toBeNull();
    const r = parseOne('one-line.ofx', oneLine);
    expect(r.txns.length).toBe(700);
  });

  it('detectDelimiter reads a bounded sample and still gets it right', () => {
    const body = '2026-01-05;NETFLIX;15,49\n'.repeat(60_000);
    expect(body.length).toBeGreaterThan(1_000_000);
    expect(detectDelimiter(`Date;Description;Amount\n${body}`)).toBe(';');
  });

  it('rows past MAX_ROWS are dropped with a warning', async () => {
    const text = 'Date,Description,Amount\n' + '2026-01-05,NETFLIX,15.49\n2026-01-06,HULU,7.99\n'.repeat(MAX_ROWS / 2 + 5);
    const r = parseOne('long.csv', text);
    expect(r.txns.length).toBeLessThanOrEqual(MAX_ROWS - 1);
    expect(r.warnings.join(' ')).toMatch(/only the first 200,000 rows/);
  }, 60_000);

  it('files over the per-file or combined size cap are skipped with a message', async () => {
    const big = 'x'.repeat(MAX_FILE_CHARS + 1);
    const one = await parseFiles([{ name: 'huge.csv', text: big }]);
    expect(one.warnings[0]).toMatch(/^huge\.csv: this file is larger than 25 MB/);
    const half = 'Date,Description,Amount\n2026-01-05,NETFLIX,15.49\n' + 'x'.repeat(Math.floor(MAX_TOTAL_CHARS * 0.6));
    const two = await parseFiles([
      { name: 'a.csv', text: half },
      { name: 'b.csv', text: half },
    ]);
    expect(two.warnings.some((w) => /^b\.csv: skipped, because the files together are larger than 30 MB/.test(w))).toBe(true);
  });
});
