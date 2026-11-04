// Shared helpers for the fixture generator: seeded PRNG, date math, ledger building, noise.
// Everything here is deterministic: the same seed always produces the same bytes.

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const round2 = (n) => Math.round(n * 100) / 100;
export const D0 = (s) => Math.floor(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5);
export const S0 = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = (n) => String(n).padStart(2, '0');

export function monthStep(dateStr, k, day) {
  const y = +dateStr.slice(0, 4), m = +dateStr.slice(5, 7);
  const total = y * 12 + (m - 1) + k;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(day, dim(ny, nm)))}`;
}
export const weekday = (s) => new Date(D0(s) * 864e5).getUTCDay();

export const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
export const between = (r, lo, hi) => lo + r() * (hi - lo);
export const int = (r, lo, hi) => Math.floor(between(r, lo, hi + 1));

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function ref(r, n) {
  let s = '';
  for (let i = 0; i < n; i++) s += ALNUM[Math.floor(r() * 36)];
  // guarantee a letter and two digits so it looks like a processor reference
  return s.length >= 4 ? `${pick(r, 'ABCDEFGHJKLMNPQRSTUVWXYZ')}${int(r, 1, 9)}${s.slice(2, n - 1)}${int(r, 1, 9)}` : s;
}
export function digits(r, n) {
  let s = String(int(r, 1, 9));
  for (let i = 1; i < n; i++) s += int(r, 0, 9);
  return s;
}
/** Replace {ref8} {ref9} {n7} {n10} ... placeholders. */
export function fill(tpl, r) {
  return tpl.replace(/\{ref(\d+)\}/g, (_, n) => ref(r, +n)).replace(/\{n(\d+)\}/g, (_, n) => digits(r, +n));
}

export const CADENCE_DAYS = { weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, semiannual: 182, annual: 365 };
const STEP_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

/**
 * Charges of a schedule inside [start, end].
 * sub: { cad, first, last?, amount, changes?: [[date, amount]], variable?: spread, skip?: [dates], jit?: bool,
 *        core, coreAlt?: [[fromDate, core]] }
 */
export function chargesOf(sub, start, end, r) {
  const out = [];
  const lastOk = sub.last && sub.last < end ? sub.last : end;
  const anchor = +sub.first.slice(8, 10);
  for (let i = 0; i < 500; i++) {
    let date;
    if (STEP_MONTHS[sub.cad]) date = monthStep(sub.first, i * STEP_MONTHS[sub.cad], anchor);
    else date = S0(D0(sub.first) + i * (sub.cad === 'weekly' ? 7 : 14));
    if (date > lastOk) break;
    if (sub.skip && sub.skip.includes(date)) continue;
    if (date < start) continue;
    let shifted = date;
    if (sub.jit && STEP_MONTHS[sub.cad] && r() < 0.25) shifted = S0(D0(date) + (r() < 0.5 ? 1 : 2));
    if (shifted > end) shifted = date;
    let amount = sub.amount;
    for (const [d, a] of sub.changes ?? []) if (date >= d) amount = a;
    if (sub.variable) amount = round2(amount * (1 + (r() * 2 - 1) * sub.variable));
    let core = sub.core;
    for (const [d, c] of sub.coreAlt ?? []) if (date >= d) core = c;
    out.push({ date: shifted, amount, core: fill(core, r) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Noise

const US_GROCERY = [
  ['WHOLEFDS MKT 10234 BOSTON MA', 'Whole Foods', 20, 160], ["TRADER JOE'S #552 CAMBRIDGE MA", 'Trader Joes', 18, 90],
  ['STOP & SHOP 0453 SOMERVILLE MA', 'Stop & Shop', 15, 140], ['KROGER #0345 COLUMBUS OH', 'Kroger', 15, 120], ['COSTCO WHSE #0123 BROOKLINE MA', 'Costco', 60, 260],
];
const US_GAS = [['SHELL OIL 57444212345 BOSTON MA', 'Shell', 28, 62], ['CHEVRON 0098123 QUINCY MA', 'Chevron', 30, 64], ['EXXONMOBIL 47281 NEWTON MA', 'Exxon', 25, 58]];
const US_FOOD = [
  ['SQ *BLUE BOTTLE COFFEE BOSTON MA', 'Blue Bottle', 4, 12], ['TST* TOASTY GRILL BOSTON MA', 'Toasty Grill', 14, 70], ['CHIPOTLE 1893 CAMBRIDGE MA', 'Chipotle', 10, 24],
  ["MCDONALD'S F27311 BOSTON MA", 'McDonalds', 6, 18], ['DOORDASH*SUSHI PALACE 855-973-1040 CA', 'DoorDash', 22, 68], ['PANERA BREAD #601 BOSTON MA', 'Panera', 9, 26],
  ['SQ *GREEN ST DELI SOMERVILLE MA', 'Green St Deli', 8, 22], ['DUNKIN #348120 Q35 BOSTON MA', 'Dunkin', 3, 11], ['PY *CORNER PIZZA MALDEN MA', 'Corner Pizza', 12, 40],
];
const US_ONEOFF = [
  ['THE HOME DEPOT #4123 BOSTON MA', 'Home Depot', 12, 240], ['BEST BUY 00001234 BOSTON MA', 'Best Buy', 20, 360], ['TARGET 00011234 BOSTON MA', 'Target', 10, 140],
  ['CVS/PHARMACY #08123 BOSTON MA', 'CVS', 6, 60], ['WALGREENS #12384 BOSTON MA', 'Walgreens', 5, 45], ['IKEA STOUGHTON MA', 'IKEA', 30, 320],
  ['LOWES #1234 BOSTON MA', 'Lowes', 10, 150], ['USPS PO 2503130119 BOSTON MA', 'USPS', 4, 30], ['PARKMOBILE 877-727-5897 GA', 'ParkMobile', 3, 18],
];
const UK = {
  groc: [['TESCO STORES 2417 LONDON GB', 'Tesco', 8, 90], ['SAINSBURYS S/MKTS 0451 LONDON GB', 'Sainsburys', 6, 80], ['CO-OP GROUP FOOD 1129 LONDON GB', 'Co-op', 3, 30]],
  food: [['PRET A MANGER 0412 LONDON GB', 'Pret A Manger', 3, 12], ['GREGGS PLC 1223 LONDON GB', 'Greggs', 2, 8], ['DELIVEROO LONDON GB', 'Deliveroo', 14, 45], ['COSTA COFFEE 8912 LONDON GB', 'Costa', 3, 7]],
  gas: [['TFL TRAVEL CHARGE TFL.GOV.UK/CP GB', 'TfL', 4, 22]],
  oneoff: [['BOOTS 1340 LONDON GB', 'Boots', 4, 40], ['IKEA LTD WEMBLEY GB', 'IKEA', 20, 220], ['ARGOS LTD 0381 LONDON GB', 'Argos', 10, 120]],
};
const EU = {
  groc: [['LIDL SAGT DANKE BERLIN DE', 'Lidl', 8, 70], ['EDEKA MARKT 4471 BERLIN DE', 'Edeka', 6, 60], ['REWE MARKT 1109 BERLIN DE', 'Rewe', 5, 55]],
  food: [['BAECKEREI HANSEN BERLIN DE', 'Baeckerei Hansen', 2, 9], ['CAFE EINSTEIN BERLIN DE', 'Cafe Einstein', 4, 16], ['LIEFERANDO BERLIN DE', 'Lieferando', 14, 38]],
  gas: [['BVG FAHRKARTEN BERLIN DE', 'BVG', 3, 12], ['ARAL TANKSTELLE 2210 BERLIN DE', 'Aral', 30, 70]],
  oneoff: [['DM DROGERIE MARKT 0412 BERLIN DE', 'dm', 5, 40], ['MEDIAMARKT 5521 BERLIN DE', 'MediaMarkt', 20, 200], ['ZALANDO SE BERLIN DE', 'Zalando', 25, 120]],
};

/**
 * Everyday spending. Returns ledger entries: { date, amt (+ charge / - credit), core, name, kind, cat }.
 * profile: per-month ranges and region.
 */
export function noise(r, start, end, p = {}) {
  const region = p.region ?? 'us';
  const pools =
    region === 'uk' ? { groc: UK.groc, gas: UK.gas, food: UK.food, oneoff: UK.oneoff } : region === 'eu' ? { groc: EU.groc, gas: EU.gas, food: EU.food, oneoff: EU.oneoff } : { groc: US_GROCERY, gas: US_GAS, food: US_FOOD, oneoff: US_ONEOFF };
  const rate = { groc: [5, 8], gas: [2, 4], food: [7, 12], oneoff: [2, 5], uber: [1, 4], amz: [3, 7], ...p.rate };
  const out = [];
  const days = D0(end) - D0(start) + 1;
  const months = days / 30.4;
  const add = (kind, list, cat) => {
    const n = Math.round(int(r, rate[kind][0], rate[kind][1]) * months);
    for (let i = 0; i < n; i++) {
      const [core, name, lo, hi] = pick(r, list);
      out.push({ date: S0(D0(start) + int(r, 0, days - 1)), amt: round2(between(r, lo, hi)), core: fill(core, r), name, kind: 'card', cat });
    }
  };
  add('groc', pools.groc, 'Groceries');
  add('gas', pools.gas, region === 'us' ? 'Gas' : 'Travel');
  add('food', pools.food, 'Food & Drink');
  add('oneoff', pools.oneoff, 'Shopping');
  const rides = Math.round(int(r, rate.uber[0], rate.uber[1]) * months);
  for (let i = 0; i < rides; i++) out.push({ date: S0(D0(start) + int(r, 0, days - 1)), amt: round2(between(r, 8, 48)), core: region === 'us' ? 'UBER *TRIP HELP.UBER.COM CA' : `UBER *TRIP HELP.UBER.COM ${region === 'uk' ? 'GB' : 'NL'}`, name: 'Uber', kind: 'card', cat: 'Travel' });
  const amz = Math.round(int(r, rate.amz[0], rate.amz[1]) * months);
  for (let i = 0; i < amz; i++) {
    const t = pick(r, region === 'us' ? ['AMZN MKTP US*{ref9}', 'AMAZON.COM*{ref9} AMZN.COM/BILL WA', 'AMZN MKTP US*{ref9} AMZN.COM/BILL WA'] : region === 'uk' ? ['AMAZON.CO.UK*{ref9} AMZN.CO.UK/PMTS GB', 'AMZNMKTPLACE*{ref9} AMZN.CO.UK GB'] : ['AMAZON EU SARL*{ref9} LUXEMBOURG LU', 'AMZN MKTP DE*{ref9} AMZN.COM/BILL LU']);
    out.push({ date: S0(D0(start) + int(r, 0, days - 1)), amt: round2(between(r, 6, 95)), core: fill(t, r), name: 'Amazon', kind: 'card', cat: 'Shopping' });
  }
  // a few refunds (money back to the card)
  const refunds = Math.max(1, Math.round(months / 3));
  for (let i = 0; i < refunds; i++) out.push({ date: S0(D0(start) + int(r, 5, days - 1)), amt: -round2(between(r, 9, 60)), core: fill(pick(r, ['AMAZON.COM*{ref9} AMZN.COM/BILL WA', 'TARGET 00011234 BOSTON MA', 'BEST BUY 00001234 BOSTON MA']), r), name: 'Refund', kind: 'refund', cat: 'Shopping' });
  return out;
}

/** A schedule that is NOT a subscription (rent, person-to-person, trap purchases): charges flow into the ledger only. */
export function trapEntries(r, trap, start, end) {
  return chargesOf(trap, start, end, r).map((c) => ({ date: c.date, amt: c.amount, core: c.core, name: trap.name ?? c.core, kind: trap.kind ?? 'card', cat: trap.cat ?? 'Shopping', achDescr: trap.achDescr }));
}

// ---------------------------------------------------------------------------------------------
// Expected-series computation

export function cadenceDaysOf(c) {
  return CADENCE_DAYS[c];
}

/** Candidate ids for an Apple/Google bundle charge (mirrors the engine rule, computed from the test KB). */
export function candidatesFor(kb, via, amount, cadence) {
  const cents = Math.round(amount * 100);
  const found = [];
  kb.forEach((m, index) => {
    if (m.match.billedVia !== via || !m.match.priceHints) return;
    let best = Infinity, cad = false;
    for (const h of m.match.priceHints) {
      const diff = Math.abs(cents - Math.round(h.amount * 100));
      if (diff <= 2) {
        best = Math.min(best, diff);
        if (h.cadence === cadence) cad = true;
      }
    }
    if (best !== Infinity) found.push({ id: m.id, best, cad, index });
  });
  found.sort((a, b) => Number(b.cad) - Number(a.cad) || a.best - b.best || a.index - b.index);
  return found.slice(0, 6).map((f) => f.id);
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function expectedEntry(sub, charges, statementEnd, kb) {
  const amounts = charges.map((c) => c.amount);
  const last = charges[charges.length - 1];
  const priceChanges = [];
  if (!sub.variable) {
    for (let i = 1; i < charges.length; i++) {
      if (Math.abs(amounts[i] - amounts[i - 1]) > amounts[i - 1] * 0.02) priceChanges.push({ from: amounts[i - 1], to: amounts[i] });
    }
  }
  const currentAmount = sub.variable ? round2(median(amounts.slice(-6))) : last.amount;
  const active = D0(last.date) >= D0(statementEnd) - 1.5 * CADENCE_DAYS[sub.cad];
  const e = {
    key: sub.mid ?? sub.id,
    displayName: sub.bundle === 'apple' ? `App Store subscription ($${currentAmount.toFixed(2)}/mo)` : sub.bundle === 'google' ? `Google Play subscription ($${currentAmount.toFixed(2)}/mo)` : sub.name,
    match: sub.match,
    merchantId: sub.mid ?? null,
    cadence: sub.cad,
    currentAmount,
    charges: charges.length,
    active,
  };
  if (sub.variable) e.variable = true;
  if (priceChanges.length) e.priceChanges = priceChanges;
  if (sub.bundle) e.candidates = candidatesFor(kb, sub.bundle, currentAmount, sub.cad);
  return { entry: e, active };
}
