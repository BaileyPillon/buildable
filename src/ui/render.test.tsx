// Server-rendered checks of the components touched by the review fixes. No DOM: renderToStaticMarkup is enough to
// assert what a card, a panel or a page says, which is where these bugs were.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Assessment, Context, RecurringSeries } from '../types';
import { MERCHANTS } from '../kb';
import { AssessmentCard } from './AssessmentCard';
import type { CardActions } from './AssessmentCard';
import { REPO_URL, buildLogUrl } from './config';
import { PROOFS, DEFAULT_CONTEXT, assess, findRecurring, parseFiles, statementRange } from './data';
import { Dropzone } from './Dropzone';
import { Landing } from './Landing';
import { PlanDetail } from './PlanDetail';
import { ProofPanel } from './ProofPanel';
import { Receipt, RECEIPT_LINES_SHOWN } from './Receipt';
import { sampleReceiptModel } from './receiptModel';
import { Results } from './Results';
import { scoreHeadline, tally } from './proofs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RANGE = { statementStart: '2025-09-01', statementEnd: '2026-10-31' };
const noop = (): void => {};
const actions: CardActions = { setVerdict: noop, setUnused: noop, pickMerchant: noop, restore: noop };

function series(id: string, name: string, amount: number): RecurringSeries {
  return {
    key: id,
    displayName: name,
    descriptors: [name.toUpperCase()],
    cadence: 'monthly',
    charges: [
      { date: '2026-08-01', amount },
      { date: '2026-09-01', amount },
      { date: '2026-10-01', amount },
    ],
    currentAmount: amount,
    annualCost: Math.round(amount * 12 * 100) / 100,
    firstSeen: '2026-08-01',
    lastSeen: '2026-10-01',
    active: true,
    priceChanges: [],
    confidence: 0.9,
    merchantId: id,
  };
}

function rebuildItem(id: string): { item: Assessment; ctx: Context } {
  const m = MERCHANTS.find((x) => x.id === id)!;
  const ctx: Context = { ...DEFAULT_CONTEXT, verdictOverrides: { [id]: 'rebuild' } };
  return { item: assess([series(id, m.name, m.typicalMonthly ?? 9.99)], MERCHANTS, ctx, RANGE).items[0]!, ctx };
}

async function sampleResults(ctx: Context = DEFAULT_CONTEXT) {
  const text = fs.readFileSync(path.join(ROOT, 'public', 'sample-statement.csv'), 'utf8');
  const { txns, warnings } = await parseFiles([{ name: 'sample-statement.csv', text }]);
  const found = findRecurring(txns, MERCHANTS);
  const range = statementRange(txns);
  const { items, summary } = assess(found, MERCHANTS, ctx, { statementStart: range.start, statementEnd: range.end });
  return { loaded: { fileNames: ['sample-statement.csv'], warnings, txnCount: txns.length, series: found, range }, items, summary };
}

describe('proof data', () => {
  it('lists the four apps, each with its own score tallied from its checklist', () => {
    expect(PROOFS.map((p) => p.merchantId).sort()).toEqual(['adobe-acrobat-pro', 'habitify', 'huckleberry', 'quizlet-plus']);
    for (const p of PROOFS) {
      const t = tally(p.checklist);
      expect({ works: t.works, partial: t.partial, missing: t.missing }, p.merchantId).toEqual(p.score);
      expect(p.path).toBe(`/rebuilt/${p.merchantId}/`);
      expect(MERCHANTS.some((m) => m.id === p.merchantId && m.plans.rebuild), p.merchantId).toBe(true);
    }
  });

  it('matches the PROOF.json and BUILDLOG.md files in rebuilt/, and the prompt the apps were built from is the prompt on the card', () => {
    for (const p of PROOFS) {
      const file = path.join(ROOT, 'rebuilt', p.merchantId, 'PROOF.json');
      const source = JSON.parse(fs.readFileSync(file, 'utf8')) as { merchantId: string; model: string; builtAt: string; score: unknown; checklist: unknown; summary: string };
      expect(p.model, p.merchantId).toBe(source.model);
      expect(p.builtAt, p.merchantId).toBe(source.builtAt);
      expect(p.score, p.merchantId).toEqual(source.score);
      expect(p.checklist, p.merchantId).toEqual(source.checklist);
      expect(p.summary, p.merchantId).toBe(source.summary);

      // "this exact prompt": the build log quotes the prompt verbatim, and it must still equal the catalog's prompt
      const log = fs.readFileSync(path.join(ROOT, 'rebuilt', p.merchantId, 'BUILDLOG.md'), 'utf8');
      const flat = (t: string): string => t.replace(/^>\s?/gm, '').replace(/\s+/g, ' ').trim();
      const prompt = MERCHANTS.find((m) => m.id === p.merchantId)!.plans.rebuild!.prompt;
      expect(flat(log).includes(flat(prompt)), `${p.merchantId}: the catalog prompt changed since the app was built`).toBe(true);

      // the built app is in the public folder, so it ships at /rebuilt/<id>/
      expect(fs.existsSync(path.join(ROOT, 'public', 'rebuilt', p.merchantId, 'index.html')), p.merchantId).toBe(true);
    }
  });
});

describe('ProofPanel and the REBUILD card', () => {
  it('says what was run, scores it with partial results counted apart, and links the app and the build log', () => {
    for (const p of PROOFS) {
      const html = renderToStaticMarkup(<ProofPanel proof={p} />);
      expect(html).toContain('We ran this prompt');
      expect(html).toContain('Built by Claude Sonnet 5.5 from this exact prompt in one session');
      expect(html).toContain(scoreHeadline(p));
      expect(html).toMatch(/\d+ of 12 requirements work/);
      expect(html).toContain(`href="/rebuilt/${p.merchantId}/"`);
      expect(html).toContain('Open the app');
      expect(html).toContain(`href="${buildLogUrl(p.merchantId)}"`);
      expect(buildLogUrl(p.merchantId)).toBe(`https://github.com/BaileyPillon/buildable/blob/main/rebuilt/${p.merchantId}/BUILDLOG.md`);
      expect(html).toContain('rel="noopener noreferrer"');
      // every checklist item is listed, with its status as a word
      for (const c of p.checklist) expect(html).toContain(c.item.slice(0, 40).replace(/&/g, '&amp;'));
      if (p.score.partial > 0) expect(html).toContain('Partly works');
      expect(html).toContain('known problems');
    }
  });

  it('shows the panel on the REBUILD card of a proven service and on no other', () => {
    for (const id of PROOFS.map((p) => p.merchantId)) {
      const { item, ctx } = rebuildItem(id);
      expect(renderToStaticMarkup(<PlanDetail item={item} ctx={ctx} />), id).toContain('We ran this prompt');
    }
    const other = rebuildItem('zapier');
    expect(renderToStaticMarkup(<PlanDetail item={other.item} ctx={other.ctx} />)).not.toContain('We ran this prompt');
  });

  it('offers the build kit on absorb cards too', () => {
    const m = MERCHANTS.find((x) => x.verdict === 'absorb' && x.plans.absorb)!;
    const ctx: Context = DEFAULT_CONTEXT;
    const item = assess([series(m.id, m.name, m.typicalMonthly ?? 9.99)], MERCHANTS, ctx, RANGE).items[0]!;
    expect(item.verdict).toBe('absorb');
    expect(renderToStaticMarkup(<PlanDetail item={item} ctx={ctx} />)).toContain('Download build kit');
  });

  it('lists each source host once, and tells links on the same host apart', () => {
    const m = MERCHANTS.find((x) => new Set(x.sources.map((s) => new URL(s).host)).size < x.sources.length)!;
    const item = assess([series(m.id, m.name, m.typicalMonthly ?? 9.99)], MERCHANTS, DEFAULT_CONTEXT, RANGE).items[0]!;
    const html = renderToStaticMarkup(<PlanDetail item={item} ctx={DEFAULT_CONTEXT} />);
    const labels = [...html.matchAll(/class="plan__sources">([\s\S]*?)<\/p>/g)][0]![1]!.match(/>([^<>]+)<\/a>/g)!.map((s) => s.slice(1, -4));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('does not repeat the reason on a KEEP card', () => {
    const m = MERCHANTS.find((x) => x.verdict === 'keep' && x.plans.cancel)!;
    const item = assess([series(m.id, m.name, m.typicalMonthly ?? 9.99)], MERCHANTS, DEFAULT_CONTEXT, RANGE).items[0]!;
    expect(item.reason).toBe(m.why);
    const html = renderToStaticMarkup(<PlanDetail item={item} ctx={DEFAULT_CONTEXT} />);
    expect(html).not.toContain('Why keep it');
    expect(html).toContain('If you change your mind');
  });
});

describe('store-billed cards', () => {
  it('shows UNIDENTIFIED, not a verdict, before a pick; names the app after it; keeps a way to change it', async () => {
    const { items } = await sampleResults();
    const bundle = items.find((i) => !i.merchant && i.series.candidates && i.series.candidates.length > 0 && i.series.currentAmount === 9.99)!;
    expect(bundle).toBeDefined();

    const before = renderToStaticMarkup(<AssessmentCard item={bundle} ctx={DEFAULT_CONTEXT} kb={MERCHANTS} actions={actions} />);
    expect(before).toContain('UNIDENTIFIED');
    expect(before).not.toMatch(/class="pill"[^>]*>KEEP/);
    expect(before).toContain('I barely use this'); // unresolved cards can be flagged too
    expect(before).toContain('Which one is it?');

    const picked: Context = { ...DEFAULT_CONTEXT, merchantOverrides: { [bundle.series.key]: 'icloud-plus' } };
    const after = (await sampleResults(picked)).items.find((i) => i.series.key === bundle.series.key)!;
    const html = renderToStaticMarkup(<AssessmentCard item={after} ctx={picked} kb={MERCHANTS} actions={actions} />);
    expect(html).toContain('iCloud+ (billed via App Store)');
    expect(html).toContain('Not iCloud+?');
    expect(html).toMatch(/aria-pressed="true"[^>]*>iCloud\+/); // the chosen chip is pressed, so it can be un-picked
    expect(html).not.toContain('UNIDENTIFIED');
  });
});

describe('receipt on screen', () => {
  it('collapses to a few lines with a control for the rest, and never collapses a short list or the decorative one', () => {
    const model = sampleReceiptModel(); // 10 lines
    const collapsed = renderToStaticMarkup(<Receipt model={model} maxLines={RECEIPT_LINES_SHOWN} />);
    expect(collapsed.match(/class="r-line r-row"/g)).toHaveLength(RECEIPT_LINES_SHOWN);
    expect(collapsed).toContain(`+${model.lines.length - RECEIPT_LINES_SHOWN} more, show all ${model.lines.length}`);
    expect(collapsed).toContain('TOTAL / YEAR'); // total, savings and barcode are never behind the fold
    expect(collapsed).toContain('YOU COULD KEEP');

    const open = renderToStaticMarkup(<Receipt model={model} maxLines={RECEIPT_LINES_SHOWN} expanded />);
    expect(open.match(/class="r-line r-row"/g)).toHaveLength(model.lines.length);
    expect(open).toContain('Show fewer');

    const nine = { ...model, lines: model.lines.slice(0, RECEIPT_LINES_SHOWN + 1) };
    expect(renderToStaticMarkup(<Receipt model={nine} maxLines={RECEIPT_LINES_SHOWN} />)).not.toContain('more, show all');

    expect(renderToStaticMarkup(<Receipt model={model} maxLines={RECEIPT_LINES_SHOWN} decorative />)).not.toContain('more, show all');
  });
});

describe('landing page', () => {
  const html = renderToStaticMarkup(<Landing status={{ kind: 'idle' }} onFiles={noop} onSample={noop} />);

  it('lists the four proof apps with their scores, honestly', () => {
    expect(html).toContain('id="proof"');
    for (const p of PROOFS) {
      expect(html).toContain(p.appName);
      expect(html).toContain(scoreHeadline(p));
      expect(html).toContain(`href="${p.path}"`);
    }
    expect(html).toMatch(/partly works?, 0 missing/);
  });

  it('does not claim the page "could not upload even if it tried"', () => {
    expect(html).not.toMatch(/even if it tried/i);
    expect(html).toContain('Your statement never leaves this tab.');
    expect(html).toContain('Content-Security-Policy');
  });

  it('points GitHub at the real repository', () => {
    expect(REPO_URL).toBe('https://github.com/BaileyPillon/buildable');
  });
});

describe('dropzone', () => {
  it('offers a reload, not "try again", when the failure is the page loading its own catalog', () => {
    const html = renderToStaticMarkup(<Dropzone status={{ kind: 'error', message: 'Reload and retry.', reload: true }} onFiles={noop} onSample={noop} />);
    expect(html).toContain('Reload the page');
    const plain = renderToStaticMarkup(<Dropzone status={{ kind: 'error', message: 'Bad file.' }} onFiles={noop} onSample={noop} />);
    expect(plain).not.toContain('Reload the page');
  });

  it('lights up when a file is dragged over the page outside the box', () => {
    expect(renderToStaticMarkup(<Dropzone status={{ kind: 'idle' }} onFiles={noop} onSample={noop} pageDragging />)).toContain('is-dragging');
    expect(renderToStaticMarkup(<Dropzone status={{ kind: 'idle' }} onFiles={noop} onSample={noop} />)).not.toContain('is-dragging');
  });
});

describe('results page', () => {
  it('puts the heading before the bar in the page (so Tab from the focused heading reaches Export and Start over) and counts blocked items', async () => {
    const { loaded } = await sampleResults();
    const html = renderToStaticMarkup(
      <Results
        loaded={loaded}
        kb={MERCHANTS}
        ctx={DEFAULT_CONTEXT}
        contextActions={{ setClaudePlan: noop, toggleDevice: noop, setHourly: noop }}
        cardActions={actions}
        onStartOver={noop}
      />,
    );
    const h1 = html.indexOf('<h1');
    const bar = html.indexOf('class="bar"');
    expect(h1).toBeGreaterThan(-1);
    expect(bar).toBeGreaterThan(h1);
    expect(html.indexOf('Export my plan')).toBeGreaterThan(h1);
    // no devices ticked: the self-host items are blocked, and the header says so instead of silently leaving them out
    expect(html).toMatch(/\d+ items? \(\d+ blocked\)/);
    expect(html).toContain('not counting');
    // the prompt blocks are labelled regions
    expect(html).toContain('role="region"');
  });
});
