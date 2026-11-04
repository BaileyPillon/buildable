// Bank-specific renderers. Each takes ledger entries (ascending by date) and returns the file text, mimicking
// that bank's real export: columns, sign convention, date format, descriptor style and quirks.
//
// Entry: { date 'YYYY-MM-DD', amt (+ money out, - money in), core, name, kind, cat, achDescr? }
import { D0, S0, digits, fill, int, pick, ref } from './lib.mjs';

const mdy = (s) => `${s.slice(5, 7)}/${s.slice(8, 10)}/${s.slice(0, 4)}`;
const dmy = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
const mmdd = (s) => `${s.slice(5, 7)}/${s.slice(8, 10)}`;
const mmdd4 = (s) => `${s.slice(5, 7)}${s.slice(8, 10)}`;
const yymmdd = (s) => `${s.slice(2, 4)}${s.slice(5, 7)}${s.slice(8, 10)}`;
const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
const f2 = (n) => n.toFixed(2);
const thousands = (n) => {
  const [i, d] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${d}`;
};
const desc = (arr) => [...arr].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
const plus = (s, n) => S0(D0(s) + n);

/** Checking-account style descriptors shared by the checking exports (card / ach / zelle ...). */
function checkingDesc(e, r, style) {
  switch (e.kind) {
    case 'rec':
      return style === 'chase' ? `Recurring Card Purchase ${mmdd(e.date)} ${e.core} Card 4412` : style === 'bofa' ? `CHECKCARD ${mmdd4(e.date)} ${e.core} ${digits(r, 23)}` : e.core;
    case 'card':
    case 'refund':
      if (e.kind === 'refund') return style === 'chase' ? `Card Credit ${mmdd(e.date)} ${e.core}` : style === 'bofa' ? `${e.core} REFUND` : e.core;
      return style === 'chase' ? `Card Purchase ${mmdd(e.date)} ${e.core} Card 4412` : style === 'bofa' ? `CHECKCARD ${mmdd4(e.date)} ${e.core} ${digits(r, 23)}` : e.core;
    case 'ach':
      return style === 'chase'
        ? `ORIG CO NAME:${e.core} ORIG ID:${digits(r, 10)} DESC DATE:${yymmdd(e.date)} CO ENTRY DESCR:${e.achDescr ?? 'BILLPAY'} SEC:WEB TRACE#:${digits(r, 15)} EED:${yymmdd(e.date)} IND ID:${digits(r, 9)} IND NAME:JANE DOE TRN: ${digits(r, 10)}TC`
        : `${e.core} DES:${e.achDescr ?? 'BILLPAY'} ID:${digits(r, 10)} INDN:JANE DOE CO ID:${digits(r, 10)} WEB`;
    case 'zelle':
      return style === 'chase' ? `Zelle payment to ${e.name} ${digits(r, 10)}` : `Zelle payment to ${e.name} Conf# ${ref(r, 9).toLowerCase()}`;
    case 'venmo':
      return `VENMO DES:PAYMENT ID:${digits(r, 10)} INDN:JANE DOE CO ID:1453681913 WEB`;
    case 'payroll':
      return `ACME CORP DES:PAYROLL ID:${digits(r, 9)} INDN:JANE DOE CO ID:${digits(r, 10)} PPD`;
    case 'cardpay':
      return style === 'chase' ? `Payment to Chase card ending in 4412 ${mmdd(e.date)}` : `CAPITAL ONE CRCARDPMT DES:CRCARDPMT ID:${digits(r, 10)} INDN:JANE DOE CO ID:${digits(r, 10)} WEB`;
    case 'atm':
      return `ATM WITHDRAWAL ${mmdd(e.date)} ${digits(r, 6)} MAIN ST BOSTON MA`;
    case 'interest':
      return 'Interest Earned';
    case 'fee':
      return e.core;
    case 'transfer':
      return `Online Banking transfer to SAV 1234 Confirmation# ${digits(r, 10)}`;
    case 'check':
      return `CHECK ${e.core}`;
    case 'rent':
      return style === 'chase' ? `Zelle payment to ${e.name} ${digits(r, 10)}` : `Zelle payment to ${e.name} Conf# ${ref(r, 9).toLowerCase()}`;
    default:
      return e.core;
  }
}

const CHASE_CAT = { Groceries: 'Groceries', Gas: 'Gas', 'Food & Drink': 'Food & Drink', Shopping: 'Shopping', Travel: 'Travel', Entertainment: 'Entertainment', Bills: 'Bills & Utilities', Health: 'Health & Wellness', Software: 'Professional Services' };

const row = (arr) => arr.map((v) => (/[",\n]/.test(String(v)) ? q(v) : String(v))).join(',');

export function chaseCredit(entries, r) {
  const rows = desc(entries).map((e) => {
    const credit = e.amt < 0;
    const type = e.kind === 'payment' ? 'Payment' : credit ? 'Return' : 'Sale';
    const d = e.kind === 'payment' ? 'Payment Thank You-Web' : e.core;
    // purchases negative, payments / returns positive
    return row([mdy(e.date), mdy(plus(e.date, int(r, 0, 2))), d, e.kind === 'payment' ? '' : CHASE_CAT[e.cat] ?? e.cat ?? 'Shopping', type, f2(-e.amt), '']);
  });
  return ['Transaction Date,Post Date,Description,Category,Type,Amount,Memo', ...rows].join('\n') + '\n';
}

export function chaseChecking(entries, r, opening = 3200) {
  const asc = [...entries];
  let bal = opening;
  const rows = asc.map((e) => {
    bal = Math.round((bal - e.amt) * 100) / 100;
    const credit = e.amt < 0;
    const type = { rec: 'DEBIT_CARD', card: 'DEBIT_CARD', refund: 'DEBIT_CARD', ach: 'ACH_DEBIT', zelle: 'QUICKPAY_DEBIT', rent: 'QUICKPAY_DEBIT', venmo: 'ACH_DEBIT', payroll: 'ACH_CREDIT', cardpay: 'ACCT_XFER', atm: 'ATM', interest: 'ACH_CREDIT', fee: 'FEE_TRANSACTION', transfer: 'ACCT_XFER', check: 'CHECK_PAID' }[e.kind] ?? 'MISC_DEBIT';
    return { date: e.date, text: `${credit ? 'CREDIT' : 'DEBIT'},${mdy(e.date)},${q(checkingDesc(e, r, 'chase'))},${f2(-e.amt)},${type},${f2(bal)},,` };
  });
  const out = rows.reverse().map((x) => x.text); // newest first, trailing comma on every row (real Chase quirk)
  return ['Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #,', ...out].join('\n') + '\n';
}

export function amex(entries, r) {
  const rows = [...entries].map((e) => {
    const d = e.kind === 'payment' ? 'ONLINE PAYMENT - THANK YOU' : e.kind === 'card' && r() < 0.2 ? `AplPay ${e.core}` : e.core;
    const padded = d.replace(/ (\d{3}-)/, '          $1'); // Amex pads descriptors with long runs of spaces
    return [mdy(e.date), `'${digits(r, 9)}'`, q(padded), 'JANE DOE', '-71009', f2(e.amt)].join(',');
  });
  return ['Date,Receipt,Description,Card Member,Account #,Amount', ...rows.reverse()].join('\n') + '\n';
}

export function bofaChecking(entries, r, opening = 2500) {
  const first = entries[0].date;
  let bal = opening;
  let credits = 0, debits = 0;
  const rows = entries.map((e) => {
    bal = Math.round((bal - e.amt) * 100) / 100;
    if (e.amt < 0) credits -= e.amt;
    else debits += e.amt;
    return `${mdy(e.date)},${q(checkingDesc(e, r, 'bofa'))},${q(thousands(-e.amt))},${q(thousands(bal))}`;
  });
  const end = entries[entries.length - 1].date;
  const lines = [
    'Description,,Summary Amt.',
    `Beginning balance as of ${mdy(first)},,${q(thousands(opening))}`,
    `Total credits,,${q(thousands(credits))}`,
    `Total debits,,${q(thousands(-debits))}`,
    `Ending balance as of ${mdy(end)},,${q(thousands(bal))}`,
    '',
    'Date,Description,Amount,Running Bal.',
    `${mdy(first)},${q(`Beginning balance as of ${mdy(first)}`)},,${q(thousands(opening))}`,
    ...rows,
  ];
  return lines.join('\n') + '\n';
}

export function capitalOne(entries, r) {
  const rows = [...entries].map((e) => {
    const credit = e.amt < 0;
    const d = e.kind === 'payment' ? 'CAPITAL ONE AUTOPAY PYMT' : e.core;
    return [e.date, plus(e.date, int(r, 0, 2)), '4412', q(d), e.kind === 'payment' ? 'Payment/Credit' : e.cat ?? 'Other', credit ? '' : f2(e.amt), credit ? f2(-e.amt) : ''].join(',');
  });
  return ['Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit', ...rows].join('\n') + '\n';
}

export function wellsFargo(entries, r) {
  const rows = desc(entries).map((e) => {
    let d;
    if (e.kind === 'rec') d = `RECURRING PAYMENT AUTHORIZED ON ${mmdd(e.date)} ${e.core} S${digits(r, 15)} CARD 1234`;
    else if (e.kind === 'card') d = `PURCHASE AUTHORIZED ON ${mmdd(e.date)} ${e.core} S${digits(r, 15)} CARD 1234`;
    else if (e.kind === 'refund') d = `PURCHASE RETURN AUTHORIZED ON ${mmdd(e.date)} ${e.core} S${digits(r, 15)} CARD 1234`;
    else if (e.kind === 'ach') d = `${e.core} ${e.achDescr ?? 'AUTOPAY'} ${digits(r, 12)} PPD ID: ${digits(r, 10)}`;
    else if (e.kind === 'zelle' || e.kind === 'rent') d = `ZELLE TO ${e.name} ON ${mmdd(e.date)} REF # PP${ref(r, 9)}`;
    else if (e.kind === 'check') d = `CHECK # ${e.core}`;
    else if (e.kind === 'payroll') d = `ACME CORP PAYROLL ${digits(r, 10)} DIRECT DEP`;
    else if (e.kind === 'transfer') d = `ONLINE TRANSFER TO SAVINGS ...${digits(r, 4)} REF #OP${ref(r, 9)}`;
    else if (e.kind === 'atm') d = `NON-WELLS FARGO ATM WITHDRAWAL AUTHORIZED ON ${mmdd(e.date)} BOSTON MA`;
    else if (e.kind === 'fee') d = e.core;
    else d = e.core;
    return [q(mdy(e.date)), q(f2(-e.amt)), q('*'), q(''), q(d)].join(',');
  });
  return rows.join('\n') + '\n';
}

export function citi(entries, r) {
  const rows = desc(entries).map((e) => {
    const credit = e.amt < 0;
    const d = e.kind === 'payment' ? 'ONLINE PAYMENT, THANK YOU' : e.core.replace(/ ([A-Z]{2})$/, '    $1');
    // Debit positive, Credit NEGATIVE (real Citi quirk)
    return [q('Cleared'), q(mdy(e.date)), q(d), q(credit ? '' : f2(e.amt)), q(credit ? f2(e.amt) : '')].join(',');
  });
  return ['"Status","Date","Description","Debit","Credit"', ...rows].join('\n') + '\n';
}

export function discover(entries, r) {
  const rows = desc(entries).map((e) => {
    const d = e.kind === 'payment' ? 'DIRECTPAY FULL BALANCE' : e.core;
    const cat = e.kind === 'payment' ? 'Payments and Credits' : e.kind === 'refund' ? 'Payments and Credits' : { Groceries: 'Supermarkets', Gas: 'Gasoline', 'Food & Drink': 'Restaurants', Shopping: 'Merchandise', Travel: 'Travel/Entertainment', Entertainment: 'Services', Bills: 'Services', Health: 'Medical Services', Software: 'Services' }[e.cat] ?? 'Services';
    return [mdy(e.date), mdy(plus(e.date, int(r, 0, 2))), q(d), f2(e.amt), q(cat)].join(',');
  });
  return ['Trans. Date,Post Date,Description,Amount,Category', ...rows].join('\n') + '\n';
}

export function appleCard(entries, r) {
  const rows = desc(entries).map((e) => {
    const credit = e.amt < 0;
    const isPay = e.kind === 'payment';
    const d = isPay ? `ACH Deposit Internet transfer from account ending in 1234` : `${e.core.replace(/\s+[A-Z]{2}$/, '')} US`;
    const type = isPay ? 'Payment' : credit ? 'Credit' : 'Purchase';
    return [mdy(e.date), mdy(plus(e.date, int(r, 1, 2))), q(d), q(isPay ? '' : e.name), isPay ? 'Payment' : e.cat === 'Food & Drink' ? 'Restaurants' : e.cat ?? 'Other', type, f2(e.amt), 'Jane Doe'].join(',');
  });
  return ['Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD),Purchased By', ...rows].join('\n') + '\n';
}

export function usBank(entries, r) {
  const rows = desc(entries).map((e) => {
    let d;
    if (e.kind === 'rec' || e.kind === 'card') d = `DEBIT PURCHASE -VISA ${e.core}`;
    else if (e.kind === 'refund') d = `CREDIT -VISA ${e.core}`;
    else if (e.kind === 'ach') d = `WEB AUTHORIZED PMT ${e.core}`;
    else if (e.kind === 'zelle' || e.kind === 'rent') d = `ZELLE PAYMENT TO ${e.name}`;
    else if (e.kind === 'payroll') d = 'ELECTRONIC DEPOSIT ACME CORP PAYROLL';
    else if (e.kind === 'atm') d = 'ATM WITHDRAWAL MAIN ST BOSTON MA';
    else if (e.kind === 'cardpay') d = 'WEB AUTHORIZED PMT CAPITAL ONE CRCARDPMT';
    else if (e.kind === 'fee') d = e.core;
    else d = e.core;
    return [q(e.date), q(e.amt < 0 ? 'CREDIT' : 'DEBIT'), q(d), q(digits(r, 12)), q(f2(-e.amt))].join(',');
  });
  return ['"Date","Transaction","Name","Memo","Amount"', ...rows].join('\n') + '\n';
}

export function monzo(entries, r) {
  let n = 0;
  const rows = entries.map((e) => {
    const credit = e.amt < 0;
    const type = e.kind === 'payroll' ? 'Faster payment' : e.kind === 'zelle' || e.kind === 'rent' ? 'Faster payment' : credit ? 'Refund' : 'Card payment';
    const name = e.kind === 'payroll' ? 'ACME LTD' : e.kind === 'rent' ? e.name : e.name;
    const cat = { Groceries: 'Groceries', Gas: 'Transport', 'Food & Drink': 'Eating out', Shopping: 'Shopping', Travel: 'Transport', Entertainment: 'Entertainment', Bills: 'Bills', Health: 'Health', Software: 'Bills' }[e.cat] ?? 'General';
    const tx = `tx_0000${ref(r, 18)}`;
    n++;
    return [tx, dmy(e.date), `${String(int(r, 7, 21)).padStart(2, '0')}:${String(int(r, 0, 59)).padStart(2, '0')}:${String(int(r, 0, 59)).padStart(2, '0')}`, type, q(name), '', cat, f2(-e.amt), 'GBP', f2(-e.amt), 'GBP', '', '', '', q(`${e.core}`), ''].join(',');
  });
  return ['Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Local amount,Local currency,Notes and #tags,Address,Receipt,Description,Category split', ...rows].join('\n') + '\n';
}

const eu = (n) => n.toFixed(2).replace('.', ',');
export function revolutEu(entries, r, opening = 1800) {
  let bal = opening;
  const rows = [];
  for (const e of entries) {
    const credit = e.amt < 0;
    bal = Math.round((bal - e.amt) * 100) / 100;
    const type = e.kind === 'payroll' || e.kind === 'topup' ? 'TOPUP' : e.kind === 'zelle' || e.kind === 'rent' || e.kind === 'transfer' ? 'TRANSFER' : credit ? 'REFUND' : 'CARD_PAYMENT';
    const d = e.kind === 'payroll' ? 'Payment from ACME GMBH' : e.kind === 'topup' ? 'Top-Up by *1234' : e.kind === 'rent' ? `Transfer to ${e.name}` : e.kind === 'zelle' ? `Transfer to ${e.name}` : e.sub ? e.core : e.name;
    const startMs = D0(e.date) * 864e5 + int(r, 7, 20) * 36e5 + int(r, 0, 59) * 6e4 + int(r, 0, 59) * 1e3;
    const ts = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
    const started = ts(startMs);
    const completed = ts(startMs + int(r, 1, 30) * 36e5);
    const state = e.reverted ? 'REVERTED' : 'COMPLETED';
    rows.push([type, 'Current', started, completed, d, eu(-e.amt), '0,00', 'EUR', state, eu(bal)].join(';'));
  }
  return ['Type;Product;Started Date;Completed Date;Description;Amount;Fee;Currency;State;Balance', ...rows].join('\n') + '\n';
}

export function qfx(entries, r) {
  const ofxDate = (s) => `${s.slice(0, 4)}${s.slice(5, 7)}${s.slice(8, 10)}120000.000[-5:EST]`;
  const first = entries[0].date, last = entries[entries.length - 1].date;
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const trn = entries.map((e) => {
    const name = esc(e.core).slice(0, 32).trim();
    const memo = esc(e.core);
    return [
      '<STMTTRN>',
      `<TRNTYPE>${e.amt < 0 ? 'CREDIT' : 'DEBIT'}`,
      `<DTPOSTED>${ofxDate(e.date)}`,
      `<TRNAMT>${f2(-e.amt)}`,
      `<FITID>${e.date.replace(/-/g, '')}${digits(r, 10)}`,
      `<NAME>${name}`,
      `<MEMO>${memo}`,
      '</STMTTRN>',
    ].join('\r\n');
  });
  return [
    'OFXHEADER:100',
    'DATA:OFXSGML',
    'VERSION:102',
    'SECURITY:NONE',
    'ENCODING:USASCII',
    'CHARSET:1252',
    'COMPRESSION:NONE',
    'OLDFILEUID:NONE',
    'NEWFILEUID:NONE',
    '',
    '<OFX>',
    '<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS>',
    `<DTSERVER>${ofxDate(last)}<LANGUAGE>ENG</SONRS></SIGNONMSGSRSV1>`,
    '<CREDITCARDMSGSRSV1><CCSTMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>',
    '<CCSTMTRS><CURDEF>USD',
    '<CCACCTFROM><ACCTID>4412000011112222</CCACCTFROM>',
    `<BANKTRANLIST><DTSTART>${ofxDate(first)}<DTEND>${ofxDate(last)}`,
    ...trn,
    '</BANKTRANLIST>',
    '<LEDGERBAL><BALAMT>-1234.56<DTASOF>' + ofxDate(last) + '</LEDGERBAL>',
    '</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>',
    '</OFX>',
    '',
  ].join('\r\n');
}

export { fill, pick };
