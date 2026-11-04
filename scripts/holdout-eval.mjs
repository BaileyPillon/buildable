#!/usr/bin/env node
// Holdout evaluation: runs the REAL engine + REAL KB over unseen statements in fixtures/holdout/.
//   node scripts/holdout-eval.mjs [--json] [--verbose] [--file=<substring>]
// TS is loaded through Vite's SSR loader (no extra dependency, resolves the extensionless imports in src/).
// Prints per-file recall / precision of series detection and merchant-match accuracy, and lists every
// miss, false positive and wrong match with the raw descriptor. Writes fixtures/holdout/results.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOLD = path.join(ROOT, 'fixtures', 'holdout');
const args = process.argv.slice(2);
const JSON_ONLY = args.includes('--json');
const VERBOSE = args.includes('--verbose');
const FILTER = (args.find((a) => a.startsWith('--file=')) || '').slice(7);
const log = (...a) => { if (!JSON_ONLY) console.log(...a); };

const PPY = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, semiannual: 2, annual: 1 };
const norm = (s) => String(s).toUpperCase().replace(/\s+/g, ' ').trim();
const pct = (a, b) => (b === 0 ? null : Math.round((a / b) * 1000) / 10);
const money = (x) => (x == null ? '-' : '$' + Number(x).toFixed(2));
const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;

const server = await createServer({
  root: ROOT, configFile: false, logLevel: 'error', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
let exitCode = 0;
try {
  const eng = await server.ssrLoadModule('/src/engine/index.ts');
  const matchMod = await server.ssrLoadModule('/src/engine/match.ts');
  const kbMod = await server.ssrLoadModule('/src/kb/index.ts');
  const { parseFiles, findRecurring, assess, DEFAULT_CONTEXT, normalizeDescriptor } = eng;
  const KB = kbMod.MERCHANTS;
  const kbById = new Map(KB.map((m) => [m.id, m]));

  const files = fs.readdirSync(HOLD).filter((f) => f.endsWith('.expected.json') && f.includes(FILTER)).sort();
  if (!files.length) throw new Error('no *.expected.json in fixtures/holdout (run node fixtures/holdout/gen-holdout.mjs)');

  const all = {};
  for (const ef of files) {
    const exp = JSON.parse(fs.readFileSync(path.join(HOLD, ef), 'utf8'));
    const text = fs.readFileSync(path.join(HOLD, exp.file), 'utf8');
    const out = { file: exp.file, format: exp.format };
    log('\n' + '='.repeat(100));
    log(`${exp.file}   [${exp.format}]`);
    log('='.repeat(100));

    // ---- parse
    const t0 = performance.now();
    const parsed = await parseFiles([{ name: exp.file, text }]);
    const t1 = performance.now();
    const txns = parsed.txns;
    const charges = txns.filter((t) => t.amount > 0).length;
    const credits = txns.filter((t) => t.amount < 0).length;
    const dates = txns.map((t) => t.date).sort();
    const parseIssues = [];
    const tol = Math.max(3, exp.dupeEstimate + 3);
    // Type=Installment rows (Apple Card financing) are left out by the parser on purpose
    const expectedCharges = exp.chargeRows - (exp.installmentRows || 0);
    if (Math.abs(charges - expectedCharges) > tol) parseIssues.push(`charge rows ${charges} vs expected ${expectedCharges} (+-${tol})`);
    if (Math.abs(credits - exp.creditRows) > tol) parseIssues.push(`credit rows ${credits} vs expected ${exp.creditRows} (+-${tol})`);
    log(`parse: ${txns.length} txns (${charges} charges, ${credits} credits; file has ${exp.rows} rows, dupe estimate ${exp.dupeEstimate}), range ${dates[0]}..${dates[dates.length - 1]}, ${(t1 - t0).toFixed(0)} ms`);
    if (parsed.warnings.length) log('  warnings:', parsed.warnings.map((w) => `"${w}"`).join(' | '));
    if (parseIssues.length) log('  PARSE ISSUES:', parseIssues.join('; '));
    out.parse = { txns: txns.length, charges, credits, fileRows: exp.rows, warnings: parsed.warnings, issues: parseIssues, ms: Math.round(t1 - t0) };

    // ---- recurring
    const t2 = performance.now();
    const series = findRecurring(txns, KB);
    const t3 = performance.now();
    log(`findRecurring: ${series.length} series in ${(t3 - t2).toFixed(0)} ms`);

    // ---- map detected -> expected entries
    const pool = [
      ...exp.series.map((e) => ({ ...e, cat: 'exp' })),
      ...exp.undetectableByDesign.map((e) => ({ ...e, cat: 'undet' })),
      ...exp.mustNotDetect.map((e) => ({ ...e, cat: 'trap' })),
    ];
    const score = (det, e) => {
      const descs = det.descriptors.map(norm);
      if (!e.match.some((t) => descs.some((d) => d.includes(norm(t))))) return -1;
      if (e.amounts && e.amounts.length) {
        const hits = det.charges.filter((c) => e.amounts.some((a) => near(a, c.amount))).length;
        return hits ? 1 + hits : -1;
      }
      return 1;
    };
    const mapped = new Map(); // entry.id -> detected[]
    const unexpected = [];
    for (const d of series) {
      let best = null, bs = -1;
      for (const e of pool) { const s = score(d, e); if (s > bs) { bs = s; best = e; } }
      if (best) { if (!mapped.has(best.id)) mapped.set(best.id, []); mapped.get(best.id).push(d); }
      else unexpected.push(d);
    }

    const misses = [], fps = [], wrong = [], issues = [], bonus = [], frags = [];
    let tp = 0, tpKb = 0, tpNon = 0, tpSingles = 0;
    let cadOk = 0, cadN = 0, actOk = 0, actN = 0, amtOk = 0, amtN = 0, pcExp = 0, pcHit = 0, matchOk = 0, matchN = 0, annOk = 0, annN = 0, cntShort = 0;
    const expSeries = exp.series;
    const kbExpected = expSeries.filter((e) => e.merchantId);
    const nonKbExpected = expSeries.filter((e) => !e.merchantId && !e.bundle);
    const bundleExpected = expSeries.filter((e) => e.bundle);

    const rowsFor = (e) => txns.filter((t) => e.match.some((tk) => norm(t.description).includes(norm(tk))) &&
      (!e.amounts || !e.amounts.length || e.amounts.some((a) => near(a, t.amount))));
    const diagnose = (e) => {
      const rows = rowsFor(e);
      if (!rows.length) return 'no parsed rows contain the descriptor token (parse/sign issue?)';
      const first = rows.slice().sort((a, b) => a.date.localeCompare(b.date))[0];
      const n = normalizeDescriptor(first.description);
      let kbm = null;
      try { kbm = matchMod.matchMerchant(KB, n, first.description.toUpperCase(), first.amount); } catch { /* ignore */ }
      let iso = [];
      try { iso = findRecurring(rows, KB); } catch (err) { iso = [`threw ${err.message}`]; }
      const neg = rows.filter((r) => r.amount < 0).length;
      return `${rows.length} parsed rows${neg ? ` (${neg} negative)` : ''}, first "${first.description.slice(0, 90)}" -> normalized "${n}" -> KB match ${kbm ? kbm.id : 'none'}; ` +
        `findRecurring on just these rows: ${Array.isArray(iso) && iso.length && typeof iso[0] !== 'string' ? iso.map((s) => `${s.merchantId ?? s.key}/${s.cadence}/${s.charges.length}ch/conf ${s.confidence.toFixed(2)}`).join(', ') : 'nothing'}`;
    };

    for (const e of expSeries) {
      const list = (mapped.get(e.id) || []).slice();
      if (!list.length) { misses.push({ e, why: diagnose(e) }); continue; }
      list.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || b.charges.length - a.charges.length);
      const d = list[0];
      for (const extra of list.slice(1)) frags.push({ e, d: extra });
      tp++; if (e.merchantId) tpKb++; else if (!e.bundle) tpNon++;
      if (e.singleCharge) tpSingles++;

      // merchant match
      matchN++;
      let ok;
      if (e.bundle) ok = d.merchantId == null && (e.candidatesInclude || []).every((c) => (d.candidates || []).includes(c));
      else if (e.merchantId) ok = d.merchantId === e.merchantId || (e.acceptable || []).includes(d.merchantId);
      else ok = d.merchantId == null;
      if (ok) matchOk++;
      else wrong.push({ e, d, why: diagnose(e) });

      // cadence / active / amount / price changes / annual cost
      cadN++; if (d.cadence === e.cadence) cadOk++; else issues.push({ kind: 'cadence', e, d, msg: `cadence ${d.cadence} (expected ${e.cadence})` });
      actN++; if (d.active === e.active) actOk++; else issues.push({ kind: 'active', e, d, msg: `active=${d.active} (expected ${e.active}); lastSeen ${d.lastSeen}` });
      amtN++;
      const refAmt = e.variable ? e.meanAmount : e.currentAmount;
      const aTol = e.variable ? 0.15 : 0.011;
      const aOk = e.variable ? Math.abs(d.currentAmount - refAmt) / refAmt <= aTol : near(d.currentAmount, refAmt, 0.011);
      if (aOk) amtOk++; else issues.push({ kind: 'amount', e, d, msg: `currentAmount ${money(d.currentAmount)} (expected ${money(refAmt)}${e.variable ? ' +-15%' : ''})` });
      annN++;
      const expAnnual = refAmt * PPY[e.cadence];
      if (Math.abs(d.annualCost - expAnnual) / expAnnual <= (e.variable ? 0.15 : 0.03)) annOk++;
      else issues.push({ kind: 'annualCost', e, d, msg: `annualCost ${money(d.annualCost)} vs expected ~${money(expAnnual)} (${e.cadence})` });
      if (d.charges.length < e.count - 1) { cntShort++; issues.push({ kind: 'charges', e, d, msg: `only ${d.charges.length} of ${e.count} charges grouped` }); }
      for (const pc of e.priceChanges || []) {
        pcExp++;
        if ((d.priceChanges || []).some((p) => near(p.to, pc.to, 0.02))) pcHit++;
        else issues.push({ kind: 'priceChange', e, d, msg: `price change ${money(pc.from)} -> ${money(pc.to)} not reported (got ${JSON.stringify(d.priceChanges)})` });
      }
      if (!(e.priceChanges || []).length && !e.variable && (d.priceChanges || []).length) {
        issues.push({ kind: 'spuriousPriceChange', e, d, msg: `spurious price change ${JSON.stringify(d.priceChanges)}` });
      }
    }
    for (const e of exp.undetectableByDesign) { const l = mapped.get(e.id); if (l && l.length) bonus.push({ e, d: l[0] }); }
    for (const e of exp.mustNotDetect) for (const d of mapped.get(e.id) || []) fps.push({ kind: 'trap', e, d });
    for (const d of unexpected) fps.push({ kind: 'unexpected', d });
    for (const f of frags) fps.push({ kind: 'fragment', e: f.e, d: f.d });

    const detectedForPrecision = series.length - bonus.length;
    const fpCount = fps.length;
    const recall = pct(tp, expSeries.length);
    const precision = pct(tp, tp + fpCount);
    const matchAccuracy = pct(matchOk, matchN);
    const nonSingleExp = expSeries.filter((e) => !e.singleCharge).length;
    const metrics = {
      recall, precision, matchAccuracy,
      expected: expSeries.length, detected: series.length, truePositives: tp, missed: misses.length, falsePositives: fpCount,
      recallKb: pct(tpKb, kbExpected.length), recallNonKb: pct(tpNon, nonKbExpected.length), recallBundles: pct(tp - tpKb - tpNon, bundleExpected.length),
      recallExclSingleCharge: pct(tp - tpSingles, nonSingleExp),
      wrongMatches: wrong.length, cadenceAccuracy: pct(cadOk, cadN), activeAccuracy: pct(actOk, actN), amountAccuracy: pct(amtOk, amtN),
      annualCostAccuracy: pct(annOk, annN), priceChangeRecall: pcExp ? pct(pcHit, pcExp) : null,
      fragments: frags.length, trapsHit: fps.filter((f) => f.kind === 'trap').length, unexpectedSeries: fps.filter((f) => f.kind === 'unexpected').length,
      undetectableButFound: bonus.length,
    };
    out.metrics = metrics;

    // ---- descriptor-level KB precision probe: every distinct charge descriptor that belongs to NO expected series/trap
    // (groceries, rides, lookalike names such as "TIDAL WAVE CAR WASH") must not match a KB merchant.
    const poolTokens = pool.flatMap((e) => e.match.map(norm));
    const seenDesc = new Map();
    for (const t of txns) {
      if (!(t.amount > 0)) continue;
      const nd = norm(t.description);
      if (poolTokens.some((tk) => nd.includes(tk))) continue;
      if (seenDesc.has(t.description)) { seenDesc.get(t.description).count++; continue; }
      let m = null;
      try { m = matchMod.matchMerchant(KB, normalizeDescriptor(t.description), t.description.toUpperCase(), t.amount); } catch { /* ignore */ }
      seenDesc.set(t.description, { descriptor: t.description, normalized: normalizeDescriptor(t.description), merchantId: m ? m.id : null, count: 1 });
    }
    const kbFalse = [...seenDesc.values()].filter((x) => x.merchantId);
    metrics.kbFalseMatchDescriptors = kbFalse.length;
    metrics.nonSubscriptionDescriptorsChecked = seenDesc.size;
    out.kbFalseMatches = kbFalse;
    log(`KB descriptor probe: ${kbFalse.length} of ${seenDesc.size} non-subscription descriptors matched a KB merchant`);
    for (const k of kbFalse) log(`  - KB FALSE MATCH ${k.merchantId}: "${k.descriptor}" (x${k.count}) normalized "${k.normalized}"`);

    // ---- assess invariants
    const range = { statementStart: dates[0], statementEnd: dates[dates.length - 1] };
    const aIssues = [];
    let asm = null;
    try {
      const t4 = performance.now();
      const res = assess(series, KB, DEFAULT_CONTEXT, range);
      const t5 = performance.now();
      asm = res.summary;
      if (res.items.length !== series.length) aIssues.push(`assess returned ${res.items.length} items for ${series.length} series`);
      let sumActive = 0, keepInfeasible = 0;
      for (const it of res.items) {
        for (const k of ['savingsYear', 'hours']) if (!Number.isFinite(it[k]) || it[k] < 0) aIssues.push(`${it.series.key}: bad ${k}=${it[k]}`);
        if (it.roiPerHour != null && !Number.isFinite(it.roiPerHour)) aIssues.push(`${it.series.key}: bad roiPerHour`);
        if (it.series.active) {
          sumActive += it.series.annualCost;
          if (!it.merchant && (it.verdict !== 'keep' || !/catalog/i.test(it.reason))) aIssues.push(`${it.series.key}: unmatched but verdict ${it.verdict} / reason "${it.reason}"`);
          if (it.merchant && it.verdict === 'keep' && it.merchant.verdict !== 'keep') keepInfeasible++;
        }
      }
      if (Math.abs(sumActive - res.summary.totalYear) > 0.06) aIssues.push(`summary.totalYear ${res.summary.totalYear} != sum of active annualCost ${sumActive.toFixed(2)}`);
      const rich = assess(series, KB, { ...DEFAULT_CONTEXT, claudePlan: 'none', devices: ['old-laptop', 'spare-pc', 'raspberry-pi', 'nas', 'old-android', 'old-iphone', 'old-ipad', 'kindle'], unused: series.slice(0, 3).map((s) => s.key) }, range);
      if (!Number.isFinite(rich.summary.netSavingsYear)) aIssues.push('rich-context netSavingsYear not finite');
      const expTotal = expSeries.filter((e) => e.active).reduce((a, e) => a + (e.variable ? e.meanAmount : e.currentAmount) * PPY[e.cadence], 0);
      const delta = (res.summary.totalYear - expTotal) / expTotal;
      out.assess = { totalYearDetected: res.summary.totalYear, totalYearExpected: Math.round(expTotal * 100) / 100, totalYearDeltaPct: Math.round(delta * 1000) / 10, savingsYear: res.summary.savingsYear, buildHours: res.summary.buildHours, keepBecauseInfeasible: keepInfeasible, ms: Math.round(t5 - t4), issues: aIssues };
      log(`assess: totalYear ${money(res.summary.totalYear)} vs expected-series total ${money(expTotal)} (${(delta * 100).toFixed(1)}%), savings ${money(res.summary.savingsYear)}, ${keepInfeasible} KB-matched series fell back to keep (verdict plan missing), ${(t5 - t4).toFixed(0)} ms${aIssues.length ? '\n  ASSESS ISSUES: ' + aIssues.join('; ') : ''}`);
    } catch (err) {
      aIssues.push(`assess threw: ${err.message}`);
      out.assess = { issues: aIssues };
      log('  ASSESS THREW:', err.stack);
    }

    // ---- report
    log('');
    log(`SERIES DETECTION  expected ${expSeries.length}  detected ${series.length}  TP ${tp}  missed ${misses.length}  FP ${fpCount} (traps ${metrics.trapsHit}, unexpected ${metrics.unexpectedSeries}, fragments ${frags.length})`);
    log(`  recall ${recall}%   precision ${precision}%   (KB ${metrics.recallKb}%  non-KB ${metrics.recallNonKb}%  bundles ${metrics.recallBundles}%  excl. single-charge ${metrics.recallExclSingleCharge}%)`);
    log(`MERCHANT MATCH    ${matchOk}/${matchN} correct = ${matchAccuracy}%   wrong ${wrong.length}`);
    log(`DETAILS           cadence ${metrics.cadenceAccuracy}%  active ${metrics.activeAccuracy}%  current amount ${metrics.amountAccuracy}%  annual cost ${metrics.annualCostAccuracy}%  price-change recall ${metrics.priceChangeRecall ?? 'n/a'}%`);
    if (misses.length) {
      log('\nMISSES (expected series not reported):');
      for (const m of misses) log(`  - [${m.e.merchantId ? 'KB ' + m.e.merchantId : m.e.bundle ? 'bundle' : 'non-KB'}] ${m.e.label}: ${m.e.cadence}, ${m.e.count} charges, ${m.e.variable ? '~' + money(m.e.meanAmount) : money(m.e.currentAmount)}${m.e.singleCharge ? ' (single charge)' : ''}\n      raw: ${m.e.sampleDescriptor}\n      why: ${m.why}`);
    }
    if (wrong.length) {
      log('\nWRONG MERCHANT MATCHES:');
      for (const w of wrong) log(`  - ${w.e.label}: expected ${w.e.bundle ? 'bundle(null) with candidates ⊇ [' + (w.e.candidatesInclude || []).join(',') + ']' : w.e.merchantId ?? 'null (non-KB)'}${w.e.acceptable ? ' (or ' + w.e.acceptable.join('/') + ')' : ''}, got ${w.d.merchantId ?? 'null'}${w.d.candidates ? ' candidates [' + w.d.candidates.join(',') + ']' : ''}\n      raw: ${w.d.descriptors[0]}\n      ${w.why}`);
    }
    if (fps.length) {
      log('\nFALSE POSITIVES (reported but not a subscription / duplicate rows):');
      for (const f of fps) {
        const d = f.d;
        log(`  - [${f.kind}${f.e ? ': ' + f.e.label : ''}] key=${d.key} name="${d.displayName}" ${d.cadence} ${d.charges.length}ch ${money(d.currentAmount)} merchant=${d.merchantId ?? 'null'} active=${d.active}\n      raw: ${d.descriptors[0]}`);
      }
    }
    if (issues.length) {
      log('\nDETAIL ISSUES on matched series:');
      for (const i of issues) log(`  - ${i.e.label}: ${i.msg}`);
    }
    if (bonus.length) {
      log('\nINFO: spec-undetectable series that were reported anyway (not counted):');
      for (const b of bonus) log(`  - ${b.e.label} (${b.e.undetectableReason}) -> ${b.d.merchantId ?? 'null'} ${b.d.cadence} ${b.d.charges.length}ch`);
    }
    if (VERBOSE) {
      log('\nMATCHED OK:');
      for (const e of expSeries) { const l = mapped.get(e.id); if (l?.length) log(`  + ${e.label}: ${l[0].merchantId ?? 'null'} ${l[0].cadence} ${l[0].charges.length}ch ${money(l[0].currentAmount)}`); }
    }
    out.misses = misses.map((m) => ({ id: m.e.id, label: m.e.label, merchantId: m.e.merchantId, descriptor: m.e.sampleDescriptor, why: m.why }));
    out.wrongMatches = wrong.map((w) => ({ id: w.e.id, label: w.e.label, expected: w.e.merchantId, got: w.d.merchantId, candidates: w.d.candidates ?? null, descriptor: w.d.descriptors[0] }));
    out.falsePositives = fps.map((f) => ({ kind: f.kind, label: f.e?.label ?? null, key: f.d.key, merchantId: f.d.merchantId, cadence: f.d.cadence, charges: f.d.charges.length, amount: f.d.currentAmount, descriptor: f.d.descriptors[0] }));
    out.issues = issues.map((i) => ({ kind: i.kind, label: i.e.label, msg: i.msg }));
    all[exp.file] = out;
  }

  // ---- descriptor-level KB recall probe (merchants not used in the statements)
  const probePath = path.join(HOLD, 'descriptor-probe.json');
  if (fs.existsSync(probePath) && !FILTER) {
    const probe = JSON.parse(fs.readFileSync(probePath, 'utf8')).items;
    const pm = [];
    let ok = 0;
    for (const it of probe) {
      const n = normalizeDescriptor(it.descriptor);
      const m = matchMod.matchMerchant(KB, n, it.descriptor.toUpperCase(), it.amount);
      const accepted = [it.id, ...(it.also || [])];
      if (m && accepted.includes(m.id)) ok++;
      else pm.push({ id: it.id, conf: it.conf, descriptor: it.descriptor, normalized: n, got: m ? m.id : null, patterns: kbById.get(it.id)?.match.patterns ?? null });
    }
    const hi = probe.filter((x) => x.conf === 'high').length;
    const hiMiss = pm.filter((x) => x.conf === 'high').length;
    all.__descriptorProbe = { items: probe.length, correct: ok, accuracy: pct(ok, probe.length), highConfidenceItems: hi, highConfidenceAccuracy: pct(hi - hiMiss, hi), misses: pm };
    log('\n' + '='.repeat(100));
    log(`KB DESCRIPTOR PROBE (unseen merchants, ${probe.length} descriptors): ${ok} matched = ${pct(ok, probe.length)}%; high-confidence descriptors ${pct(hi - hiMiss, hi)}%`);
    for (const x of pm) log(`  - [${x.conf}] expected ${x.id}, got ${x.got ?? 'none'}: "${x.descriptor}" -> normalized "${x.normalized}"  patterns ${JSON.stringify(x.patterns)}`);
  }

  fs.writeFileSync(path.join(HOLD, 'results.json'), JSON.stringify(all, null, 2) + '\n');
  if (JSON_ONLY) console.log(JSON.stringify(all, null, 2));
  else {
    console.log('\n' + '='.repeat(100));
    console.log('SUMMARY (recall / precision / matchAccuracy)');
    for (const [f, o] of Object.entries(all)) {
      if (f === '__descriptorProbe') continue;
      const m = o.metrics;
      console.log(`  ${f.padEnd(34)} recall ${String(m.recall).padStart(5)}%  precision ${String(m.precision).padStart(5)}%  matchAccuracy ${String(m.matchAccuracy).padStart(5)}%   (missed ${m.missed}, FP ${m.falsePositives}, wrong ${m.wrongMatches})`);
    }
    if (all.__descriptorProbe) console.log(`  descriptor probe: ${all.__descriptorProbe.accuracy}% of ${all.__descriptorProbe.items} unseen-merchant descriptors matched (${all.__descriptorProbe.highConfidenceAccuracy}% of high-confidence ones)`);
    console.log('  results written to fixtures/holdout/results.json');
  }
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  await server.close();
}
process.exit(exitCode);
