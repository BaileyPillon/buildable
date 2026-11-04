// Generates fixtures/statements/* (synthetic bank exports + .expected.json ground truth) and
// public/sample-statement.csv. Deterministic. Run from the repo root:  node fixtures/gen/generate.mjs
// The expected files come from the SCHEDULES defined here, never from running the engine.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  D0, S0, chargesOf, expectedEntry, int, monthStep, noise, pick, rng, round2, trapEntries, between, digits,
} from './lib.mjs';
import * as banks from './banks.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
// FIXTURE_SEED_OFFSET / FIXTURE_OUT let you generate alternative noise into a scratch folder for robustness runs.
const OFFSET = Number(process.env.FIXTURE_SEED_OFFSET ?? 0);
const OUT = process.env.FIXTURE_OUT ?? path.join(ROOT, 'fixtures', 'statements');
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'test-kb.json'), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------------------------
// Subscription catalog. mid = merchant id in fixtures/test-kb.json (null = not in the KB).
const CAT = {
  netflix: { name: 'Netflix', mid: 'netflix', match: 'NETFLIX', core: 'NETFLIX.COM 866-579-7172 CA', cad: 'monthly', amount: 15.49 },
  spotify: { name: 'Spotify', mid: 'spotify', match: 'SPOTIFY', core: 'SPOTIFY P{ref8}', cad: 'monthly', amount: 11.99 },
  hulu: { name: 'Hulu', mid: 'hulu', match: 'HULU', core: 'HULU 877-824-4858 CA', cad: 'monthly', amount: 9.99 },
  max: { name: 'Max', mid: 'max', match: 'MAX.COM', core: 'MAX.COM NEW YORK NY', cad: 'monthly', amount: 16.99 },
  disney: { name: 'Disney+', mid: 'disney-plus', match: 'DISNEY', core: 'DISNEY PLUS 888-905-7888 CA', cad: 'monthly', amount: 13.99 },
  paramount: { name: 'Paramount+', mid: 'paramount-plus', match: 'PARAMOUNT', core: 'PARAMOUNT+ 877-274-7228 NY', cad: 'monthly', amount: 7.99 },
  chatgpt: { name: 'ChatGPT Plus', mid: 'chatgpt-plus', match: 'CHATGPT', core: 'OPENAI *CHATGPT SUBSCR SAN FRANCISCO CA', cad: 'monthly', amount: 20 },
  claude: { name: 'Claude Pro', mid: 'claude-pro', match: 'CLAUDE', core: 'CLAUDE.AI SUBSCRIPTION ANTHROPIC.COM CA', cad: 'monthly', amount: 20 },
  grammarly: { name: 'Grammarly', mid: 'grammarly', match: 'GRAMMARLY', core: 'GRAMMARLY INC GRAMMARLY.COM CA', cad: 'annual', amount: 144 },
  otter: { name: 'Otter.ai', mid: 'otter-ai', match: 'OTTER', core: 'OTTER.AI MOUNTAIN VIEW CA', cad: 'monthly', amount: 16.99 },
  notion: { name: 'Notion', mid: 'notion', match: 'NOTION', core: 'NOTION LABS INC SAN FRANCISCO CA', cad: 'monthly', amount: 10 },
  todoist: { name: 'Todoist', mid: 'todoist', match: 'TODOIST', core: 'TODOIST DOIST.COM', cad: 'monthly', amount: 5 },
  calendly: { name: 'Calendly', mid: 'calendly', match: 'CALENDLY', core: 'CALENDLY ATLANTA GA', cad: 'monthly', amount: 10 },
  dropbox: { name: 'Dropbox', mid: 'dropbox', match: 'DROPBOX', core: 'DROPBOX DROPBOX.COM CA', cad: 'monthly', amount: 11.99 },
  ring: { name: 'Ring Protect', mid: 'ring-protect', match: 'RING', core: 'RING PROTECT PLAN RING.COM CA', cad: 'monthly', amount: 4.99 },
  nordvpn: { name: 'NordVPN', mid: 'nordvpn', match: 'NORDVPN', core: 'NORDVPN.COM NORDSEC', cad: 'monthly', amount: 12.99 },
  audible: { name: 'Audible', mid: 'audible', match: 'AUDIBLE', core: 'AUDIBLE*{ref9} AMZN.COM/BILL WA', cad: 'monthly', amount: 14.95 },
  prime: { name: 'Amazon Prime', mid: 'amazon-prime', match: 'AMAZON PRIME', core: 'AMAZON PRIME*{ref9} AMZN.COM/BILL WA', cad: 'monthly', amount: 14.99 },
  peloton: { name: 'Peloton App', mid: 'peloton-app', match: 'PELOTON', core: 'PELOTON MEMBERSHIP 866-679-9129 NY', cad: 'monthly', amount: 12.99 },
  mfp: { name: 'MyFitnessPal Premium', mid: 'myfitnesspal', match: 'MYFITNESSPAL', core: 'MYFITNESSPAL INC SAN FRANCISCO CA', cad: 'monthly', amount: 19.99 },
  huckleberry: { name: 'Huckleberry', mid: 'huckleberry', match: 'HUCKLEBERRY', core: 'HUCKLEBERRY LABS SAN FRANCISCO CA', cad: 'monthly', amount: 14.99 },
  headspace: { name: 'Headspace', mid: 'headspace', match: 'HEADSPACE', core: 'HEADSPACE INC SANTA MONICA CA', cad: 'monthly', amount: 12.99 },
  xfinity: { name: 'Xfinity', mid: 'xfinity', match: 'COMCAST', core: 'COMCAST CABLE COMM 800-COMCAST PA', cad: 'monthly', amount: 84, variable: 0.09, kind: 'ach', achDescr: 'CABLE PYMT' },
  verizon: { name: 'Verizon Wireless', mid: 'verizon', match: 'VZWRLSS', core: 'VZWRLSS*APOCC VISB 800-922-0204 NJ', cad: 'monthly', amount: 92.4, variable: 0.06, kind: 'ach', achDescr: 'AUTOPAY' },
  planet: { name: 'Planet Fitness', mid: 'planet-fitness', match: 'PLANET FITNESS', core: 'PLANET FITNESS MONTHLY FEE', cad: 'monthly', amount: 24.99 },
  nytimes: { name: 'The New York Times', mid: 'nytimes', match: 'NYTIMES', core: 'NYTIMES*NYTIMES.COM 800-698-4637 NY', cad: 'monthly', amount: 17 },
  linktree: { name: 'Linktree', mid: 'linktree', match: 'LINKTREE', core: 'LINKTREE LINKTR.EE', cad: 'monthly', amount: 5 },
  zapier: { name: 'Zapier', mid: 'zapier', match: 'ZAPIER', core: 'ZAPIER.COM SAN FRANCISCO CA', cad: 'monthly', amount: 29.99 },
  ynab: { name: 'YNAB', mid: 'ynab', match: 'YNAB', core: 'YNAB.COM SALT LAKE CITY UT', cad: 'monthly', amount: 14.99 },
  youtube: { name: 'YouTube Premium', mid: 'youtube-premium', match: 'YOUTUBE', core: 'GOOGLE *YouTubePremium g.co/helppay#', cad: 'monthly', amount: 13.99 },
  duolingo: { name: 'Duolingo Super', mid: 'duolingo', match: 'DUOLINGO', core: 'GOOGLE *DUOLINGO g.co/helppay#', cad: 'monthly', amount: 12.99 },
  calm: { name: 'Calm', mid: 'calm', match: 'CALM', core: 'GOOGLE *CALM g.co/helppay#', cad: 'annual', amount: 69.99 },
  hellofresh: { name: 'HelloFresh', mid: 'hellofresh', match: 'HELLOFRESH', core: 'HELLOFRESH.COM NEW YORK NY', cad: 'weekly', amount: 59.94 },
  apple: { name: 'App Store', mid: null, match: 'APPLE.COM/BILL', core: 'APPLE.COM/BILL 866-712-7753 CA', cad: 'monthly', amount: 9.99, bundle: 'apple' },
  lumosity: { name: 'Lumosity', mid: null, match: 'LUMOSITY', core: 'GOOGLE *LUMOSITY g.co/helppay#', cad: 'monthly', amount: 12.99, bundle: 'google' },
  // not in the KB: must come back as unrecognized series
  ironforge: { name: 'Iron Forge Fitness', mid: null, match: 'IRON FORGE', core: 'IRON FORGE FITNESS BOSTON MA', cad: 'monthly', amount: 39 },
  storage: { name: 'West Side Self Storage', mid: null, match: 'WEST SIDE', core: 'WEST SIDE SELF STORAGE 617-555-0188 MA', cad: 'monthly', amount: 129, kind: 'ach', achDescr: 'AUTOPAY' },
  bsc: { name: 'Boston Sports Club', mid: null, match: 'BOSTON SPORTS', core: 'BOSTON SPORTS CLUB 0412 BOSTON MA', cad: 'monthly', amount: 89 },
  crunch: { name: 'Crunch Fitness', mid: null, match: 'CRUNCH', core: 'CRUNCH FITNESS 4412 SOMERVILLE MA', cad: 'monthly', amount: 29.99 },
  anytime: { name: 'Anytime Fitness', mid: null, match: 'ANYTIME', core: 'ANYTIME FITNESS CAMBRIDGE MA', cad: 'monthly', amount: 45 },
};

const pad = (n) => String(n).padStart(2, '0');
const S = (id, day, over = {}) => ({ id, day, ...CAT[id], ...over });

function firstOn(start, day) {
  const base = `${start.slice(0, 8)}01`;
  const d = monthStep(base, 0, day);
  return d >= start ? d : monthStep(base, 1, day);
}

/** Non-subscription schedules (the traps). */
const T = (core, name, cad, day, amount, over = {}) => ({ core, name, cad, day, amount, ...over });

// ---------------------------------------------------------------------------------------------
// Build one fixture

function build(cfg) {
  const r = rng(cfg.seed + OFFSET);
  const { start, end } = cfg;
  const entries = [];
  const expected = { active: [], inactive: [] };
  const statementEnd0 = end;

  const subs = cfg.subs.map((s) => ({
    ...s,
    first: s.first ?? (s.cad === 'weekly' || s.cad === 'biweekly' ? start : firstOn(start, s.day)),
    kind: s.kind ?? 'rec',
    jit: s.jit ?? s.kind === 'ach',
  }));
  const charged = [];
  for (const s of subs) {
    const ch = chargesOf(s, start, end, r);
    if (!ch.length) throw new Error(`${cfg.file}: ${s.id} has no charges in range`);
    charged.push([s, ch]);
    for (const c of ch) {
      entries.push({ date: c.date, amt: c.amount, core: c.core, name: s.name, kind: s.kind, cat: s.cat ?? 'Entertainment', achDescr: s.achDescr, sub: s.id });
    }
  }
  for (const t of cfg.traps ?? []) {
    const first = t.first ?? (t.cad === 'weekly' ? start : firstOn(start, t.day));
    entries.push(...trapEntries(r, { ...t, first, jit: t.jit ?? false }, start, end));
  }
  entries.push(...noise(r, start, end, cfg.noise ?? {}).map((e) => ({ ...e, region: cfg.noise?.region })));
  // pin the statement end: the last day always has everyday spending on it
  entries.push({ date: end, amt: round2(between(r, 12, 40)), core: cfg.noise?.region === 'uk' ? 'TESCO STORES 2417 LONDON GB' : cfg.noise?.region === 'eu' ? 'REWE MARKT 1109 BERLIN DE' : 'TRADER JOE\'S #552 CAMBRIDGE MA', name: 'Grocer', kind: 'card', cat: 'Groceries' });
  entries.push(...(cfg.extra ? cfg.extra(r, start, end) : []));

  if (cfg.payments) {
    // monthly card payment equal to the previous month's net spend
    const byMonth = new Map();
    for (const e of entries) byMonth.set(e.date.slice(0, 7), (byMonth.get(e.date.slice(0, 7)) ?? 0) + e.amt);
    const months = [...byMonth.keys()].sort();
    for (const m of months.slice(0, -1)) {
      const next = monthStep(`${m}-01`, 1, 20);
      if (next <= end) entries.push({ date: next, amt: -round2(byMonth.get(m)), core: 'PAYMENT', name: 'Payment', kind: 'payment', cat: 'Payment' });
    }
  }

  // stable sort ascending by date
  const ledger = entries.map((e, i) => ({ e, i })).sort((a, b) => (a.e.date < b.e.date ? -1 : a.e.date > b.e.date ? 1 : a.i - b.i)).map((x) => x.e);
  const statementEnd = ledger[ledger.length - 1].date;
  const statementStart = ledger[0].date;
  if (statementEnd !== statementEnd0) throw new Error(`${cfg.file}: statement end drifted ${statementEnd} vs ${statementEnd0}`);

  for (const [s, ch] of charged) {
    const { entry, active } = expectedEntry(s, ch, statementEnd, KB);
    (active ? expected.active : expected.inactive).push(entry);
    if (s.cancelled && active) throw new Error(`${cfg.file}: ${s.id} was meant to be inactive`);
    if (!s.cancelled && !active) throw new Error(`${cfg.file}: ${s.id} unexpectedly inactive`);
  }

  const text = banks[cfg.bank](ledger, rng(cfg.seed + 1 + OFFSET), ...(cfg.bankArgs ?? []));
  fs.writeFileSync(path.join(OUT, cfg.file), text);
  const exp = { file: cfg.file, bank: cfg.bank, statementStart, statementEnd, rows: ledger.length, ...expected };
  if (cfg.note) exp.note = cfg.note;
  fs.writeFileSync(path.join(OUT, cfg.file.replace(/\.[a-z]+$/, '') + '.expected.json'), JSON.stringify(exp, null, 2) + '\n');
  console.log(`${cfg.file.padEnd(20)} ${String(ledger.length).padStart(4)} rows  ${expected.active.length} active + ${expected.inactive.length} inactive`);
  return { ledger, text };
}

const payroll = (first, amount = 3240.15) => T('ACME CORP PAYROLL', 'Acme Corp', 'biweekly', 0, -amount, { first, kind: 'payroll' });

// ---------------------------------------------------------------------------------------------
// Fixtures

// 1. Chase credit card: purchases negative; GOOGLE *, PAYPAL-free; APPLE.COM/BILL x2; annual single + pair; cancelled Paramount+
build({
  file: 'chase-credit.csv', bank: 'chaseCredit', seed: 1101, start: '2025-10-01', end: '2026-10-31', payments: true,
  subs: [
    S('netflix', 5, { changes: [['2026-04-05', 17.99]] }),
    S('spotify', 12, { changes: [['2026-08-12', 12.99]] }),
    S('hulu', 20),
    S('youtube', 3, { changes: [['2026-07-03', 15.99]] }),
    S('apple', 9),
    S('apple', 16, { amount: 0.99 }),
    S('audible', 22),
    S('chatgpt', 14),
    S('peloton', 27),
    S('paramount', 18, { last: '2026-05-18', cancelled: true }),
    S('prime', 23, { cad: 'annual', amount: 139, first: '2025-11-23' }),
    S('grammarly', 8, { first: '2025-10-08' }),
    S('ironforge', 1),
  ],
  traps: [
    T('AMZN MKTP US*{ref9}', 'Amazon', 'monthly', 11, 24.99, { jit: true }),           // same price each month: still not a subscription
    T('AMAZON.COM*{ref9} AMZN.COM/BILL WA', 'Amazon', 'monthly', 4, 12.99, { jit: true }),
  ],
  noise: { rate: { food: [8, 13] } },
});

// 2. Chase checking: ACH bills (ORIG CO NAME:), PayPal-processed subs, rent, Zelle/Venmo, payroll, ATM
build({
  file: 'chase-checking.csv', bank: 'chaseChecking', seed: 1102, start: '2025-11-01', end: '2026-10-31', bankArgs: [6200],
  subs: [
    S('xfinity', 14),
    S('verizon', 22),
    S('spotify', 8, { core: 'PAYPAL *SPOTIFYUSA 402-935-7733 CA', kind: 'card' }),
    S('zapier', 3, { core: 'PAYPAL *ZAPIER 402-935-7733 CA', kind: 'card' }),
    S('dropbox', 17),
    S('planet', 1, { kind: 'ach', achDescr: 'MONTHLY FEE' }),
    S('ring', 19, { changes: [['2026-06-19', 5.99]] }),
    S('nordvpn', 11, { cad: 'annual', amount: 59.88, first: '2025-12-11' }),
    S('notion', 28),
    S('storage', 5),
  ],
  traps: [
    T('', 'ACME PROPERTIES', 'monthly', 1, 1850, { kind: 'rent', first: '2025-11-01', core: 'RENT' }),
    T('', 'JANE SMITH', 'monthly', 15, 50, { kind: 'zelle', core: 'Z' }),
    T('', 'MARCUS LEE', 'monthly', 7, 25, { kind: 'venmo', core: 'V' }),
    T('', 'ACME CORP', 'biweekly', 0, -1880.15, { kind: 'payroll', first: '2025-11-07', core: 'P' }),
    T('', 'CHASE', 'monthly', 20, 410.32, { kind: 'cardpay', core: 'C', variable: 0.35 }),
    T('', 'ATM', 'monthly', 9, 100, { kind: 'atm', core: 'A' }),
  ],
  noise: { rate: { food: [6, 10] } },
});

// 3. Amex: positive = purchase; padded descriptors; weekly meal kit; Starbucks every Tuesday (not a subscription)
build({
  file: 'amex.csv', bank: 'amex', seed: 1103, start: '2025-12-01', end: '2026-10-31', payments: true,
  subs: [
    S('hellofresh', 0, { first: '2025-12-02', skip: ['2026-01-06', '2026-04-14', '2026-08-04'] }),
    S('notion', 11),
    S('otter', 7),
    S('todoist', 19, { last: '2026-06-19', cancelled: true }),
    S('calendly', 23, { changes: [['2026-07-23', 12]] }),
    S('disney', 25),
    S('max', 14, { changes: [['2026-06-14', 18.49]] }),
    S('nytimes', 2),
    S('mfp', 9),
    S('headspace', 28),
    S('bsc', 3),
  ],
  traps: [
    T('STARBUCKS STORE 12345 BOSTON MA', 'Starbucks', 'weekly', 0, 5.75, { first: '2025-12-02' }),
    T('AMAZON.COM*{ref9} AMZN.COM/BILL WA', 'Amazon', 'monthly', 17, 12.99, { jit: true }),
  ],
});

// 4. Bank of America checking: preamble block, thousands separators, CHECKCARD / DES: ACH text
build({
  file: 'bofa-checking.csv', bank: 'bofaChecking', seed: 1104, start: '2025-11-03', end: '2026-10-30', bankArgs: [5400],
  subs: [
    S('xfinity', 9),
    S('netflix', 4),
    S('chatgpt', 15),
    S('hulu', 21, { core: 'HULU 877-824-4858 CA', coreAlt: [['2026-03-21', 'HLU*HULU 877-824-4858 CA']], changes: [['2026-05-21', 11.99]] }),
    S('claude', 17),
    S('youtube', 6),
    S('lumosity', 12),
    S('peloton', 26, { amount: 24 }),
    S('ynab', 1, { cad: 'annual', amount: 109, first: '2025-12-01' }),
  ],
  traps: [
    T('', 'ACME PROPERTIES', 'monthly', 1, 1850, { kind: 'rent', first: '2025-11-03', core: 'RENT' }),
    T('', 'ACME CORP', 'biweekly', 0, -1880.15, { kind: 'payroll', first: '2025-11-07', core: 'P' }),
    T('MONTHLY MAINTENANCE FEE', 'Fee', 'monthly', 3, 12, { kind: 'fee' }),
    T('', 'SAV', 'monthly', 25, 200, { kind: 'transfer', core: 'T' }),
    T('', 'CAPITAL ONE', 'monthly', 13, 530.4, { kind: 'cardpay', core: 'C', variable: 0.3 }),
    T('Interest Earned', 'Interest', 'monthly', 30, -0.42, { kind: 'interest', variable: 0.2 }),
  ],
  noise: { rate: { food: [5, 9] } },
});

// 5. Capital One: separate Debit / Credit columns, ISO dates, Card No. column
build({
  file: 'capitalone.csv', bank: 'capitalOne', seed: 1105, start: '2026-01-01', end: '2026-10-31', payments: true,
  subs: [
    S('spotify', 13, { changes: [['2026-07-13', 12.99]] }),
    S('ring', 6),
    S('dropbox', 10),
    S('duolingo', 16),
    S('nordvpn', 2),
    S('apple', 21, { amount: 2.99 }),
    S('audible', 25),
    S('prime', 29),
    S('linktree', 13),
    S('paramount', 18, { last: '2026-06-18', cancelled: true }),
  ],
  traps: [
    T('SPOTIFY P{ref8}', 'Spotify refund', 'annual', 0, -11.99, { first: '2026-02-20', kind: 'refund', cat: 'Entertainment' }),
    T('AMZN MKTP US*{ref9}', 'Amazon', 'monthly', 8, 19.99, { jit: true }),
  ],
});

// 6. Wells Fargo: NO header row; date, amount, *, empty, description
build({
  file: 'wellsfargo.csv', bank: 'wellsFargo', seed: 1106, start: '2026-02-01', end: '2026-10-31',
  subs: [
    S('netflix', 7),
    S('spotify', 12),
    S('hulu', 18),
    S('max', 25),
    S('verizon', 9),
    S('xfinity', 16, { core: 'XFINITY MOBILE 800-XFINITY PA', amount: 45, variable: null, kind: 'ach', achDescr: 'AUTOPAY' }),
    S('planet', 1, { core: 'PLANET FITNESS 1234567 MEMBERSHIP', amount: 10 }),
    S('chatgpt', 3),
    S('calendly', 21),
  ],
  traps: [
    T('', 'LANDLORD', 'monthly', 1, 1650, { kind: 'rent', first: '2026-02-01', core: 'RENT' }),
    T('', 'ACME CORP', 'biweekly', 0, -1425.6, { kind: 'payroll', first: '2026-02-06', core: 'P' }),
    T('', 'JANE SMITH', 'monthly', 10, 40, { kind: 'zelle', core: 'Z' }),
    T('', 'SAVINGS', 'monthly', 28, 150, { kind: 'transfer', core: 'T' }),
  ],
});

// 7. Citi: Debit positive, Credit NEGATIVE; annual single; price rise on NYT
build({
  file: 'citi.csv', bank: 'citi', seed: 1107, start: '2026-02-01', end: '2026-10-31', payments: true,
  subs: [
    S('disney', 5),
    S('grammarly', 14, { cad: 'monthly', amount: 30 }),
    S('huckleberry', 22),
    S('mfp', 11, { cad: 'annual', amount: 79.99, first: '2026-03-11' }),
    S('audible', 17),
    S('nytimes', 9, { changes: [['2026-07-09', 25]] }),
    S('zapier', 27, { amount: 19.99 }),
    S('apple', 2, { amount: 10.99 }),
    S('apple', 15, { amount: 2.99 }),
  ],
  traps: [
    T('LYFT *RIDE SUN 8AM LYFT.COM CA', 'Lyft', 'monthly', 12, 18.75, { variable: 0.5 }),
  ],
});

// 8. Discover: purchases positive; Google-billed Calm (annual single); App Store with NO known candidate
build({
  file: 'discover.csv', bank: 'discover', seed: 1108, start: '2026-01-01', end: '2026-10-31', payments: true,
  subs: [
    S('netflix', 4, { amount: 22.99 }),
    S('peloton', 19),
    S('otter', 12),
    S('notion', 26),
    S('calm', 14, { first: '2026-03-14' }),
    S('youtube', 8),
    S('apple', 23, { amount: 4.99 }),
    S('dropbox', 30, { cad: 'annual', amount: 119.88, first: '2026-03-30' }),
    S('xfinity', 15, { core: 'COMCAST XFINITY', kind: 'rec', variable: 0.07, amount: 79.99 }),
    S('anytime', 1),
  ],
  traps: [
    T('GOOGLE *TEMPORARY HOLD', 'Google hold', 'monthly', 20, 1.0, { first: '2026-04-20', last: '2026-04-20' }),
  ],
});

// 9. Apple Card: Description + Merchant columns, purchases positive, payments negative
build({
  file: 'apple-card.csv', bank: 'appleCard', seed: 1109, start: '2026-03-01', end: '2026-10-31', payments: true,
  subs: [
    S('apple', 9),
    S('apple', 16, { amount: 0.99 }),
    S('spotify', 20, { amount: 19.99 }),
    S('netflix', 4, { amount: 17.99 }),
    S('hulu', 13, { amount: 18.99 }),
    S('chatgpt', 25),
    S('claude', 28),
    S('max', 6),
    S('crunch', 1),
  ],
  noise: { rate: { amz: [2, 5] } },
});

// 10. U.S. Bank: ISO dates, Transaction + Name + Memo columns, WEB AUTHORIZED PMT / DEBIT PURCHASE -VISA
build({
  file: 'usbank.csv', bank: 'usBank', seed: 1110, start: '2026-01-01', end: '2026-10-31',
  subs: [
    S('xfinity', 13),
    S('spotify', 7),
    S('netflix', 22),
    S('nytimes', 3),
    S('linktree', 17, { amount: 12 }),
    S('todoist', 10),
    S('ynab', 29),
    S('prime', 16, { cad: 'annual', amount: 139, first: '2026-01-16' }),
    S('calendly', 24),
    S('verizon', 5),
  ],
  traps: [
    T('', 'LANDLORD', 'monthly', 1, 1725, { kind: 'rent', first: '2026-01-01', core: 'RENT' }),
    T('', 'ACME CORP', 'biweekly', 0, -1490.5, { kind: 'payroll', first: '2026-01-02', core: 'P' }),
    T('', 'CAPITAL ONE', 'monthly', 18, 612.77, { kind: 'cardpay', core: 'C', variable: 0.3 }),
  ],
});

// 11. Monzo (UK): GBP, DD/MM/YYYY, Name + Description columns
build({
  file: 'monzo.csv', bank: 'monzo', seed: 1111, start: '2025-11-01', end: '2026-10-31',
  subs: [
    S('netflix', 6, { amount: 10.99, changes: [['2026-05-06', 12.99]], core: 'NETFLIX.COM' }),
    S('spotify', 14, { core: 'SPOTIFY' }),
    S('disney', 24, { amount: 7.99, core: 'DISNEY PLUS' }),
    S('prime', 19, { amount: 8.99, core: 'AMAZON PRIME*{ref9}' }),
    S('chatgpt', 9, { amount: 15.8, core: 'OPENAI *CHATGPT SUBSCR' }),
    S('claude', 27, { amount: 17, core: 'CLAUDE.AI SUBSCRIPTION' }),
    S('youtube', 3, { amount: 12.99, core: 'GOOGLE *YouTubePremium' }),
    S('audible', 21, { amount: 7.99 }),
    S('todoist', 4, { amount: 4.5, core: 'TODOIST' }),
    { id: 'puregym', name: 'PureGym', mid: null, match: 'PURE GYM', core: 'PURE GYM LTD LONDON GB', cad: 'monthly', amount: 24.99, day: 1 },
  ],
  traps: [
    T('', 'LANDLORD JONES', 'monthly', 1, 1100, { kind: 'rent', first: '2025-11-01', core: 'RENT' }),
    T('', 'ACME LTD', 'monthly', 28, -2050, { kind: 'payroll', first: '2025-11-28', core: 'P' }),
    T('THAMES WATER 8821 LONDON GB', 'Thames Water', 'monthly', 12, 38, { variable: 0.25 }),
  ],
  noise: { region: 'uk' },
});

// 12. Revolut (EU): semicolon, decimal comma, EUR, ISO timestamps, REVERTED rows
build({
  file: 'revolut-eu.csv', bank: 'revolutEu', seed: 1112, start: '2025-11-01', end: '2026-10-31', bankArgs: [1800],
  subs: [
    S('netflix', 5, { amount: 13.99, changes: [['2026-06-05', 15.99]], core: 'Netflix' }),
    S('spotify', 12, { amount: 10.99, core: 'Spotify' }),
    S('chatgpt', 18, { amount: 22, core: 'OpenAI ChatGPT Subscription' }),
    S('notion', 26, { core: 'Notion Labs' }),
    S('dropbox', 7, { core: 'Dropbox' }),
    S('disney', 21, { amount: 8.99, core: 'Disney Plus' }),
    S('youtube', 9, { amount: 11.99, core: 'Google YouTube Premium' }),
    { id: 'fitpark', name: 'Fitness Park', mid: null, match: 'FITNESS PARK', core: 'Fitness Park Paris', cad: 'monthly', amount: 29.9, day: 2 },
    { id: 'deezer', name: 'Deezer', mid: null, match: 'DEEZER', core: 'Deezer', cad: 'monthly', amount: 10.99, day: 15 },
  ],
  traps: [
    T('', 'ACME GMBH', 'monthly', 25, -1750, { kind: 'payroll', first: '2025-11-25', core: 'P' }),
    T('', 'LANDLORD KLEIN', 'monthly', 1, 980, { kind: 'rent', first: '2025-11-01', core: 'RENT' }),
    T('', 'Top-Up', 'monthly', 3, -300, { kind: 'topup', core: 'T' }),
  ],
  noise: { region: 'eu' },
  extra: (r) => [{ date: '2026-03-05', amt: 13.99, core: 'Netflix', name: 'Netflix', kind: 'card', cat: 'Entertainment', reverted: true }],
});

// 13. Generic QFX (OFX SGML)
build({
  file: 'generic.qfx', bank: 'qfx', seed: 1113, start: '2026-01-01', end: '2026-10-31', payments: true,
  subs: [
    S('netflix', 8, { changes: [['2026-06-08', 17.99]] }),
    S('spotify', 15),
    S('hulu', 22),
    S('ring', 4),
    S('grammarly', 12, { first: '2026-02-12' }),
    S('planet', 1),
    S('apple', 11),
    S('verizon', 19),
  ],
  traps: [T('AMZN MKTP US*{ref9}', 'Amazon', 'monthly', 20, 15.99, { jit: true })],
});

// ---------------------------------------------------------------------------------------------
// public/sample-statement.csv (the demo persona) + sample.expected.json

{
  const start = '2025-09-01', end = '2026-10-31';
  const r = rng(2001 + OFFSET);
  const subs = [
    S('netflix', 5, { changes: [['2026-04-05', 19.99]], amount: 17.99 }),
    S('spotify', 12, { amount: 19.99 }),
    S('chatgpt', 14),
    S('grammarly', 18, { first: '2025-09-18' }),
    S('otter', 7),
    S('notion', 11),
    S('todoist', 19),
    S('calendly', 23),
    S('dropbox', 3),
    S('apple', 9),
    S('apple', 16, { amount: 0.99 }),
    S('ring', 25, { amount: 10.99, core: 'RING PROTECT PLAN RING.COM CA' }),
    S('nordvpn', 12, { cad: 'annual', amount: 71.88, first: '2025-10-12' }),
    S('audible', 21),
    S('hulu', 27),
    S('max', 1),
    S('peloton', 28),
    S('mfp', 13),
    S('huckleberry', 8),
    S('headspace', 17),
    S('xfinity', 15, { amount: 89.99 }),
    S('verizon', 20),
    S('planet', 4, { core: 'PLANET FITNESS CLUB FEE' }),
    S('nytimes', 2),
    S('linktree', 22, { amount: 12 }),
    S('zapier', 10),
    S('ynab', 3, { cad: 'annual', amount: 109, first: '2025-09-03' }),
    S('prime', 14, { cad: 'annual', amount: 139, first: '2026-02-14' }),
    S('claude', 26),
    S('paramount', 12, { last: '2026-04-12', cancelled: true }),
  ];
  const entries = [];
  const expected = { active: [], inactive: [] };
  const resolved = subs.map((s) => ({ ...s, first: s.first ?? firstOn(start, s.day), kind: 'rec', jit: false }));
  const charged = [];
  for (const s of resolved) {
    const ch = chargesOf(s, start, end, r);
    charged.push([s, ch]);
    for (const c of ch) entries.push({ date: c.date, amt: c.amount, core: c.core, name: s.name, kind: 'rec', cat: 'Entertainment', sub: s.id });
  }
  entries.push(...noise(r, start, end, { rate: { groc: [1, 2], gas: [0, 1], food: [2, 4], oneoff: [1, 2], uber: [0, 2], amz: [1, 3] } }));
  entries.push({ date: end, amt: round2(between(r, 12, 40)), core: "TRADER JOE'S #552 CAMBRIDGE MA", name: 'Grocer', kind: 'card', cat: 'Groceries' });
  const byMonth = new Map();
  for (const e of entries) byMonth.set(e.date.slice(0, 7), (byMonth.get(e.date.slice(0, 7)) ?? 0) + e.amt);
  const months = [...byMonth.keys()].sort();
  for (const m of months.slice(0, -1)) entries.push({ date: monthStep(`${m}-01`, 1, 20), amt: -round2(byMonth.get(m)), core: 'PAYMENT', name: 'Payment', kind: 'payment', cat: 'Payment' });
  const ledger = entries.map((e, i) => ({ e, i })).sort((a, b) => (a.e.date < b.e.date ? -1 : a.e.date > b.e.date ? 1 : a.i - b.i)).map((x) => x.e);
  const statementEnd = ledger[ledger.length - 1].date;
  // ids in the REAL knowledge base (src/kb) for the sample's merchants, where they differ from fixtures/test-kb.json.
  // Checked by src/engine/sample-real-kb.test.ts. Bundled App Store charges list candidates the real KB must offer.
  const REAL_KB_ID = {
    grammarly: 'grammarly-pro', notion: 'notion-plus', todoist: 'todoist-pro', calendly: 'calendly-standard',
    dropbox: 'dropbox-plus', max: 'hbo-max', myfitnesspal: 'myfitnesspal-premium', nytimes: 'nyt-digital', linktree: 'linktree-pro',
  };
  for (const [s, ch] of charged) {
    const { entry, active } = expectedEntry(s, ch, statementEnd, KB);
    if (s.bundle) {
      entry.kbMerchantId = null;
      entry.kbCandidatesInclude = ['icloud-plus'];
    } else entry.kbMerchantId = REAL_KB_ID[entry.merchantId] ?? entry.merchantId;
    (active ? expected.active : expected.inactive).push(entry);
  }
  const samplePath = process.env.FIXTURE_OUT ? path.join(OUT, 'sample-statement.csv') : path.join(ROOT, 'public', 'sample-statement.csv');
  fs.mkdirSync(path.dirname(samplePath), { recursive: true });
  fs.writeFileSync(samplePath, banks.chaseCredit(ledger, rng(2002 + OFFSET)));
  fs.writeFileSync(
    path.join(OUT, 'sample.expected.json'),
    JSON.stringify(
      {
        file: 'public/sample-statement.csv',
        note: 'merchantId values are ids in fixtures/test-kb.json (candidates are computed against the test KB); kbMerchantId is the id in the real KB (src/kb) that findRecurring must return, and kbCandidatesInclude the candidate ids the real KB must offer for a bundled charge.',
        statementStart: ledger[0].date,
        statementEnd,
        rows: ledger.length,
        ...expected,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`sample-statement.csv ${String(ledger.length).padStart(4)} rows  ${expected.active.length} active + ${expected.inactive.length} inactive`);
}
