// Holdout statement generator (deterministic). Run: node fixtures/holdout/gen-holdout.mjs
// Writes 4 statements + <name>.expected.json into fixtures/holdout/.
// Descriptors were written from general knowledge of how US statements print these merchants,
// WITHOUT reading the KB patterns/examples (only merchant names/ids were read).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

// ---------- tiny utils ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const D2 = (n) => String(n).padStart(2, '0');
const iso = (d) => d.toISOString().slice(0, 10);
const mdy = (d) => `${D2(d.getUTCMonth() + 1)}/${D2(d.getUTCDate())}/${d.getUTCFullYear()}`;
const md = (d) => `${D2(d.getUTCMonth() + 1)}/${D2(d.getUTCDate())}`;
const mmddyy = (d) => `${D2(d.getUTCMonth() + 1)}${D2(d.getUTCDate())}${String(d.getUTCFullYear()).slice(2)}`;
const yymmdd = (d) => `${String(d.getUTCFullYear()).slice(2)}${D2(d.getUTCMonth() + 1)}${D2(d.getUTCDate())}`;
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const isWeekend = (d) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
const cents = (x) => Math.round(x * 100) / 100;
const AL = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
const ref = (r, len) => Array.from({ length: len }, () => AL[Math.floor(r() * AL.length)]).join('');
const num = (r, len) => Array.from({ length: len }, (_, i) => String(i === 0 ? 1 + Math.floor(r() * 9) : Math.floor(r() * 10))).join('');
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const csvField = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csvLine = (arr) => arr.map(csvField).join(',');
function poisson(r, lam) { const L = Math.exp(-lam); let k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; }
function lognorm(r, lo, hi) { const t = Math.pow(r(), 1.7); return cents(lo + (hi - lo) * t); }

// ---------- window helpers ----------
function mkWin(y0, m0, months) {
  return { y0, m0, months, start: new Date(Date.UTC(y0, m0 - 1, 1)), end: new Date(Date.UTC(y0, m0 - 1 + months, 0)) };
}
function monthDate(win, idx, day) {
  const y = win.y0 + Math.floor((win.m0 - 1 + idx) / 12);
  const m = (win.m0 - 1 + idx) % 12;
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, dim)));
}

// ---------- series spec ----------
// S(id, label, merchantId|null, tokens[], core, opts)
function S(id, label, mid, tok, core, o = {}) {
  return { id, label, mid, tok, core, kind: 'recurring', every: 1, jitter: 0.06, ...o };
}
const CAD_DAYS = { weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, semiannual: 182, annual: 365 };
const cadOf = (s) => s.period === 7 ? 'weekly' : s.period === 14 ? 'biweekly' : ({ 1: 'monthly', 3: 'quarterly', 6: 'semiannual', 12: 'annual' })[s.every];

function amountFor(s, n, r) {
  let v;
  if (typeof s.amt === 'function') v = s.amt(n, r);
  else if (Array.isArray(s.amt)) { v = s.amt[0][1]; for (const [from, a] of s.amt) if (n >= from) v = a; }
  else v = s.amt;
  return cents(v);
}
function descFor(s, ctx) { return typeof s.core === 'function' ? s.core(ctx) : s.core; }

function expand(s, win, r) {
  const rows = [];
  const last = win.months - 1;
  if (s.period) {
    // weekly / biweekly by days from window start
    let d = addDays(win.start, s.startOffset ?? 0);
    const until = s.until ? new Date(s.until + 'T00:00:00Z') : win.end;
    let n = 0;
    while (d <= until && d <= win.end) {
      if (!(s.skip && r() < s.skip)) {
        rows.push({ date: d, n, amount: amountFor(s, n, r) });
        n++;
      }
      d = addDays(d, s.period);
    }
  } else {
    const from = s.from ?? 0, to = s.to ?? last;
    let k = 0;
    for (let idx = from; idx <= to && idx <= last; idx += s.every, k++) {
      let d = monthDate(win, idx, s.day);
      if (r() < s.jitter) d = addDays(d, r() < 0.5 ? -1 : 1);
      if (d > win.end) d = win.end;
      rows.push({ date: d, n: k, amount: amountFor(s, k, r) });
    }
  }
  const kept = s.dropIdx ? rows.filter((_, i) => !s.dropIdx.has(i)) : rows;
  return kept.map((x) => ({ ...x, core: descFor(s, { r, n: x.n, date: x.date }), series: s }));
}

// ---------- ACH helper for Chase-style long descriptors ----------
const ach = (name, entry, who = 'JORDAN LEE') => ({ r, date }) =>
  `ORIG CO NAME:${name} ORIG ID:${num(r, 10)} DESC DATE:${mmddyy(date)} CO ENTRY DESCR:${entry} SEC:WEB TRACE#:021000${num(r, 9)} EED:${yymmdd(date)} IND ID:${num(r, 8)} IND NAME:${who} TRN: ${num(r, 10)}TC`;

// ---------- noise ----------
const REST = ['TACOMBI', 'LUCALI PIZZA', 'SUSHI OF GARI', 'KATZS DELI', 'JOES PIZZA', 'BLUE RIBBON', 'SHAKE SHACK', 'PANERA BREAD', 'SWEETGREEN', 'DIG INN', 'CHICKFILA', 'PRET A MANGER'];
const CAFE = ['BLUE BOTTLE COFFEE', 'JOE COFFEE', 'GREGORYS COFFEE', 'LA COLOMBE', 'BIRCH COFFEE', 'SPROUT DELI'];
function noiseList(city, nyc) {
  const L = [
    { t: () => `TRADER JOE S #{n3} ${city}`, lo: 14, hi: 96, rate: 2.2 },
    { t: () => `WHOLEFDS MKT {n5} ${city}`, lo: 12, hi: 140, rate: 1.8 },
    { t: () => `ALDI {n5} ${city}`, lo: 25, hi: 110, rate: 1.0 },
    { t: () => `COSTCO WHSE #{n4} ${city}`, lo: 60, hi: 260, rate: 0.8 },
    { t: () => `TARGET        {n8} ${city}`, lo: 9, hi: 130, rate: 1.4 },
    { t: () => `STARBUCKS STORE {n5} ${city}`, lo: 4.2, hi: 9.8, rate: 4.5, fixed: 5.45, fixedP: 0.35 },
    { t: () => `DUNKIN #{n6} ${city}`, lo: 3.5, hi: 11, rate: 1.3 },
    { t: (r) => `SQ *${pick(r, CAFE)} ${city}`, lo: 4, hi: 14, rate: 1.5 },
    { t: () => `CHIPOTLE {n4} ${city}`, lo: 10, hi: 24, rate: 1.6 },
    { t: (r) => `TST* ${pick(r, REST)} ${city}`, lo: 12, hi: 85, rate: 2.2 },
    { t: (r) => `DOORDASH*${pick(r, REST)} DOORDASH.COM CA`, lo: 14, hi: 60, rate: 1.8 },
    { t: () => `SHELL OIL {n11} ${city}`, lo: 26, hi: 68, rate: nyc ? 0.3 : 1.6 },
    { t: () => `UBER   *TRIP HELP.UBER.COM CA`, lo: 8, hi: 46, rate: 2.6 },
    { t: () => `UBER   *EATS HELP.UBER.COM CA`, lo: 14, hi: 55, rate: 1.0 },
    { t: (r) => `LYFT   *RIDE ${pick(r, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])} ${1 + Math.floor(r() * 11)}${pick(r, ['AM', 'PM'])}`, lo: 9, hi: 38, rate: 0.9 },
    { t: () => `CVS/PHARMACY #{n5} ${city}`, lo: 3, hi: 48, rate: 1.0 },
    { t: () => `WALGREENS #{n4} ${city}`, lo: 4, hi: 40, rate: 0.6 },
    { t: () => `AMZN MKTP US*{ref9}`, lo: 6, hi: 120, rate: 3.2 },
    { t: () => `AMAZON.COM*{ref9} AMZN.COM/BILL WA`, lo: 8, hi: 90, rate: 1.4 },
    { t: () => `AMAZON RETAIL AMZN.COM/BILL WA`, lo: 8, hi: 70, rate: 0.5 },
    { t: () => `HOME DEPOT #{n4} ${city}`, lo: 12, hi: 220, rate: 0.5 },
    { t: () => `USPS PO {n10} ${city}`, lo: 4, hi: 30, rate: 0.5 },
    { t: () => `SP PLUS PARKING ${city}`, lo: 8, hi: 42, rate: 0.5 },
  ];
  if (nyc) {
    L.push({ t: () => `MTA*NYCT PAYGO NEW YORK NY`, lo: 2.9, hi: 2.9, rate: 6, fixed: 2.9, fixedP: 1 });
    L.push({ t: () => `CITI BIKE {n6} NEW YORK NY`, lo: 4.5, hi: 19, rate: 0.7 });
  }
  return L;
}
function fillTmpl(t, r) {
  return t
    .replace(/\{n(\d+)\}/g, (_, k) => num(r, +k))
    .replace(/\{ref(\d+)\}/g, (_, k) => ref(r, +k));
}
function genNoise(win, r, city, nyc, scale = 1) {
  const rows = [];
  const list = noiseList(city, nyc);
  for (let idx = 0; idx < win.months; idx++) {
    const dim = new Date(Date.UTC(win.y0 + Math.floor((win.m0 - 1 + idx) / 12), ((win.m0 - 1 + idx) % 12) + 1, 0)).getUTCDate();
    for (const v of list) {
      const k = poisson(r, v.rate * scale);
      for (let i = 0; i < k; i++) {
        const day = 1 + Math.floor(r() * dim);
        const date = monthDate(win, idx, day);
        if (date > win.end) continue;
        let amount = v.fixed && r() < v.fixedP ? v.fixed : lognorm(r, v.lo, v.hi);
        rows.push({ date, core: fillTmpl(v.t(r), r), amount, kind: 'card', noise: true });
      }
    }
  }
  return rows;
}
// one-off big tickets (> $400) and KB-lookalike names that are NOT subscriptions
function genOneOffs(win, r, city, items) {
  const rows = [];
  for (const it of items) {
    const k = it.count ?? 1;
    for (let i = 0; i < k; i++) {
      const idx = Math.floor(r() * win.months);
      const date = monthDate(win, idx, 1 + Math.floor(r() * 27));
      rows.push({ date, core: fillTmpl(typeof it.t === 'function' ? it.t(r) : it.t, r).replace('{c}', city), amount: lognorm(r, it.lo, it.hi), kind: 'card', noise: true });
    }
  }
  return rows;
}

// ---------- formatters ----------
const nextBiz = (d) => { let x = d; while (isWeekend(x)) x = addDays(x, 1); return x; };

function chaseDesc(row) {
  switch (row.kind) {
    case 'recurring': return `Recurring Card Purchase ${md(row.date)} ${row.core} Card 4567`;
    case 'card': return `Card Purchase ${md(row.date)} ${row.core} Card 4567`;
    case 'pin': return `Card Purchase With Pin ${md(row.date)} ${row.core} Card 4567`;
    default: return row.core;
  }
}

function writeChase(rows, win, r) {
  const out = rows.map((x) => {
    const post = nextBiz(r() < 0.35 ? addDays(x.date, 1) : x.date);
    return { ...x, post };
  }).sort((a, b) => a.post - b.post || a.date - b.date);
  let bal = 6200;
  const lines = [];
  for (const x of out) {
    const amt = -x.amount; // charge -> negative
    bal = cents(bal + amt);
    const type = x.type || (x.kind === 'recurring' || x.kind === 'card' || x.kind === 'pin' ? 'DEBIT_CARD' : 'ACH_DEBIT');
    const details = amt < 0 ? 'DEBIT' : 'CREDIT';
    lines.push({ post: x.post, txt: `${details},${mdy(x.post)},${csvField(chaseDesc(x))},${amt.toFixed(2)},${type},${bal.toFixed(2)},,` });
  }
  lines.reverse(); // Chase exports newest first
  return 'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #,\n' + lines.map((l) => l.txt).join('\n') + '\n';
}

function writeAmex(rows, win, r) {
  const out = rows.slice().sort((a, b) => a.date - b.date);
  const lines = ['Date,Receipt,Description,Card Member,Account #,Amount'];
  for (const x of out) {
    lines.push(csvLine([mdy(x.date), '', x.core, 'JAMIE R DIAZ', '-71005', x.amount.toFixed(2)]));
  }
  return lines.join('\n') + '\n';
}

const CAPONE_CAT = ['Merchandise', 'Dining', 'Entertainment', 'Internet', 'Other Travel', 'Health Care', 'Phone/Cable', 'Gas/Automotive', 'Other'];
function writeCapOne(rows, win, r) {
  const out = rows.slice().sort((a, b) => b.date - a.date);
  const lines = ['Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit'];
  for (const x of out) {
    const post = nextBiz(addDays(x.date, 1));
    const cat = x.cat || (x.amount < 0 ? 'Payment/Credit' : pick(r, CAPONE_CAT));
    lines.push(csvLine([iso(x.date), iso(post), '8814', x.core, cat, x.amount > 0 ? x.amount.toFixed(2) : '', x.amount < 0 ? (-x.amount).toFixed(2) : '']));
  }
  return lines.join('\n') + '\n';
}

const APPLE_CAT = ['Shopping', 'Entertainment', 'Restaurants', 'Services', 'Grocery', 'Transportation', 'Other', 'Health'];
function writeApple(rows, win, r) {
  const out = rows.slice().sort((a, b) => a.date - b.date);
  const lines = ['Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD),Purchased By'];
  for (const x of out) {
    const clr = nextBiz(addDays(x.date, 1 + (r() < 0.3 ? 1 : 0)));
    const type = x.type || (x.amount < 0 ? 'Credit' : 'Purchase');
    const merchant = x.merchant || x.core.split(/\s{1,}\d|\s[A-Z]{2}\s*(?:US|USA)?$/)[0].replace(/\*/g, ' ').split(' ').slice(0, 2).join(' ');
    lines.push(csvLine([mdy(x.date), mdy(clr), x.core, merchant, x.cat || pick(r, APPLE_CAT), type, x.amount.toFixed(2), 'Jordan Casey']));
  }
  return lines.join('\n') + '\n';
}

// ---------- truth ----------
function truthFor(s, rows, win) {
  const amounts = [...new Set(rows.map((x) => x.amount))].sort((a, b) => a - b);
  const sorted = rows.slice().sort((a, b) => a.date - b.date);
  const lastDate = sorted[sorted.length - 1].date;
  const cad = cadOf(s);
  const active = lastDate >= addDays(win.end, -1.5 * CAD_DAYS[cad]);
  const priceChanges = [];
  if (!s.variable) {
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1].amount, b = sorted[i].amount;
      if (Math.abs(b - a) / a > 0.02) priceChanges.push({ from: a, to: b });
    }
  }
  const maxAmt = Math.max(...rows.map((x) => x.amount));
  let detectable = true, reason = null;
  const isKb = s.mid != null || s.bundle;
  if (!isKb && s.variable) { detectable = false; reason = 'variable amount, non-KB (spec: variable only for KB telecom-utilities-finance)'; }
  else if (!isKb && rows.length < 3) { detectable = false; reason = 'non-KB with fewer than 3 charges'; }
  else if (!isKb && maxAmt > 400) { detectable = false; reason = 'non-KB single charge > $400 excluded by spec'; }
  return {
    id: s.id, label: s.label, merchantId: s.mid ?? null, match: s.tok, amounts: s.variable ? [] : amounts,
    cadence: cad, count: rows.length, firstSeen: iso(sorted[0].date), lastSeen: iso(lastDate),
    currentAmount: sorted[sorted.length - 1].amount, meanAmount: cents(rows.reduce((a, x) => a + x.amount, 0) / rows.length), active, priceChanges, variable: !!s.variable,
    ...(s.cands ? { candidatesInclude: s.cands } : {}),
    ...(s.accept ? { acceptable: s.accept } : {}),
    ...(s.bundle ? { bundle: true } : {}),
    ...(s.note ? { note: s.note } : {}),
    ...(s.mimic ? { mimic: true } : {}),
    ...(rows.length === 1 ? { singleCharge: true } : {}),
    detectable, ...(reason ? { undetectableReason: reason } : {}),
    sampleDescriptor: rows[0].core.slice(0, 140),
  };
}

// ---------- build one statement ----------
function build(cfg) {
  const r = rng(cfg.seed);
  const win = mkWin(...cfg.win);
  const all = [];
  const truth = [];
  const traps = [];
  const undetectable = [];
  for (const s of cfg.series) {
    const rows = expand(s, win, r).map((x) => ({ date: x.date, core: x.core, amount: x.amount, kind: s.kind, type: s.type, cat: s.cat, merchant: s.merchant, seriesId: s.id }));
    all.push(...rows);
    if (s.trap) traps.push({ id: s.id, label: s.label, match: s.tok, why: s.why || 'not a subscription', count: rows.length });
    else {
      const t = truthFor(s, rows, win);
      (t.detectable ? truth : undetectable).push(t);
    }
  }
  for (const e of cfg.events || []) {
    const idx = e.idx, d = monthDate(win, idx, e.day);
    all.push({ date: d, core: typeof e.core === 'function' ? e.core({ r, date: d }) : e.core, amount: e.amount, kind: e.kind || 'card', type: e.type, cat: e.cat, merchant: e.merchant, event: true });
  }
  all.push(...genNoise(win, r, cfg.city, !!cfg.nyc, cfg.noiseScale ?? 1));
  all.push(...genOneOffs(win, r, cfg.city, cfg.oneOffs || []));
  // payments for card statements: pay each month's charges the following month
  if (cfg.payments) {
    const byMonth = new Map();
    for (const x of all) { if (x.amount > 0) { const k = iso(x.date).slice(0, 7); byMonth.set(k, (byMonth.get(k) || 0) + x.amount); } }
    for (let idx = 0; idx < win.months - 1; idx++) {
      const d0 = monthDate(win, idx, 1);
      const k = iso(d0).slice(0, 7);
      const tot = byMonth.get(k) || 0;
      const d = monthDate(win, idx + 1, cfg.payments.day);
      all.push({ date: d, core: cfg.payments.core({ r, date: d }), amount: -cents(tot), kind: 'raw', type: cfg.payments.type, cat: cfg.payments.cat, merchant: cfg.payments.merchant, payment: true });
    }
  }
  const text = cfg.writer(all, win, r);
  const seen = new Set(); let dupes = 0;
  for (const x of all) { const k = iso(x.date) + '|' + x.core + '|' + x.amount; if (seen.has(k)) dupes++; else seen.add(k); }
  const dates = all.map((x) => x.date).sort((a, b) => a - b);
  const expected = {
    file: cfg.file,
    format: cfg.format,
    statementStart: iso(dates[0]),
    statementEnd: iso(dates[dates.length - 1]),
    rows: all.length,
    chargeRows: all.filter((x) => x.amount > 0).length,
    creditRows: all.filter((x) => x.amount < 0).length,
    // rows with Type=Installment (Apple Card financing): the parser leaves these out on purpose, with a warning
    installmentRows: all.filter((x) => x.type === 'Installment').length,
    dupeEstimate: dupes,
    series: truth,
    mustNotDetect: traps,
    undetectableByDesign: undetectable,
  };
  fs.writeFileSync(path.join(DIR, cfg.file), text);
  fs.writeFileSync(path.join(DIR, cfg.file.replace(/\.csv$/, '.expected.json')), JSON.stringify(expected, null, 2) + '\n');
  console.log(`${cfg.file}: ${all.length} rows, ${truth.length} expected series (${truth.filter((t) => t.merchantId).length} KB, ${truth.filter((t) => t.bundle).length} bundles, ${truth.filter((t) => !t.merchantId && !t.bundle).length} non-KB), ${traps.length} traps, ${undetectable.length} undetectable-by-design`);
}

// =====================================================================
// A. Chase checking (debit card + ACH + Zelle), NYC, Oct 2025 - Oct 2026 (13 mo)
// =====================================================================
const CH = (core, o) => ({ ...o, core });
const A = {
  file: 'chase-checking-holdout.csv', format: 'Chase checking (Details,Posting Date,...,Balance,Check or Slip #; debits negative, trailing comma)',
  seed: 20251001, win: [2025, 10, 13], city: 'NEW YORK NY', nyc: true, noiseScale: 0.8, writer: writeChase,
  series: [
    S('netflix', 'Netflix', 'netflix', ['NETFLIX'], 'NETFLIX.COM 866-579-7172 CA', { day: 14, amt: [[0, 15.49], [4, 17.99]] }),
    S('spotify-paypal', 'Spotify via PayPal', 'spotify', ['SPOTIFYUSA'], 'PAYPAL *SPOTIFYUSA 402-935-7733 CA', { day: 3, amt: [[0, 11.99], [9, 12.99]] }),
    S('hulu', 'Hulu (descriptor changes to HLU*HULU mid-statement)', 'hulu', ['HULU'], ({ n }) => (n < 5 ? 'HULU 877-8244858 CA' : 'HLU*HULU 877-8244858 CA'), { day: 22, amt: [[0, 17.99], [6, 18.99]] }),
    S('youtube-premium', 'YouTube Premium', 'youtube-premium', ['YOUTUBEPREMIUM'], 'GOOGLE *YOUTUBEPREMIUM g.co/helppay#CA', { day: 9, amt: 13.99 }),
    S('apple-299', 'App Store $2.99', null, ['APPLE.COM/BILL'], 'APPLE.COM/BILL 866-712-7753 CA', { day: 18, amt: 2.99, bundle: true, cands: ['icloud-plus'] }),
    S('apple-1099', 'App Store $10.99', null, ['APPLE.COM/BILL'], 'APPLE.COM/BILL 866-712-7753 CA', { day: 27, amt: 10.99, bundle: true, cands: ['apple-music'] }),
    S('chatgpt-plus', 'ChatGPT Plus', 'chatgpt-plus', ['CHATGPT'], 'OPENAI *CHATGPT SUBSCR SAN FRANCISCO CA', { day: 7, amt: 20.0 }),
    S('dropbox', 'Dropbox Plus', 'dropbox-plus', ['DROPBOX'], ({ r }) => `DROPBOX*${ref(r, 9)} DROPBOX.COM CA`, { day: 25, amt: 11.99 }),
    S('planet-fitness', 'Planet Fitness', 'planet-fitness', ['PLANET FIT'], 'PLANET FIT CLUB FEES', { day: 12, amt: 15.0 }),
    S('spectrum', 'Spectrum internet (ACH)', 'spectrum', ['SPECTRUM'], ach('CHARTER SPECTRUM', 'ONLINE PMT'), { day: 17, kind: 'raw', type: 'ACH_DEBIT', amt: (n) => (n < 6 ? 79.99 : 94.99), note: 'ACH descriptor names SPECTRUM inside a long ORIG CO NAME blob' }),
    S('verizon', 'Verizon Wireless (ACH)', 'verizon', ['VERIZON WIRELESS'], ach('VERIZON WIRELESS', 'PAYMENTREC'), { day: 24, kind: 'raw', type: 'ACH_DEBIT', variable: true, amt: (n, r) => cents(87.42 + pick(r, [0, 0, 0.75, 4.68, 0, 1.31])) }),
    S('geico', 'GEICO auto', 'geico', ['GEICO'], 'GEICO *AUTO 800-841-3000 DC', { day: 20, amt: [[0, 142.18], [6, 151.03]] }),
    S('nordvpn', 'NordVPN annual (renewal at higher price)', 'nordvpn', ['NORDVPN'], 'NORDVPN.COM PANAMA CITY PA', { day: 5, from: 0, to: 12, every: 12, amt: [[0, 59.88], [1, 71.88]] }),
    S('amazon-prime-annual', 'Amazon Prime (annual, single charge)', 'amazon-prime', ['AMAZON PRIME'], ({ r }) => `AMAZON PRIME*${ref(r, 9)} AMZN.COM/BILL WA`, { day: 9, from: 5, to: 5, every: 12, amt: 139.0 }),
    S('audible', 'Audible', 'audible', ['AUDIBLE'], ({ r }) => `AUDIBLE*${ref(r, 9)} NEWARK NJ`, { day: 11, amt: 14.95 }),
    S('google-one', 'Google One', 'google-one', ['GOOGLE ONE'], 'GOOGLE *Google One g.co/helppay#CA', { day: 16, amt: 2.99 }),
    S('duolingo', 'Duolingo (cancelled Jun 2026)', 'duolingo', ['DUOLINGO'], 'DUOLINGO PITTSBURGH PA', { day: 4, to: 8, amt: 12.99 }),
    S('canva-pro', 'Canva Pro', 'canva-pro', ['CANVA'], ({ r }) => `CANVA* I${num(r, 5)}-${num(r, 7)} SYDNEY AU`, { day: 28, amt: 15.0 }),
    S('lemonade', 'Lemonade renters', 'lemonade', ['LEMONADE'], 'LEMONADE INSURANCE 844-733-8666 NY', { day: 2, amt: [[0, 11.5], [6, 12.75]] }),
    S('ynab', 'YNAB (annual, single charge)', 'ynab', ['YNAB'], 'YNAB.COM SALT LAKE CITY UT', { day: 20, from: 3, to: 3, every: 12, amt: 109.0 }),
    S('paramount', 'Paramount+ (cancelled Apr 2026)', 'paramount-plus', ['PARAMOUNT'], 'PARAMOUNT+ 800-725-9002 NY', { day: 19, to: 6, amt: 11.99 }),
    S('1password', '1Password', '1password', ['1PASSWORD'], '1PASSWORD AGILEBITS TORONTO ON', { day: 6, amt: 3.99 }),
    // ---- non-KB recurring
    S('slack', 'Slack', null, ['SLACK'], 'SLACK T01H2JQ5RM9 SAN FRANCISCO CA', { day: 13, amt: 8.75 }),
    S('chewy', 'Chewy Autoship', null, ['CHEWY'], 'CHEWY.COM 800-672-4399 FL', { day: 21, amt: [[0, 48.62], [5, 49.87], [10, 51.14]] }),
    S('hims', 'Hims & Hers', null, ['HIMS'], 'HIMS & HERS HEALTH INC SAN FRANCISCO CA', { day: 23, from: 1, amt: 39.0 }),
    S('classpass', 'ClassPass (cancelled Aug 2026)', null, ['CLASSPASS'], 'CLASSPASS NEW YORK NY', { day: 10, to: 10, amt: 79.0 }),
    S('orkin', 'Orkin quarterly pest control', null, ['ORKIN'], 'ORKIN PEST CONTROL 404-888-2000 GA', { day: 15, from: 1, every: 3, amt: 119.0 }),
    S('stjude', 'St Jude monthly donation', null, ['ST JUDE'], 'ST JUDE CHILDRENS RESEARCH HOSP 901-578-9000 TN', { day: 5, amt: 25.0 }),
    S('parking', 'Monthly garage parking', null, ['IMPARK'], 'IMPARK 61234 NEW YORK NY', { day: 1, amt: 225.0 }),
    S('laundry', 'Wash and fold biweekly', null, ['SPOT ON LAUNDRY'], 'SPOT ON LAUNDRY WASH&FOLD NEW YORK NY', { period: 14, startOffset: 3, skip: 0.1, amt: 34.5, kind: 'card' }),
    S('tidal-wave', 'Tidal Wave Car Wash club (looks like TIDAL)', null, ['TIDAL WAVE'], 'TIDAL WAVE CAR WASH 0412 BROOKLYN NY', { day: 17, amt: 29.99, mimic: true }),
    // ---- undetectable by spec (informational)
    S('aaa', 'AAA membership (annual, non-KB single)', null, ['AAA NORTHEAST'], 'AAA NORTHEAST MEMBERSHIP 800-222-4357 NJ', { day: 12, from: 4, to: 4, every: 12, amt: 64.0 }),
    S('coned', 'Con Edison electric (variable, non-KB)', null, ['CON ED'], ach('CON ED OF NY', 'WEB PMTS'), { day: 14, kind: 'raw', type: 'ACH_DEBIT', variable: true, amt: (n, r) => lognorm(r, 78, 142) }),
    // ---- traps (must NOT be reported as subscriptions)
    S('t-amzn-monthly', 'Monthly Amazon marketplace purchase, same amount', null, ['AMZN MKTP'], ({ r }) => `AMZN Mktp US*${ref(r, 9)}`, { day: 8, amt: 14.99, kind: 'card', trap: true, why: 'Amazon marketplace purchases are not subscriptions (spec rule 3)' }),
    S('t-zelle-rent', 'Rent via Zelle', null, ['ZELLE PAYMENT TO GREENBRIAR'], ({ r }) => `Zelle payment to Greenbriar Property Mgmt JPM99${ref(r, 6)}`, { day: 1, amt: 1850.0, kind: 'raw', type: 'QUICKPAY_DEBIT', trap: true, why: 'rent / Zelle transfer' }),
    S('t-zelle-dog', 'Dog walker weekly via Zelle', null, ['ZELLE PAYMENT TO MARCUS'], ({ r }) => `Zelle payment to Marcus Webb JPM99${ref(r, 6)}`, { period: 7, startOffset: 2, amt: 40.0, kind: 'raw', type: 'QUICKPAY_DEBIT', trap: true, why: 'person-to-person Zelle' }),
    S('t-venmo', 'Venmo split of utilities, monthly', null, ['VENMO'], ach('VENMO', 'PAYMENT'), { day: 11, amt: 45.0, kind: 'raw', type: 'ACH_DEBIT', trap: true, why: 'person-to-person VENMO' }),
    S('t-ccpay', 'Chase card autopay', null, ['PAYMENT TO CHASE'], ({ r, date }) => `Payment to Chase card ending in 4567 ${md(date)}`, { day: 21, amt: (n, r) => lognorm(r, 1050, 1900), kind: 'raw', type: 'CREDIT_CARD_PAYMENT', trap: true, why: 'credit card payment' }),
    S('t-atm', 'ATM cash withdrawal monthly', null, ['ATM WITHDRAWAL'], ({ date }) => `ATM WITHDRAWAL ${md(date)} 1456 BROADWAY NEW YORK NY`, { day: 3, amt: 100.0, kind: 'raw', type: 'ATM', trap: true, why: 'ATM' }),
    S('t-atm-fee', 'Non-Chase ATM fee', null, ['ATM FEE'], 'NON-CHASE ATM FEE-WITH', { day: 3, amt: 3.0, kind: 'raw', type: 'FEE_TRANSACTION', trap: true, why: 'fee' }),
    S('t-svcfee', 'Monthly service fee', null, ['MONTHLY SERVICE FEE'], 'MONTHLY SERVICE FEE', { day: 28, amt: 15.0, kind: 'raw', type: 'FEE_TRANSACTION', trap: true, why: 'fee' }),
    S('t-loan', 'Student loan autopay', null, ['NELNET'], ach('NELNET', 'LOAN PMT'), { day: 25, amt: 312.4, kind: 'raw', type: 'LOAN_PMT', trap: true, why: 'loan payment' }),
    S('t-sav', 'Transfer to savings', null, ['TRANSFER TO SAV'], ({ r }) => `Online Transfer to SAV ...8821 transaction#: ${num(r, 11)}`, { day: 4, amt: 500.0, kind: 'raw', type: 'ACCT_XFER', trap: true, why: 'transfer' }),
    S('t-payroll', 'Payroll (money in)', null, ['PAYROLL'], ach('ACME ANALYTICS INC', 'PAYROLL'), { period: 14, startOffset: 2, amt: -2847.19, kind: 'raw', type: 'ACH_CREDIT', trap: true, why: 'payroll deposit, money in' }),
    S('t-interest', 'Interest credit', null, ['INTEREST PAYMENT'], 'INTEREST PAYMENT', { day: 30, amt: -0.12, kind: 'raw', type: 'MISC_CREDIT', trap: true, why: 'interest, money in' }),
  ],
  events: [
    // refund of one Hulu charge (Dec 2025)
    { idx: 2, day: 24, core: 'Card Purchase Return 12/24 HULU 877-8244858 CA Card 4567', amount: -17.99, kind: 'raw', type: 'DEBIT_CARD' },
    { idx: 5, day: 11, core: 'Card Purchase Return 03/11 AMZN Mktp US*2K4AB1CD0 Card 4567', amount: -38.2, kind: 'raw', type: 'DEBIT_CARD' },
  ],
  oneOffs: [
    { t: 'UNITED      0162348109876 HOUSTON TX', lo: 410, hi: 640, count: 2 },
    { t: 'AIRBNB * HM{ref8} SAN FRANCISCO CA', lo: 280, hi: 700, count: 2 },
    { t: 'BOX LUNCH SALADS {c}', lo: 11, hi: 17, count: 3 },
    { t: 'ZOOM HAIR STUDIO {c}', lo: 45, hi: 85, count: 3 },
    { t: 'BEAR CREEK COFFEE ROASTERS {c}', lo: 8, hi: 30, count: 2 },
    { t: 'CRAFT BEER MARKET {c}', lo: 18, hi: 60, count: 3 },
    { t: 'FREEDOM FORD SERVICE {c}', lo: 60, hi: 380, count: 1 },
    { t: 'OPTIMUM NUTRITION SHOP {c}', lo: 25, hi: 70, count: 2 },
    { t: 'TURBOTAX 800-446-8848 CA', lo: 60, hi: 90, count: 1 },
  ],
};

// =====================================================================
// B. Amex Gold (card), Sep 2025 - Oct 2026 (14 mo), Austin TX
// =====================================================================
const pad = (s, n = 33) => s.padEnd(n, ' ');
const B = {
  file: 'amex-holdout.csv', format: 'American Express (Date,Receipt,Description,Card Member,Account #,Amount; charges positive)',
  seed: 20250903, win: [2025, 9, 14], city: 'AUSTIN TX', nyc: false, noiseScale: 0.75, writer: writeAmex,
  payments: { day: 21, type: 'Payment', core: () => 'AUTOPAY PAYMENT - THANK YOU' },
  series: [
    S('adobe-cc', 'Adobe Creative Cloud', 'adobe-creative-cloud', ['ADOBE'], pad('ADOBE *CREATIVE CLOUD') + '408-536-6000 CA', { day: 6, amt: 59.99 }),
    S('microsoft-365', 'Microsoft 365 (annual, 2 charges)', 'microsoft-365', ['MICROSOFT'], 'MICROSOFT*MICROSOFT 365 MSBILL.INFO WA', { day: 12, from: 1, to: 13, every: 12, amt: 99.99 }),
    S('github-copilot', 'GitHub Copilot (descriptor is just GITHUB)', 'github-copilot', ['GITHUB'], 'GITHUB, INC. GITHUB.COM CA', { day: 15, amt: 10.0, accept: ['github-copilot', 'github-pro'], note: 'GitHub bills Copilot/Pro under one descriptor; either KB id is acceptable' }),
    S('cursor', 'Cursor', 'cursor', ['CURSOR'], pad('CURSOR, AI POWERED IDE') + 'NEW YORK NY', { day: 20, amt: 20.0 }),
    S('claude-pro', 'Claude Pro', 'claude-pro', ['CLAUDE.AI'], pad('CLAUDE.AI SUBSCRIPTION') + 'SAN FRANCISCO CA', { day: 24, amt: 20.0 }),
    S('perplexity', 'Perplexity Pro (cancelled Jun 2026)', 'perplexity-pro', ['PERPLEXITY'], pad('PERPLEXITY AI') + 'SAN FRANCISCO CA', { day: 2, to: 9, amt: 20.0 }),
    S('notion', 'Notion Plus', 'notion-plus', ['NOTION'], pad('NOTION LABS, INC.') + 'SAN FRANCISCO CA', { day: 8, amt: 12.0 }),
    S('zoom', 'Zoom Workplace Pro', 'zoom-workplace-pro', ['ZOOM.US'], pad('ZOOM.US') + '888-799-9666 CA', { day: 17, amt: 15.99 }),
    S('calendly', 'Calendly Standard', 'calendly-standard', ['CALENDLY'], pad('CALENDLY.COM') + 'ATLANTA GA', { day: 27, amt: 12.0 }),
    S('grammarly', 'Grammarly Premium (annual, 2 charges)', 'grammarly-pro', ['GRAMMARLY'], pad('GRAMMARLY') + 'SAN FRANCISCO CA', { day: 19, from: 0, to: 12, every: 12, amt: 144.0 }),
    S('nyt', 'NYT Digital (promo $4 -> $25)', 'nyt-digital', ['NYTIMES'], pad('NYTIMES*NYTIMES.COM') + '800-698-4637 NY', { day: 5, amt: [[0, 4.0], [5, 25.0]], note: 'intro price then full price; one subscription with a price change' }),
    S('wsj', 'Wall Street Journal', 'wall-street-journal', ['WALL STREET JOURNAL'], pad('WALL STREET JOURNAL') + '800-568-7625 NJ', { day: 9, amt: [[0, 39.99], [7, 44.0]] }),
    S('peloton', 'Peloton App', 'peloton-app', ['PELOTON'], pad('PELOTON MEMBERSHIP') + 'NEW YORK NY', { day: 14, amt: 12.99 }),
    S('headspace', 'Headspace (annual, single charge)', 'headspace', ['HEADSPACE'], pad('HEADSPACE INC.') + 'SANTA MONICA CA', { day: 3, from: 1, to: 1, every: 12, amt: 69.99 }),
    S('disney', 'Disney+ (DISNEYPLUS -> DISNEY PLUS mid-statement)', 'disney-plus', ['DISNEY'], ({ n }) => pad(n < 8 ? 'DISNEYPLUS' : 'DISNEY PLUS') + '888-905-7888 CA', { day: 12, amt: [[0, 13.99], [7, 15.99]] }),
    S('hbo-max', 'HBO Max', 'hbo-max', ['HBOMAX'], pad('HBOMAX.COM') + 'NEW YORK NY', { day: 26, amt: [[0, 16.99], [9, 18.49]] }),
    S('xfinity', 'Xfinity internet (variable)', 'xfinity', ['XFINITY'], pad('COMCAST XFINITY') + '800-266-2278 PA', { day: 23, variable: true, amt: (n, r) => cents(112.41 + (r() * 9 - 3)) }),
    S('t-mobile', 'T-Mobile wireless', 't-mobile', ['T-MOBILE'], pad('T-MOBILE*AUTO PAY') + 'BELLEVUE WA', { day: 28, variable: true, amt: (n, r) => cents(140 + pick(r, [0, 0, 0, 2.37, 0, 0, 5.1])) }),
    S('costco', 'Costco Executive membership (annual, 2 charges)', 'costco-membership', ['COSTCO'], pad('COSTCO MEMBERSHIP') + '800-774-2678 WA', { day: 5, from: 1, to: 13, every: 12, amt: 130.0 }),
    S('dashpass', 'DoorDash DashPass (bills on the 30th)', 'doordash-dashpass', ['DASHPASS'], pad('DOORDASH*DASHPASS') + 'SAN FRANCISCO CA', { day: 30, amt: 9.99 }),
    S('uber-one', 'Uber One (bills on the 31st)', 'uber-one', ['UBER *ONE'], pad('UBER   *ONE MEMBERSHIP') + 'HELP.UBER.COM CA', { day: 31, amt: 9.99 }),
    S('progressive', 'Progressive auto', 'progressive', ['PROGRESSIVE'], pad('PROGRESSIVE INSURANCE') + '800-776-4737 OH', { day: 11, amt: [[0, 168.4], [6, 181.25]] }),
    S('squarespace', 'Squarespace', 'squarespace', ['SQSP'], ({ r }) => pad(`SQSP* INV${num(r, 8)}`) + 'NEW YORK NY', { day: 3, amt: 16.0 }),
    S('digitalocean', 'DigitalOcean droplet', 'digitalocean', ['DIGITALOCEAN'], pad('DIGITALOCEAN.COM') + 'NEW YORK NY', { day: 1, amt: 24.0 }),
    // ---- non-KB recurring
    S('shopify', 'Shopify (changing invoice number)', null, ['SHOPIFY'], ({ r }) => pad(`SHOPIFY* ${num(r, 7)}`) + 'OTTAWA ON', { day: 7, amt: 39.0 }),
    S('quickbooks', 'QuickBooks Online', null, ['QBOOKS'], pad('INTUIT *QBooks Online') + 'CL.INTUIT.COM CA', { day: 16, amt: [[0, 35.0], [8, 38.0]] }),
    S('airtable', 'Airtable', null, ['AIRTABLE'], pad('AIRTABLE.COM') + 'SAN FRANCISCO CA', { day: 22, amt: 20.0 }),
    S('stamps', 'Stamps.com', null, ['STAMPS.COM'], pad('STAMPS.COM') + '888-434-0055 CA', { day: 13, amt: 19.99 }),
    S('webflow', 'Webflow', null, ['WEBFLOW'], pad('WEBFLOW.COM') + 'SAN FRANCISCO CA', { day: 25, from: 2, amt: 23.0 }),
    S('twitch', 'Twitch sub', null, ['TWITCH'], pad('TWITCH INTERACTIVE') + 'SAN FRANCISCO CA', { day: 18, amt: 4.99 }),
    S('cox-pest', 'Pest control quarterly (looks like Cox)', null, ['COX PEST'], pad('COX PEST CONTROL SERVICES') + 'AUSTIN TX', { day: 10, from: 0, every: 3, amt: 89.0, mimic: true }),
    S('robinhood', 'Robinhood Gold', null, ['ROBINHOOD'], pad('ROBINHOOD*GOLD') + 'MENLO PARK CA', { day: 29, from: 1, amt: 5.0 }),
    // ---- undetectable by design (informational)
    S('amex-fee', 'Amex annual fee (single)', null, ['ANNUAL MEMBERSHIP FEE'], pad('ANNUAL MEMBERSHIP FEE') + 'NEW YORK NY', { day: 14, from: 4, to: 4, every: 12, amt: 325.0 }),
    // ---- traps
    S('t-amazon-snsv', 'Amazon Subscribe & Save style monthly AMAZON.COM*', null, ['AMAZON.COM*'], ({ r }) => pad(`AMAZON.COM*${ref(r, 9)}`) + 'AMZN.COM/BILL WA', { day: 14, amt: 24.5, trap: true, why: 'AMAZON.COM* marketplace charge is not a KB Amazon subscription (spec rule 3)' }),
    S('t-freedom-mtg', 'Freedom Mortgage (looks like Freedom the app blocker)', null, ['FREEDOM MORTGAGE'], pad('FREEDOM MORTGAGE CORP') + '800-401-4000 IN', { day: 1, amt: 2150.0, trap: true, why: 'mortgage payment (> $400 and MORTGAGE keyword)' }),
    S('t-credit-ent', 'Monthly digital entertainment credit', null, ['DIGITAL ENTERTAINMENT CREDIT'], 'DIGITAL ENTERTAINMENT CREDIT', { day: 6, amt: -10.0, trap: true, why: 'statement credit, money in' }),
    S('t-dining-credit', 'Monthly dining credit', null, ['DINING CREDIT'], 'GRUBHUB DINING CREDIT', { day: 8, amt: -10.0, trap: true, why: 'statement credit, money in' }),
  ],
  events: [
    { idx: 6, day: 9, core: pad('WALL STREET JOURNAL') + '800-568-7625 NJ', amount: -39.99 },
    { idx: 10, day: 12, core: pad('UBER   *ONE MEMBERSHIP') + 'HELP.UBER.COM CA', amount: -9.99 },
  ],
  oneOffs: [
    { t: 'DELTA AIR LINES     0062348109876 ATLANTA GA', lo: 410, hi: 780, count: 3 },
    { t: 'MARRIOTT AUSTIN {c}', lo: 220, hi: 560, count: 2 },
    { t: 'LOOM & LEAF MATTRESS {c}', lo: 800, hi: 1400, count: 1 },
    { t: 'MEDIUM RARE STEAKHOUSE {c}', lo: 60, hi: 160, count: 3 },
    { t: 'DOODLE BAR {c}', lo: 22, hi: 70, count: 2 },
    { t: 'FIGMENT GALLERY GIFT SHOP {c}', lo: 15, hi: 80, count: 2 },
    { t: 'ZOOM HAIR STUDIO {c}', lo: 45, hi: 85, count: 4 },
  ],
};

// =====================================================================
// C. Capital One (split Debit/Credit columns), Nov 2025 - Oct 2026 (12 mo), Tucson AZ
// =====================================================================
const C = {
  file: 'capitalone-holdout.csv', format: 'Capital One (Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit; ISO dates)',
  seed: 20251101, win: [2025, 11, 12], city: 'TUCSON AZ', nyc: false, noiseScale: 0.85, writer: writeCapOne,
  payments: { day: 18, cat: 'Payment/Credit', core: () => 'CAPITAL ONE MOBILE PYMT' },
  series: [
    S('amazon-prime-monthly', 'Amazon Prime monthly', 'amazon-prime', ['AMAZON PRIME'], ({ r }) => `AMAZON PRIME*${ref(r, 9)} AMZN.COM/BILL WA`, { day: 12, amt: 14.99, cat: 'Merchandise' }),
    S('kindle-unlimited', 'Kindle Unlimited (cancelled Aug 2026)', 'kindle-unlimited', ['KINDLE UNLTD'], ({ r }) => `KINDLE UNLTD*${ref(r, 9)} AMZN.COM/BILL WA`, { day: 26, to: 9, amt: 11.99, cat: 'Entertainment' }),
    S('xbox', 'Xbox Game Pass (descriptor changes mid-statement)', 'xbox-game-pass', ['XBOX'], ({ n }) => (n < 6 ? 'MICROSOFT*XBOX GAME PASS 425-882-8080 WA' : 'XBOX GAME PASS ULTIMATE MSBILL.INFO WA'), { day: 9, amt: 29.99, cat: 'Entertainment' }),
    S('playstation', 'PlayStation Plus', 'playstation-plus', ['PLAYSTATION'], 'PLAYSTATION NETWORK 800-345-7669 CA', { day: 3, amt: 9.99, cat: 'Entertainment' }),
    S('discord', 'Discord Nitro', 'discord-nitro', ['DISCORD'], 'DISCORD* NITRO SAN FRANCISCO CA', { day: 21, amt: 9.99, cat: 'Entertainment' }),
    S('crunchyroll', 'Crunchyroll (cancelled Apr 2026)', 'crunchyroll', ['CRUNCHYROLL'], 'CRUNCHYROLL 877-278-6224 CA', { day: 6, to: 5, amt: 7.99, cat: 'Entertainment' }),
    S('youtube-tv', 'YouTube TV', 'youtube-tv', ['YOUTUBE TV'], 'GOOGLE *YOUTUBE TV g.co/helppay#CA', { day: 15, amt: [[0, 82.99], [6, 87.99]], cat: 'Entertainment' }),
    S('peacock-paypal', 'Peacock via PayPal', 'peacock', ['PEACOCK'], 'PAYPAL *PEACOCK 402-935-7733 CA', { day: 8, amt: [[0, 10.99], [4, 13.99]], cat: 'Entertainment' }),
    S('siriusxm', 'SiriusXM', 'siriusxm', ['SIRIUSXM'], 'SIRIUSXM.COM/ACCT 888-635-5144 NY', { day: 18, amt: 16.84, cat: 'Entertainment' }),
    S('mint-mobile', 'Mint Mobile 3-month plans', 'mint-mobile', ['MINT MOBILE'], 'MINT MOBILE 800-683-7392 CA', { day: 20, every: 3, amt: 45.0, cat: 'Phone/Cable' }),
    S('starlink', 'Starlink', 'starlink', ['STARLINK'], 'STARLINK INTERNET REDMOND WA', { day: 4, amt: 120.0, cat: 'Internet' }),
    S('crunch', 'Crunch Fitness', 'crunch-fitness', ['CRUNCH'], 'CRUNCH FITNESS 0481 TUCSON AZ', { day: 11, amt: 14.99, cat: 'Health Care' }),
    S('myfitnesspal', 'MyFitnessPal Premium (cancelled Mar 2026)', 'myfitnesspal-premium', ['MYFITNESSPAL'], 'MYFITNESSPAL INC SAN FRANCISCO CA', { day: 14, to: 4, amt: 19.99, cat: 'Health Care' }),
    S('whoop', 'WHOOP', 'whoop', ['WHOOP'], 'WHOOP INC BOSTON MA', { day: 24, amt: 30.0, cat: 'Health Care' }),
    S('life360', 'Life360 Gold', 'life360', ['LIFE360'], 'LIFE360 INC SAN FRANCISCO CA', { day: 2, amt: [[0, 14.99], [8, 15.99]], cat: 'Internet' }),
    S('backblaze', 'Backblaze', 'backblaze-personal', ['BACKBLAZE'], 'BACKBLAZE INC SAN MATEO CA', { day: 27, amt: 9.0, cat: 'Internet' }),
    S('ring', 'Ring Protect', 'ring-protect', ['RING PROTECT'], 'RING PROTECT PLAN SANTA MONICA CA', { day: 7, amt: [[0, 4.99], [3, 5.99]], cat: 'Internet' }),
    S('simplisafe', 'SimpliSafe monitoring', 'simplisafe', ['SIMPLISAFE'], 'SIMPLISAFE.COM 888-957-4675 MA', { day: 16, amt: 29.99, cat: 'Other' }),
    S('bitwarden', 'Bitwarden Premium (annual, single charge)', 'bitwarden-premium', ['BITWARDEN'], 'BITWARDEN INC SANTA BARBARA CA', { day: 5, from: 3, to: 3, every: 12, amt: 19.8, cat: 'Internet' }),
    S('medium', 'Medium', 'medium', ['MEDIUM MONTHLY'], 'MEDIUM MONTHLY SAN FRANCISCO CA', { day: 19, amt: 5.0, cat: 'Internet' }),
    S('linkedin', 'LinkedIn Premium (cancelled Jul 2026)', 'linkedin-premium', ['LINKEDIN'], ({ r }) => `LINKEDIN PRE*${num(r, 8)} SUNNYVALE CA`, { day: 13, to: 8, amt: 39.99, cat: 'Internet' }),
    S('masterclass', 'MasterClass (annual, single charge)', 'masterclass', ['MASTERCLASS'], 'MASTERCLASS.COM SAN FRANCISCO CA', { day: 22, from: 5, to: 5, every: 12, amt: 120.0, cat: 'Entertainment' }),
    S('patreon', 'Patreon pledge', 'patreon', ['PATREON'], 'PATREON* MEMBERSHIP INTERNET', { day: 1, amt: 5.0, cat: 'Entertainment' }),
    // ---- non-KB recurring
    S('nebula', 'Nebula', null, ['NEBULA'], 'NEBULA STREAMING NEBULA.TV', { day: 22, amt: 6.0, cat: 'Entertainment' }),
    S('mubi', 'MUBI', null, ['MUBI'], 'MUBI.COM LONDON GB', { day: 10, amt: 14.99, cat: 'Entertainment' }),
    S('trupanion', 'Trupanion pet insurance', null, ['TRUPANION'], 'TRUPANION INC 855-288-6252 SEATTLE WA', { day: 5, amt: [[0, 62.41], [7, 68.65]], cat: 'Other' }),
    S('carwash', 'Mister Car Wash club', null, ['MISTER CAR WASH'], 'MISTER CAR WASH #0891 TUCSON AZ', { day: 19, amt: 24.99, cat: 'Gas/Automotive' }),
    S('wikimedia', 'Wikimedia monthly donation', null, ['WIKIMEDIA'], 'WIKIMEDIA FOUNDATION SAN FRANCISCO CA', { day: 15, amt: 5.0, cat: 'Other' }),
    S('harrys', 'Harrys razors quarterly', null, ['HARRYS'], 'HARRYS INC NEW YORK NY', { day: 12, from: 1, every: 3, amt: 27.5, cat: 'Merchandise' }),
    S('cloudflare', 'Cloudflare Pro', null, ['CLOUDFLARE'], 'CLOUDFLARE SAN FRANCISCO CA', { day: 8, amt: 20.0, cat: 'Internet' }),
    S('coffee-club', 'Medium Roast coffee club (looks like Medium)', null, ['MEDIUM ROAST'], 'MEDIUM ROAST COFFEE CLUB LAKEWOOD OH', { day: 6, amt: 18.99, cat: 'Dining', mimic: true }),
    S('calm-spa', 'Calm Waters Spa membership (looks like Calm)', null, ['CALM WATERS'], 'CALM WATERS SPA MEMBERSHIP TUCSON AZ', { day: 28, amt: 65.0, cat: 'Health Care', mimic: true }),
    // ---- undetectable by design (informational)
    S('zipcar', 'Zipcar annual (non-KB single)', null, ['ZIPCAR'], 'ZIPCAR.COM CAMBRIDGE MA', { day: 14, from: 2, to: 2, every: 12, amt: 90.0, cat: 'Other Travel' }),
    // ---- traps
    S('t-amzn-monthly', 'Amazon.com* marketplace, same amount monthly', null, ['AMAZON.COM*'], ({ r }) => `Amazon.com*${ref(r, 9)}`, { day: 3, amt: 17.99, cat: 'Merchandise', trap: true, why: 'Amazon marketplace, not a subscription' }),
    S('t-rent', 'Rent through a portal', null, ['RENTCAFE'], 'RENTCAFE*AVALONBAY COMMUNITIES', { day: 1, amt: 2150.0, cat: 'Other', trap: true, why: 'rent, > $400' }),
    S('t-interest', 'Interest charge', null, ['INTEREST CHARGE'], 'PURCHASE INTEREST CHARGE', { day: 18, amt: (n, r) => cents(2 + r() * 14), cat: 'Other', trap: true, why: 'interest' }),
    S('t-venmo', 'PayPal person-to-person', null, ['PAYPAL *JESSEKIM'], 'PAYPAL *JESSEKIM 402-935-7733 CA', { day: 9, amt: 40.0, cat: 'Other', trap: true, why: 'person-to-person' }),
  ],
  events: [
    { idx: 7, day: 20, core: 'MEDIUM MONTHLY SAN FRANCISCO CA', amount: -5.0, cat: 'Payment/Credit' },
    { idx: 3, day: 10, core: 'AMZN Mktp US*7K1AB2CD3', amount: -23.4, cat: 'Payment/Credit' },
  ],
  oneOffs: [
    { t: 'SOUTHWEST     5262348109876 DALLAS TX', lo: 120, hi: 480, count: 3 },
    { t: 'AMZN Digital*{ref9} AMZN.COM/BILL WA', lo: 3.99, hi: 5.99, count: 7 },
    { t: 'TIDAL BASIN GIFT SHOP WASHINGTON DC', lo: 12, hi: 40, count: 2 },
    { t: 'CALM SEAS BOATING {c}', lo: 30, hi: 90, count: 2 },
    { t: 'FRONTIER AIR 4221810 DENVER CO', lo: 80, hi: 300, count: 2 },
    { t: 'MEDIUM ROAST COFFEE CO {c}', lo: 9, hi: 25, count: 2 },
  ],
};

// =====================================================================
// D. Apple Card, Oct 2025 - Oct 2026 (13 mo), Brooklyn NY
// =====================================================================
const AP = 'APPLE.COM/BILL ONE APPLE PARK WAY 866-712-7753 CA US';
const D = {
  file: 'apple-card-holdout.csv', format: 'Apple Card (Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD),Purchased By; MM/DD/YYYY)',
  seed: 20251002, win: [2025, 10, 13], city: 'BROOKLYN NY', nyc: true, noiseScale: 0.8, writer: writeApple,
  payments: { day: 20, type: 'Payment', cat: 'Payment', merchant: 'Payment', core: () => 'ACH Deposit Internet transfer from account ending in 6789' },
  series: [
    S('apple-099', 'App Store $1.08 (0.99 + tax)', null, ['APPLE.COM/BILL'], AP, { day: 3, amt: 1.08, bundle: true, note: 'iCloud+ 50GB $0.99 + NY sales tax', cands: ['icloud-plus'], merchant: 'Apple', cat: 'Services' }),
    S('apple-999', 'App Store $10.88 (9.99 + tax)', null, ['APPLE.COM/BILL'], AP, { day: 14, amt: 10.88, bundle: true, note: 'iCloud+ 2TB $9.99 + NY sales tax', cands: ['icloud-plus'], merchant: 'Apple', cat: 'Services' }),
    S('apple-1299', 'App Store $14.14 (12.99 + tax)', null, ['APPLE.COM/BILL'], AP, { day: 20, amt: 14.14, bundle: true, note: 'Apple TV $12.99 + NY sales tax', cands: ['apple-tv-plus'], merchant: 'Apple', cat: 'Services' }),
    S('apple-699', 'App Store $7.61 (6.99 + tax)', null, ['APPLE.COM/BILL'], AP, { day: 24, amt: 7.61, bundle: true, note: 'Apple Arcade $6.99 + NY sales tax', cands: ['apple-arcade'], merchant: 'Apple', cat: 'Services' }),
    S('spotify-duo', 'Spotify Duo (descriptor changes to Spotify P<ref> mid-statement)', 'spotify', ['SPOTIFY'], ({ r, n }) => (n < 6 ? 'SPOTIFY USA 877-7781161 NEW YORK NY US' : `SPOTIFY P${ref(r, 8)} STOCKHOLM SWE`), { day: 6, amt: [[0, 16.99], [9, 18.99]], merchant: 'Spotify', cat: 'Entertainment' }),
    S('midjourney', 'Midjourney', 'midjourney', ['MIDJOURNEY'], 'MIDJOURNEY INC. SAN FRANCISCO CA US', { day: 18, amt: 10.0, merchant: 'Midjourney', cat: 'Services' }),
    S('otter', 'Otter.ai (cancelled May 2026)', 'otter-ai', ['OTTER.AI'], 'OTTER.AI LOS ALTOS CA US', { day: 21, to: 7, amt: 16.99, merchant: 'Otter.ai', cat: 'Services' }),
    S('readwise', 'Readwise', 'readwise', ['READWISE'], 'READWISE.IO NEW YORK NY US', { day: 27, amt: 9.99, merchant: 'Readwise', cat: 'Services' }),
    S('babbel', 'Babbel (foreign descriptor)', 'babbel', ['BABBEL'], 'BABBEL.COM BERLIN DEU', { day: 8, amt: 14.95, merchant: 'Babbel', cat: 'Services' }),
    S('pandora', 'Pandora Plus', 'pandora', ['PANDORA'], 'PANDORA*SUBSCRIPTION 510-451-4100 CA US', { day: 12, amt: 10.99, merchant: 'Pandora', cat: 'Entertainment' }),
    S('starz', 'Starz (cancelled Mar 2026)', 'starz', ['STARZ'], 'STARZ ENTERTAINMENT ENGLEWOOD CO US', { day: 25, to: 5, amt: 10.99, merchant: 'Starz', cat: 'Entertainment' }),
    S('hellofresh', 'HelloFresh weekly box (skips weeks)', 'hellofresh', ['HELLOFRESH'], 'HELLOFRESH 646-846-3663 NEW YORK NY US', { period: 7, startOffset: 4, skip: 0.15, amt: [[0, 71.94], [24, 79.92]], merchant: 'HelloFresh', cat: 'Grocery', note: 'weekly with skipped weeks' }),
    S('ancestry', 'Ancestry (cancelled Feb 2026)', 'ancestry', ['ANCESTRY'], 'ANCESTRY.COM 800-262-3787 UT US', { day: 9, to: 4, amt: 24.99, merchant: 'Ancestry', cat: 'Services' }),
    S('adt', 'ADT monitoring', 'adt', ['ADT SECURITY'], 'ADT SECURITY SERVICES 800-238-2121 FL US', { day: 15, amt: [[0, 52.99], [8, 54.99]], merchant: 'ADT', cat: 'Services' }),
    S('norton', 'Norton 360 (annual, renewal triples)', 'norton-360', ['NORTON'], 'NORTON *360 DELUXE 650-527-8000 CA US', { day: 11, from: 0, to: 12, every: 12, amt: [[0, 49.99], [1, 119.99]], merchant: 'Norton', cat: 'Services' }),
    S('expressvpn', 'ExpressVPN (cancelled Jul 2026)', 'expressvpn', ['EXPRESSVPN'], 'EXPRESSVPN ROAD TOWN VGB', { day: 4, to: 9, amt: 12.95, merchant: 'ExpressVPN', cat: 'Services' }),
    S('google-workspace', 'Google Workspace (2 seats)', 'google-workspace', ['GSUITE'], 'GOOGLE *GSUITE_JDOEDESI g.co/helppay#CA US', { day: 1, amt: 16.8, merchant: 'Google', cat: 'Services' }),
    S('nest-aware', 'Google Nest Aware', 'google-nest-aware', ['NEST AWARE'], 'GOOGLE *NEST AWARE g.co/helppay#CA US', { day: 19, amt: 8.0, merchant: 'Google', cat: 'Services' }),
    S('att', 'AT&T wireless (variable)', 'att', ['ATT*BILL'], 'ATT*BILL PAYMENT 800-288-2020 TX US', { day: 22, variable: true, amt: (n, r) => cents(168.41 + pick(r, [0, 0, 3.12, 0, 7.8, 0])), merchant: 'AT&T', cat: 'Utilities' }),
    S('allstate', 'Allstate 6-month premium', 'allstate', ['ALLSTATE'], 'ALLSTATE INSURANCE 800-255-7828 IL US', { day: 10, from: 1, every: 6, amt: 742.0, merchant: 'Allstate', cat: 'Services' }),
    S('weightwatchers', 'WeightWatchers', 'weightwatchers', ['WEIGHT WATCHERS'], 'WEIGHT WATCHERS INTL 212-589-2700 NY US', { day: 16, amt: 23.0, merchant: 'WW', cat: 'Health' }),
    S('equinox', 'Equinox', 'equinox', ['EQUINOX'], 'EQUINOX FITNESS CLUBS NEW YORK NY US', { day: 2, amt: 285.0, merchant: 'Equinox', cat: 'Health' }),
    // ---- non-KB recurring
    S('fabletics', 'Fabletics VIP (skips some months)', null, ['FABLETICS'], 'FABLETICS 877-4333-8442 EL SEGUNDO CA US', { day: 9, amt: 49.95, dropIdx: new Set([2, 6, 9]), merchant: 'Fabletics', cat: 'Shopping' }),
    S('the-information', 'The Information', null, ['THE INFORMATION'], 'THE INFORMATION SAN FRANCISCO CA US', { day: 16, amt: 39.0, merchant: 'The Information', cat: 'Services' }),
    S('pure-barre', 'Pure Barre', null, ['PURE BARRE'], 'PURE BARRE UPPER WEST SIDE NEW YORK NY US', { day: 1, amt: 199.0, merchant: 'Pure Barre', cat: 'Health' }),
    S('tractive', 'Tractive GPS tracker', null, ['TRACTIVE'], 'TRACTIVE GMBH PISTOIA ITA', { day: 11, amt: 7.99, merchant: 'Tractive', cat: 'Services' }),
    S('freshbooks', 'FreshBooks', null, ['FRESHBOOKS'], 'FRESHBOOKS TORONTO ON CAN', { day: 5, amt: 21.0, merchant: 'FreshBooks', cat: 'Services' }),
    S('simplepractice', 'SimplePractice', null, ['SIMPLEPRACTICE'], 'SIMPLEPRACTICE.COM SAN FRANCISCO CA US', { day: 13, amt: 29.0, merchant: 'SimplePractice', cat: 'Services' }),
    S('liberty-mutual', 'Liberty Mutual', null, ['LIBERTY MUTUAL'], 'LIBERTY MUTUAL INSURANCE 800-290-8711 MA US', { day: 17, amt: 96.12, merchant: 'Liberty Mutual', cat: 'Services' }),
    S('nails', 'Fabulous Nails & Spa biweekly (looks like Fabulous)', null, ['FABULOUS NAILS'], 'FABULOUS NAILS & SPA BROOKLYN NY US', { period: 14, startOffset: 6, skip: 0.08, amt: 52.0, merchant: 'Fabulous Nails', cat: 'Health', mimic: true }),
    // ---- undetectable by design (informational)
    S('daycare', 'Daycare tuition (> $400, non-KB)', null, ['BRIGHT HORIZONS'], 'BRIGHT HORIZONS CHILDREN S BOSTON MA US', { day: 1, amt: 1240.0, merchant: 'Bright Horizons', cat: 'Services' }),
    // ---- traps
    S('t-installment', 'iPhone 0% monthly installment', null, ['APPLE CARD MONTHLY INSTALLMENTS'], 'APPLE CARD MONTHLY INSTALLMENTS IPHONE 17 PRO', { day: 26, amt: 41.62, to: 12, type: 'Installment', merchant: 'Apple', cat: 'Shopping', trap: true, why: 'Apple Card installment (a loan, not a subscription)' }),
    S('t-amzn', 'AMZN Mktp monthly same amount', null, ['AMZN MKTP'], ({ r }) => `AMZN MKTP US*${ref(r, 9)} AMZN.COM/BILL WA US`, { day: 7, amt: 29.99, merchant: 'Amazon', cat: 'Shopping', trap: true, why: 'marketplace purchase' }),
  ],
  events: [
    { idx: 4, day: 12, core: 'PANDORA*SUBSCRIPTION 510-451-4100 CA US', amount: -10.99, type: 'Credit', merchant: 'Pandora', cat: 'Entertainment' },
    { idx: 8, day: 3, core: 'AMZN MKTP US*3B7AB2CD1 AMZN.COM/BILL WA US', amount: -54.0, type: 'Credit', merchant: 'Amazon', cat: 'Shopping' },
  ],
  oneOffs: [
    { t: 'JETBLUE 2792348109876 LONG ISLAND CITY NY US', lo: 410, hi: 720, count: 2 },
    { t: 'BEAR CREEK CAFE {c} US', lo: 10, hi: 40, count: 3 },
    { t: 'BOXWOOD HARDWARE {c} US', lo: 10, hi: 60, count: 3 },
    { t: 'GAMMA RAY DISCO {c} US', lo: 20, hi: 80, count: 2 },
    { t: 'HINGE & BRACKET HARDWARE {c} US', lo: 8, hi: 45, count: 3 },
    { t: 'TIDAL WAVE LAUNDROMAT {c} US', lo: 10, hi: 30, count: 3 },
    { t: 'APPLE STORE R123 {c} US', lo: 29, hi: 250, count: 2 },
  ],
};
for (const cfg of [A, B, C, D]) build(cfg);
