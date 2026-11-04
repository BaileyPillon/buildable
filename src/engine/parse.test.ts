import { describe, expect, it } from 'vitest';
import { detectDateOrder, parseAmount, parseDate, parseDelimited, dateParts, detectDelimiter, parseFiles } from './parse';
import { readStatement } from './testkit';

const one = async (text: string, name = 'test.csv') => parseFiles([{ name, text }]);

describe('delimited text', () => {
  it('handles quotes, escaped quotes and newlines inside quotes', () => {
    const rows = parseDelimited('a,"b, c","say ""hi""","line1\nline2"\n1,2,3,4', ',');
    expect(rows).toEqual([
      ['a', 'b, c', 'say "hi"', 'line1\nline2'],
      ['1', '2', '3', '4'],
    ]);
  });
  it('detects comma, semicolon, tab and pipe', () => {
    expect(detectDelimiter('Date,Description,Amount\n01/02/2026,Netflix,15.49\n')).toBe(',');
    expect(detectDelimiter('Date;Description;Amount\n01.02.2026;Netflix;15,49\n')).toBe(';');
    expect(detectDelimiter('Date\tDescription\tAmount\n01/02/2026\tNetflix\t15.49\n')).toBe('\t');
    expect(detectDelimiter('Date|Description|Amount\n01/02/2026|Netflix|15.49\n')).toBe('|');
  });
  it('prefers the delimiter that is consistent even when descriptions contain the other one', () => {
    const t = 'Date;Description;Amount\n01.02.2026;Netflix, Inc.;15,49\n02.02.2026;Spotify, AB;11,99\n';
    expect(detectDelimiter(t)).toBe(';');
  });
});

describe('amounts', () => {
  const v = (s: string, comma = false) => parseAmount(s, comma)?.value;
  it('parses currency symbols and thousands separators', () => {
    expect(v('$1,234.56')).toBe(1234.56);
    expect(v('£1,234.56')).toBe(1234.56);
    expect(v('€ 12.30')).toBe(12.3);
    expect(v('USD 5.00')).toBe(5);
    expect(v('1,234,567.89')).toBe(1234567.89);
  });
  it('parses decimal commas (EU)', () => {
    expect(v('12,34', true)).toBe(12.34);
    expect(v('1.234,56')).toBe(1234.56);
    expect(v('1 234,56 €', true)).toBe(1234.56);
    expect(v('-13,99', true)).toBe(-13.99);
  });
  it('treats a lone comma with three digits as thousands unless the file uses decimal commas', () => {
    expect(v('1,234')).toBe(1234);
    expect(v('1,234', true)).toBe(1.234);
  });
  it('parses negatives written as (12.34), -12.34, 12.34- and unicode minus', () => {
    expect(v('(12.34)')).toBe(-12.34);
    expect(v('-12.34')).toBe(-12.34);
    expect(v('12.34-')).toBe(-12.34);
    expect(v('−12.34')).toBe(-12.34);
    expect(v('+12.34')).toBe(12.34);
  });
  it('reports CR/DR suffixes as direction', () => {
    expect(parseAmount('12.34 CR')).toEqual({ value: 12.34, dir: 'in' });
    expect(parseAmount('12.34DR')).toEqual({ value: 12.34, dir: 'out' });
  });
  it('rejects text and empties', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('--')).toBeNull();
  });
});

describe('dates', () => {
  it('parses every supported format', () => {
    expect(parseDate('2026-01-05')).toBe('2026-01-05');
    expect(parseDate('2026/01/05')).toBe('2026-01-05');
    expect(parseDate('01/05/2026')).toBe('2026-01-05');
    expect(parseDate('1/5/26')).toBe('2026-01-05');
    expect(parseDate('05/01/2026', 'dmy')).toBe('2026-01-05');
    expect(parseDate('05.01.2026')).toBe('2026-01-05');
    expect(parseDate('Jan 5, 2026')).toBe('2026-01-05');
    expect(parseDate('January 5, 2026')).toBe('2026-01-05');
    expect(parseDate('05 Jan 2026')).toBe('2026-01-05');
    expect(parseDate('5-Jan-2026')).toBe('2026-01-05');
    expect(parseDate('2026-01-05T14:22:10Z')).toBe('2026-01-05');
    expect(parseDate('2026-01-05 14:22:10')).toBe('2026-01-05');
    expect(parseDate('20260105')).toBe('2026-01-05');
    expect(parseDate('20260105120000.000[-5:EST]')).toBe('2026-01-05');
  });
  it('rejects impossible dates', () => {
    expect(parseDate('2026-02-30')).toBeNull();
    expect(parseDate('13/13/2026')).toBeNull();
    expect(parseDate('hello')).toBeNull();
  });
  it('settles DD/MM vs MM/DD from any first field above 12', () => {
    const o = detectDateOrder(['03/02/2026', '15/02/2026', '04/03/2026'].map(dateParts));
    expect(o).toMatchObject({ order: 'dmy', certain: true });
  });
  it('settles MM/DD when a second field is above 12', () => {
    const o = detectDateOrder(['03/02/2026', '02/15/2026'].map(dateParts));
    expect(o).toMatchObject({ order: 'mdy', certain: true });
  });
  it('falls back to MM/DD with a warning-grade (uncertain) result when nothing settles it', () => {
    const o = detectDateOrder(['03/02/2026', '04/02/2026'].map(dateParts));
    expect(o.certain).toBe(false);
    expect(o.order).toBe('mdy');
  });
  it('uses chronological order to break the tie when one reading keeps the rows in order and the other does not', () => {
    // DD/MM: 3 Feb, 10 Feb, 12 Feb, 2 Mar, 5 Mar (in order). As MM/DD it would jump Dec 2 -> Feb 3.
    const rows = ['03/02/2026', '10/02/2026', '12/02/2026', '02/03/2026', '05/03/2026'];
    const o = detectDateOrder(rows.map(dateParts));
    expect(o.certain).toBe(false);
    expect(o.order).toBe('dmy');
  });
});

describe('column synonyms and layouts', () => {
  const rowsFor = (header: string, d = '01/15/2026') => `${header}\n${d},NETFLIX.COM,-15.49\n${d},SPOTIFY,-11.99\n`;
  it.each([
    ['Date,Description,Amount'],
    ['Transaction Date,Description,Amount'],
    ['Trans. Date,Description,Amount'],
    ['Posting Date,Payee,Amount'],
    ['Posted Date,Merchant,Transaction Amount'],
    ['Booking Date,Name,Amount (USD)'],
    ['Started Date,Details,Value'],
    ['Completed Date,Narrative,Amount'],
    ['date,transaction description,amount'],
    ['DATE,MEMO,AMOUNT'],
  ])('reads %s', async (header) => {
    const { txns, warnings } = await one(rowsFor(header));
    expect(warnings).toEqual([]);
    expect(txns).toHaveLength(2);
    expect(txns[0].date).toBe('2026-01-15');
    expect(txns.map((t) => Math.abs(t.amount)).sort()).toEqual([11.99, 15.49]);
  });

  it('prefers Transaction Date over Post Date', async () => {
    const { txns } = await one('Transaction Date,Post Date,Description,Amount\n01/05/2026,01/07/2026,NETFLIX.COM,-15.49\n02/05/2026,02/06/2026,NETFLIX.COM,-15.49\n');
    expect(txns.map((t) => t.date)).toEqual(['2026-01-05', '2026-02-05']);
  });

  it('strips a UTF-8 BOM and quoted headers', async () => {
    const { txns } = await one('﻿"Date","Description","Amount"\n"01/05/2026","NETFLIX.COM","-15.49"\n');
    expect(txns).toHaveLength(1);
    expect(txns[0].description).toBe('NETFLIX.COM');
  });

  it('skips a preamble before the header (Bank of America summary block) and the beginning-balance row', async () => {
    const { txns, warnings } = await one(readStatement('bofa-checking.csv'), 'bofa.csv');
    expect(warnings).toEqual([]);
    expect(txns.some((t) => /beginning balance/i.test(t.description))).toBe(false);
    expect(txns.length).toBeGreaterThan(400);
  });

  it('parses a headerless file by content (Wells Fargo)', async () => {
    const text = '"01/02/2026","-15.49","*","","PURCHASE AUTHORIZED ON 01/01 NETFLIX.COM 866-579-7172 CA S466 CARD 1234"\n"01/03/2026","2875.60","*","","ACME CORP PAYROLL 123 DIRECT DEP"\n"01/04/2026","-62.10","*","","PURCHASE AUTHORIZED ON 01/03 KROGER #0345"\n';
    const { txns } = await one(text, 'wells.csv');
    expect(txns).toHaveLength(3);
    expect(txns[0]).toMatchObject({ date: '2026-01-02', amount: 15.49 });
    expect(txns[1]).toMatchObject({ amount: -2875.6 }); // payroll is money in
    expect(txns[0].description).toContain('NETFLIX.COM');
  });

  it('reads a semicolon file with decimal commas and ISO timestamps (Revolut EU)', async () => {
    const text = 'Type;Product;Started Date;Completed Date;Description;Amount;Fee;Currency;State;Balance\nCARD_PAYMENT;Current;2026-03-02 14:40:38;2026-03-03 09:10:44;Netflix;-13,99;0,00;EUR;COMPLETED;1234,56\nTOPUP;Current;2026-03-03 10:00:00;2026-03-03 10:00:05;Top-Up by *1234;300,00;0,00;EUR;COMPLETED;1534,56\n';
    const { txns, warnings } = await one(text, 'revolut.csv');
    expect(txns[0]).toMatchObject({ date: '2026-03-02', amount: 13.99, description: 'Netflix' });
    expect(txns[1]).toMatchObject({ amount: -300 });
    expect(warnings.join(' ')).toMatch(/EUR/);
  });

  it('skips REVERTED / DECLINED rows', async () => {
    const text = 'Type;Product;Started Date;Completed Date;Description;Amount;Fee;Currency;State;Balance\nCARD_PAYMENT;Current;2026-03-02 14:40:38;2026-03-03 09:10:44;Netflix;-13,99;0,00;EUR;REVERTED;1234,56\nCARD_PAYMENT;Current;2026-03-05 14:40:38;2026-03-05 19:10:44;Netflix;-13,99;0,00;EUR;COMPLETED;1220,57\n';
    const { txns } = await one(text);
    expect(txns).toHaveLength(1);
    expect(txns[0].date).toBe('2026-03-05');
  });

  it('keeps tab-separated files working', async () => {
    const { txns } = await one('Date\tDescription\tAmount\n2026-01-05\tNETFLIX.COM\t-15.49\n2026-02-05\tNETFLIX.COM\t-15.49\n');
    expect(txns).toHaveLength(2);
  });
});

describe('sign convention', () => {
  it('credit card where purchases are negative and payments positive (Chase)', async () => {
    const { txns } = await one('Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n01/05/2026,01/06/2026,NETFLIX.COM,Entertainment,Sale,-15.49,\n01/10/2026,01/10/2026,Payment Thank You-Web,,Payment,200.00,\n01/12/2026,01/12/2026,KROGER,Groceries,Sale,-42.10,\n01/13/2026,01/13/2026,AMAZON.COM*AB12,Shopping,Return,25.00,\n');
    const by = Object.fromEntries(txns.map((t) => [t.description, t.amount]));
    expect(by['NETFLIX.COM']).toBe(15.49);
    expect(by['KROGER']).toBe(42.1);
    expect(by['Payment Thank You-Web']).toBe(-200);
    expect(by['AMAZON.COM*AB12']).toBe(-25);
  });

  it('credit card where purchases are positive and payments negative (Amex, Discover)', async () => {
    const { txns } = await one('Date,Description,Amount\n01/05/2026,NETFLIX.COM,15.49\n01/10/2026,ONLINE PAYMENT - THANK YOU,-200.00\n01/12/2026,KROGER,42.10\n');
    expect(txns.map((t) => t.amount)).toEqual([15.49, -200, 42.1]);
  });

  it('checking account: debits negative, payroll and deposits positive', async () => {
    const { txns } = await one('Date,Description,Amount\n01/02/2026,ACME CORP DES:PAYROLL ID:123,1880.15\n01/05/2026,NETFLIX.COM,-15.49\n01/09/2026,Zelle payment to Jane Smith,-50.00\n01/16/2026,ACME CORP DES:PAYROLL ID:123,1880.15\n01/20/2026,KROGER,-62.00\n');
    expect(txns.filter((t) => t.amount > 0).map((t) => t.description)).toEqual(['NETFLIX.COM', 'Zelle payment to Jane Smith', 'KROGER']);
    expect(txns.filter((t) => t.amount < 0)).toHaveLength(2);
  });

  it('"PAYMENT TO" on a checking account is a charge, not money in', async () => {
    const { txns } = await one('Date,Description,Amount\n01/02/2026,ONLINE PAYMENT TO COMCAST,-84.00\n01/03/2026,ONLINE PAYMENT TO VERIZON,-92.00\n01/09/2026,PAYROLL ACME,1880.15\n01/10/2026,KROGER,-62.00\n01/16/2026,DEPOSIT,1880.15\n');
    expect(txns.find((t) => /COMCAST/.test(t.description))!.amount).toBe(84);
  });

  it('with no credit keywords the majority sign is charges', async () => {
    const neg = await one('Date,Description,Amount\n01/02/2026,STORE A,-10.00\n01/03/2026,STORE B,-12.00\n01/04/2026,STORE C,5.00\n');
    expect(neg.txns.map((t) => t.amount)).toEqual([10, 12, -5]);
    const pos = await one('Date,Description,Amount\n01/02/2026,STORE A,10.00\n01/03/2026,STORE B,12.00\n01/04/2026,STORE C,-5.00\n');
    expect(pos.txns.map((t) => t.amount)).toEqual([10, 12, -5]);
  });

  it('separate Debit / Credit columns, whatever their signs (Capital One, Citi)', async () => {
    const capOne = await one('Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n2026-01-05,2026-01-06,4412,NETFLIX.COM,Entertainment,15.49,\n2026-01-10,2026-01-10,4412,CAPITAL ONE AUTOPAY PYMT,Payment/Credit,,200.00\n');
    expect(capOne.txns.map((t) => t.amount)).toEqual([15.49, -200]);
    const citi = await one('"Status","Date","Description","Debit","Credit"\n"Cleared","01/05/2026","NETFLIX.COM","15.49",""\n"Cleared","01/10/2026","ONLINE PAYMENT, THANK YOU","","-200.00"\n');
    expect(citi.txns.map((t) => t.amount)).toEqual([15.49, -200]);
  });

  it('Withdrawals / Deposits and Money out / Money in headings', async () => {
    const a = await one('Date,Description,Withdrawals,Deposits\n01/05/2026,NETFLIX,15.49,\n01/06/2026,PAYROLL,,1000.00\n');
    expect(a.txns.map((t) => t.amount)).toEqual([15.49, -1000]);
    const b = await one('Date,Description,Money out,Money in\n01/05/2026,NETFLIX,15.49,\n01/06/2026,PAYROLL,,1000.00\n');
    expect(b.txns.map((t) => t.amount)).toEqual([15.49, -1000]);
  });

  it('trailing CR / DR on amounts', async () => {
    const { txns } = await one('Date,Description,Amount\n01/05/2026,NETFLIX,15.49 DR\n01/06/2026,REFUND NETFLIX,15.49 CR\n');
    expect(txns.map((t) => t.amount)).toEqual([15.49, -15.49]);
  });

  it('parentheses negatives', async () => {
    const { txns } = await one('Date,Description,Amount\n01/05/2026,NETFLIX,(15.49)\n01/06/2026,KROGER,(30.00)\n01/07/2026,REFUND KROGER,5.00\n');
    expect(txns.map((t) => t.amount)).toEqual([15.49, 30, -5]);
  });
});

describe('date-order ambiguity', () => {
  it('reads DD/MM/YYYY when a first field exceeds 12, without a warning', async () => {
    const { txns, warnings } = await one('Date,Description,Amount\n03/02/2026,NETFLIX,-10.99\n15/02/2026,SPOTIFY,-11.99\n');
    expect(txns.map((t) => t.date)).toEqual(['2026-02-03', '2026-02-15']);
    expect(warnings).toEqual([]);
  });
  it('warns and assumes MM/DD/YYYY when nothing settles it', async () => {
    const { txns, warnings } = await one('Date,Description,Amount\n03/02/2026,NETFLIX,-10.99\n04/02/2026,SPOTIFY,-11.99\n');
    expect(txns.map((t) => t.date)).toEqual(['2026-03-02', '2026-04-02']);
    expect(warnings.join(' ')).toMatch(/DD\/MM\/YYYY or MM\/DD\/YYYY/);
    expect(warnings.join(' ')).toMatch(/assumed MM\/DD\/YYYY/);
  });
  it('treats DD.MM.YYYY as day-first with no warning', async () => {
    const { txns, warnings } = await one('Date;Description;Amount\n03.02.2026;NETFLIX;-10,99\n04.02.2026;SPOTIFY;-11,99\n');
    expect(txns.map((t) => t.date)).toEqual(['2026-02-03', '2026-02-04']);
    expect(warnings.filter((w) => /DD\/MM/.test(w))).toEqual([]);
  });
  it('UK Monzo export is read day-first', async () => {
    const { txns } = await one(readStatement('monzo.csv'), 'monzo.csv');
    expect(txns.every((t) => t.date >= '2025-11-01' && t.date <= '2026-10-31')).toBe(true);
  });
});

describe('warnings', () => {
  it('reports skipped rows with a count', async () => {
    const { txns, warnings } = await one('Date,Description,Amount\n01/05/2026,NETFLIX,-15.49\nnot a date,SPOTIFY,-11.99\n01/07/2026,KROGER,oops\n01/08/2026,STORE,-3.00\n');
    expect(txns).toHaveLength(2);
    expect(warnings.join(' ')).toMatch(/skipped 2 rows/);
  });
  it('reports a file whose columns cannot be identified', async () => {
    const { txns, warnings } = await one('foo,bar,baz\nx,y,z\nq,r,s\n', 'weird.csv');
    expect(txns).toEqual([]);
    expect(warnings.join(' ')).toMatch(/weird\.csv: could not find date and amount columns/);
  });
  it('reports an empty file', async () => {
    const { warnings } = await one('', 'empty.csv');
    expect(warnings.join(' ')).toMatch(/empty\.csv/);
  });
  it('warns about non-USD currencies', async () => {
    const { warnings } = await one(readStatement('monzo.csv'), 'monzo.csv');
    expect(warnings.join(' ')).toMatch(/GBP/);
  });
  it('never throws on garbage; the broken file becomes a warning', async () => {
    const r = await parseFiles([{ name: 'bin.csv', text: '\u0000\u0001\u0002' }, { name: 'ok.csv', text: 'Date,Description,Amount\n01/05/2026,NETFLIX,-15.49\n' }]);
    expect(r.txns).toHaveLength(1);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('OFX / QFX', () => {
  const sgml = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260105120000.000[-5:EST]
<TRNAMT>-15.49
<FITID>1
<NAME>NETFLIX.COM
<MEMO>NETFLIX.COM 866-579-7172 CA
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260106
<TRNAMT>1880.15
<FITID>2
<NAME>ACME PAYROLL
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;
  it('parses SGML-style OFX with negative TRNAMT as a charge', async () => {
    const { txns } = await one(sgml, 'a.qfx');
    expect(txns).toEqual([
      { date: '2026-01-05', description: 'NETFLIX.COM 866-579-7172 CA', amount: 15.49, source: 'a.qfx' },
      { date: '2026-01-06', description: 'ACME PAYROLL', amount: -1880.15, source: 'a.qfx' },
    ]);
  });
  it('parses XML-style OFX with entities', async () => {
    const xml = `<?xml version="1.0"?><OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260105</DTPOSTED><TRNAMT>-4.00</TRNAMT><FITID>1</FITID><NAME>AT&amp;T WIRELESS</NAME></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const { txns } = await one(xml, 'b.ofx');
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ date: '2026-01-05', amount: 4, description: 'AT&T WIRELESS' });
  });
  it('joins NAME and MEMO when they differ and keeps the longer one when MEMO extends NAME', async () => {
    const text = sgml.replace('<NAME>ACME PAYROLL', '<NAME>ACME PAYROLL\n<MEMO>DIRECT DEP 123');
    const { txns } = await one(text);
    expect(txns[1].description).toBe('ACME PAYROLL DIRECT DEP 123');
    expect(txns[0].description).toBe('NETFLIX.COM 866-579-7172 CA');
  });
  it('reads the generic.qfx fixture completely', async () => {
    const { txns, warnings } = await one(readStatement('generic.qfx'), 'generic.qfx');
    expect(warnings).toEqual([]);
    expect(txns.length).toBeGreaterThan(300);
    expect(txns.some((t) => t.amount < 0)).toBe(true);
  });
});

describe('multiple files', () => {
  it('drops exact duplicates across overlapping exports and says so', async () => {
    const a = 'Date,Description,Amount\n01/05/2026,NETFLIX.COM,-15.49\n02/05/2026,NETFLIX.COM,-15.49\n03/05/2026,NETFLIX.COM,-15.49\n';
    const b = 'Date,Description,Amount\n02/05/2026,NETFLIX.COM,-15.49\n03/05/2026,NETFLIX.COM,-15.49\n04/05/2026,NETFLIX.COM,-15.49\n';
    const { txns, warnings } = await parseFiles([{ name: 'a.csv', text: a }, { name: 'b.csv', text: b }]);
    expect(txns.map((t) => t.date)).toEqual(['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05']);
    expect(warnings.join(' ')).toMatch(/Dropped 2 duplicate rows/);
  });
  it('keeps two identical purchases made on the same day within ONE file', async () => {
    const a = 'Date,Description,Amount\n01/05/2026,COFFEE SHOP,-5.00\n01/05/2026,COFFEE SHOP,-5.00\n';
    const { txns } = await parseFiles([{ name: 'a.csv', text: a }]);
    expect(txns).toHaveLength(2);
    const both = await parseFiles([{ name: 'a.csv', text: a }, { name: 'a2.csv', text: a }]);
    expect(both.txns).toHaveLength(2); // the overlap is dropped, the genuine pair is kept
  });
  it('merges files in different formats and sorts by date', async () => {
    const csv = 'Date,Description,Amount\n03/05/2026,NETFLIX.COM,-15.49\n';
    const { txns } = await parseFiles([{ name: 'a.csv', text: csv }, { name: 'b.qfx', text: '<OFX><STMTTRN><DTPOSTED>20260101<TRNAMT>-5.00<NAME>COFFEE</STMTTRN></OFX>' }]);
    expect(txns.map((t) => t.date)).toEqual(['2026-01-01', '2026-03-05']);
    expect(txns.map((t) => t.source)).toEqual(['b.qfx', 'a.csv']);
  });
  it('overlapping slices of a real fixture merge back to the full statement', async () => {
    const full = readStatement('chase-credit.csv');
    const lines = full.trim().split('\n');
    const header = lines[0];
    const body = lines.slice(1);
    const cut = (from: string, to: string) => [header, ...body.filter((l) => { const [m, , y] = [l.slice(0, 2), l.slice(3, 5), l.slice(6, 10)]; const k = `${y}-${m}`; return k >= from && k <= to; })].join('\n');
    const first = cut('2025-10', '2026-06');
    const second = cut('2026-04', '2026-10');
    const merged = await parseFiles([{ name: 'first.csv', text: first }, { name: 'second.csv', text: second }]);
    const whole = await parseFiles([{ name: 'whole.csv', text: full }]);
    expect(merged.txns).toHaveLength(whole.txns.length);
    const key = (t: { date: string; amount: number; description: string }) => `${t.date}|${t.amount}|${t.description}`;
    expect(merged.txns.map(key).sort()).toEqual(whole.txns.map(key).sort());
  });
});
