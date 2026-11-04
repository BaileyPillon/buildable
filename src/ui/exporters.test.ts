// Exports: the "Ask Claude" prompt, the plan markdown and the build kits, checked against the real knowledge base.
import { describe, expect, it } from 'vitest';
import type { Assessment, Context, Merchant, RecurringSeries, Verdict } from '../types';
import { MERCHANTS } from '../kb';
import { DEFAULT_CONTEXT, assess } from './data';
import { derive } from './derive';
import { askClaudePrompt, buildKit, codeSpan, isLocalFirst, planMarkdown } from './exporters';
import { NO_DESCRIPTOR, scrubDescriptor, scrubbedDescriptors } from './scrub';

const RANGE = { statementStart: '2025-09-01', statementEnd: '2026-10-31' };

const everything: Context = {
  ...DEFAULT_CONTEXT,
  devices: ['old-laptop', 'spare-pc', 'raspberry-pi', 'nas', 'old-android', 'old-iphone', 'old-ipad', 'kindle'],
};

function fakeSeries(key: string, name: string, amount: number, descriptors: string[], merchantId: string | null): RecurringSeries {
  return {
    key,
    displayName: name,
    descriptors,
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
    merchantId,
  };
}

function kitFor(m: Merchant, verdict: Verdict): string | null {
  const ctx: Context = { ...everything, verdictOverrides: { [m.id]: verdict } };
  const series = [fakeSeries(m.id, m.name, m.typicalMonthly ?? 9.99, [m.name.toUpperCase()], m.id)];
  return buildKit(assess(series, MERCHANTS, ctx, RANGE).items[0]!, ctx);
}

const byId = (id: string): Merchant => {
  const m = MERCHANTS.find((x) => x.id === id);
  if (!m) throw new Error(`no merchant ${id}`);
  return m;
};

/** An unrecognized series as the engine would hand it over. */
function unrecognized(descriptors: string[], amount = 42): Assessment {
  const series = [fakeSeries('x@42.00', 'Acme Gym', amount, descriptors, null)];
  return assess(series, MERCHANTS, DEFAULT_CONTEXT, RANGE).items[0]!;
}

describe('scrubDescriptor', () => {
  it('removes phone numbers, card digits and reference ids', () => {
    const raw = 'ACME GYM 800-555-0199 JOHN Q SMITH CARD 4111111111111111 REF 99887766';
    const out = scrubDescriptor(raw);
    expect(out).not.toMatch(/\d{4}/);
    expect(out).not.toContain('800');
    expect(out).not.toContain('4111');
    expect(out).not.toContain('99887766');
    expect(out).not.toMatch(/\bREF\b/);
    expect(out.startsWith('ACME GYM')).toBe(true);
  });

  it('handles the other examples from the review', () => {
    for (const raw of [
      'ACME CLOUD 800-555-0199 CA ENDING IN 4242 REF 884213377 JANE Q DOE',
      'PAYPAL *JANE DOE 4029357733 CA',
      'BOSTON SPORTS CLUB 0412 BOSTON MA',
      'ACME 12345 jane@example.com',
    ]) {
      const out = scrubDescriptor(raw);
      expect(out, raw).not.toMatch(/\d{3,}/);
      expect(out, raw).not.toContain('@');
      expect(out.length, raw).toBeGreaterThan(0);
    }
  });

  it('never returns an empty string, and shortens very long descriptors', () => {
    expect(scrubDescriptor('800-555-0199')).toBe(NO_DESCRIPTOR);
    expect(scrubDescriptor('4111111111111111')).toBe(NO_DESCRIPTOR);
    const long = scrubDescriptor('ALPHA BETA GAMMA DELTA EPSILON ZETA ETA THETA IOTA KAPPA LAMBDA MU NU XI OMICRON');
    expect(long.length).toBeLessThanOrEqual(48);
  });

  it('lists distinct shortened forms, not two spellings of the same one', () => {
    expect(scrubbedDescriptors(['ACME GYM 800-555-0199', 'ACME GYM 800-555-0100', 'ACME GYM REF 12345678'])).toEqual(['ACME GYM']);
  });
});

describe('askClaudePrompt', () => {
  it('does not carry phone numbers, card digits or ids into the clipboard text', () => {
    const items = [
      unrecognized(['ACME GYM 800-555-0199 JOHN Q SMITH CARD 4111111111111111 REF 99887766']),
      unrecognized(['ACME CLOUD 800-555-0199 CA ENDING IN 4242 REF 884213377 JANE Q DOE'], 9.49),
    ];
    const prompt = askClaudePrompt(items);
    expect(prompt).not.toContain('800-555');
    expect(prompt).not.toContain('4111');
    expect(prompt).not.toContain('4242');
    expect(prompt).not.toContain('99887766');
    expect(prompt).not.toContain('884213377');
    expect(prompt).toContain('ACME GYM');
    expect(prompt).toContain('$42.00 monthly');
    expect(prompt).toContain('$9.49 monthly');
    // the footer promises only what is true: shortened descriptors, amounts, cadence
    expect(prompt).toContain('shortened descriptors, amounts and how often they bill');
  });
});

describe('codeSpan', () => {
  it('keeps hostile text inert: no HTML, links or headings survive as markup', () => {
    for (const raw of [
      '<img src=x onerror=alert(1)> PRO',
      'MULTI LINE # INJECTED HEADING - [click](https://evil.example/?d=1) ZETA',
      'back`tick``s and ```more',
      '`leading and trailing`',
    ]) {
      const span = codeSpan(raw);
      // one code span: the opening and closing runs are the same length and longer than any run inside the text
      const m = /^(`+) ?([\s\S]*?) ?\1$/.exec(span);
      expect(m, span).not.toBeNull();
      const inner = m![2]!;
      const longestInside = (inner.match(/`+/g) ?? []).reduce((n, r) => Math.max(n, r.length), 0);
      expect(m![1]!.length).toBeGreaterThan(longestInside);
      expect(span).not.toContain('\n');
    }
  });
});

describe('planMarkdown', () => {
  it('wraps statement-derived names and descriptors in code spans so a hostile descriptor cannot inject markup', () => {
    const hostile = '<img src=x onerror=alert(1)> PRO';
    const link = 'MULTI LINE # INJECTED HEADING - [click](https://evil.example/?d=1) ZETA';
    const series = [
      fakeSeries('hostile@12.99', hostile, 12.99, [hostile], null),
      fakeSeries('link@5.00', link, 5, [link], null),
      { ...fakeSeries('gone@3.00', '<script>x</script> GONE', 3, ['GONE'], null), active: false, lastSeen: '2025-12-01' },
    ];
    const { items, summary } = assess(series, MERCHANTS, DEFAULT_CONTEXT, RANGE);
    const md = planMarkdown({ derived: derive(items, summary), ctx: DEFAULT_CONTEXT, start: RANGE.statementStart, end: RANGE.statementEnd, fileCount: 1 });
    // no angle bracket or link syntax outside a code span
    const outsideSpans = md.replace(/(`+)[^`]*?\1/g, '');
    expect(outsideSpans).not.toMatch(/<(img|script)/i);
    expect(outsideSpans).not.toMatch(/\]\(https?:/);
    // and the unrecognized list uses the shortened descriptor, not the raw text
    expect(md).toContain('## Unrecognized');
  });

  it('does not put a phone number or card digits from a descriptor in the export', () => {
    const series = [
      fakeSeries('acme@42.00', 'Acme Gym', 42, ['ACME GYM 800-555-0199 JOHN Q SMITH CARD 4111111111111111 REF 99887766'], null),
    ];
    const { items, summary } = assess(series, MERCHANTS, DEFAULT_CONTEXT, RANGE);
    const md = planMarkdown({ derived: derive(items, summary), ctx: DEFAULT_CONTEXT, start: RANGE.statementStart, end: RANGE.statementEnd, fileCount: 1 });
    expect(md).not.toContain('800-555');
    expect(md).not.toContain('4111');
    expect(md).not.toContain('99887766');
    expect(md).toContain('ACME GYM');
  });

  it('never prints a doubled period for a rebuild plan', () => {
    const m = byId('zapier');
    const ctx: Context = { ...everything, verdictOverrides: { zapier: 'rebuild' } };
    const series = [fakeSeries('zapier', m.name, 29.99, ['ZAPIER'], 'zapier')];
    const { items, summary } = assess(series, MERCHANTS, ctx, RANGE);
    const md = planMarkdown({ derived: derive(items, summary), ctx, start: RANGE.statementStart, end: RANGE.statementEnd, fileCount: 1 });
    expect(md).not.toMatch(/\.\.(?!\.)/);
  });
});

describe('build kits', () => {
  const rebuilds = MERCHANTS.filter((m) => m.plans.rebuild);
  const selfhosts = MERCHANTS.filter((m) => m.plans.selfhost);
  const NETWORK = /(?<!web |service )\bworkers?\b|\b(?:D1|R2|KV|FastAPI|Python|OAuth|Sheets|Calendar API|Resend|Open Food Facts|USDA|GitHub Actions|Wrangler|cron|webhooks?|email API|model downloads?)\b/i;

  it('has rebuild and self-host plans to test against', () => {
    expect(rebuilds.length).toBeGreaterThanOrEqual(30);
    expect(selfhosts.length).toBeGreaterThanOrEqual(15);
  });

  it('every kit is free of doubled periods, nested cost parentheses and unresolved text', () => {
    const problems: string[] = [];
    for (const [list, verdict] of [[rebuilds, 'rebuild'], [selfhosts, 'selfhost']] as const) {
      for (const m of list) {
        const kit = kitFor(m, verdict);
        if (!kit) {
          problems.push(`${m.id}/${verdict}: no kit`);
          continue;
        }
        const prose = kit.replace(/```[\s\S]*?```/g, ''); // the kickoff prompt is KB text, checked elsewhere
        if (/\.\.(?!\.)/.test(prose)) problems.push(`${m.id}/${verdict}: doubled period`);
        if (/\(\$[\d,.]+\/\w+ \(/.test(prose)) problems.push(`${m.id}/${verdict}: nested parentheses in cost`);
        if (/undefined|NaN|\[object/.test(kit)) problems.push(`${m.id}/${verdict}: bad value`);
        if (!/the prompt wins/i.test(prose)) problems.push(`${m.id}/${verdict}: does not say the prompt wins`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('never gives standing rules that the kickoff prompt contradicts (rebuild)', () => {
    const problems: string[] = [];
    for (const m of rebuilds) {
      const p = m.plans.rebuild!;
      const kit = kitFor(m, 'rebuild')!;
      const prose = kit.replace(/```[\s\S]*?```/g, '');
      const text = `${p.runsOn}\n${p.prompt}`;
      if (/no third-party requests/i.test(prose) && NETWORK.test(text)) problems.push(`${m.id}: "no third-party requests" but the plan needs the network`);
      if (/data stays on my device/i.test(prose) && NETWORK.test(text)) problems.push(`${m.id}: "data stays on my device" but the plan needs a server`);
      if (/TypeScript, strict/.test(prose) && /\bPython\b/i.test(p.prompt)) problems.push(`${m.id}: TypeScript rule for a Python prompt`);
      if (/TypeScript, strict/.test(prose) && !/\bTypeScript\b/i.test(p.prompt)) problems.push(`${m.id}: TypeScript rule the prompt never asks for`);
      if (/work offline/i.test(prose) && !/\boffline\b/i.test(text) && !isLocalFirst(p.runsOn, p.prompt)) problems.push(`${m.id}: offline rule the plan never asks for`);
    }
    expect(problems).toEqual([]);
  });

  it('the examples from the review no longer contradict their prompts', () => {
    const otter = kitFor(byId('otter-ai'), 'rebuild')!;
    expect(otter).toContain('Python 3.11'); // the prompt
    expect(otter).not.toContain('TypeScript');
    expect(otter).not.toMatch(/no analytics|no third-party requests|no accounts/i);

    const calendly = kitFor(byId('calendly-standard'), 'rebuild')!;
    expect(calendly).not.toMatch(/no third-party requests|data stays on my device/i);

    const zapier = kitFor(byId('zapier'), 'rebuild')!;
    expect(zapier).not.toMatch(/no third-party requests|work offline/i);
    expect(zapier).toContain('Replace Zapier ($19.99/mo, $239.88/yr)'); // one pair of parentheses, not "($19.99/mo ($239.88/yr))"
    expect(zapier).not.toContain('..');

    const linktree = kitFor(byId('linktree-pro'), 'rebuild')!;
    expect(linktree).not.toMatch(/no analytics/i); // its own prompt counts clicks

    const squarespace = kitFor(byId('squarespace'), 'rebuild')!;
    expect(squarespace).not.toMatch(/on my device|work offline/i); // a public static site
  });

  it('keeps the on-device rules for the local-first apps that really are local-first', () => {
    for (const id of ['huckleberry', 'habitify', 'quizlet-plus', 'adobe-acrobat-pro', 'fitbod', 'zero-fasting', 'ynab']) {
      const m = byId(id);
      if (!m.plans.rebuild) continue;
      const kit = kitFor(m, 'rebuild')!;
      expect(kit, id).toContain('Data stays on my device');
      expect(kit, id).toContain('No analytics, no third-party requests, no accounts.');
      expect(kit, id).toContain('Core features work offline.');
      expect(kit, id).toContain('TypeScript, strict.');
    }
  });

  it('classifies the whole catalog sensibly', () => {
    const local = rebuilds.filter((m) => isLocalFirst(m.plans.rebuild!.runsOn, m.plans.rebuild!.prompt)).map((m) => m.id);
    // services that talk to a server, a third-party API or download a model are never local-first
    // (the catalog is still being edited, so this names only services whose prompt itself calls for Python, a Worker or an API)
    for (const id of ['fireflies-ai', 'otter-ai', 'sanebox', 'ifttt-pro', 'zapier', 'make', 'calendly-standard', 'typeform', 'bitly-core', 'linktree-pro', 'loom']) {
      expect(local, id).not.toContain(id);
    }
    for (const id of ['huckleberry', 'habitify', 'quizlet-plus', 'adobe-acrobat-pro']) {
      expect(local, id).toContain(id);
    }
  });

  it('self-host kits follow their own prompt about remote access and Docker', () => {
    const problems: string[] = [];
    for (const m of selfhosts) {
      const p = m.plans.selfhost!;
      const kit = kitFor(m, 'selfhost')!;
      const text = `${p.software.join(' ')} ${p.prompt}`;
      if (/port[- ]forward/i.test(text)) {
        if (kit.includes('no router ports opened')) problems.push(`${m.id}: says no router ports, but its prompt asks for a port forward`);
        if (!/one UDP port forward/.test(kit)) problems.push(`${m.id}: does not mention the port forward its prompt asks for`);
      } else if (/Tailscale/i.test(text) && !kit.includes('Tailscale; no router ports opened')) {
        problems.push(`${m.id}: lost the Tailscale-only rule`);
      }
      if (!/\bDocker\b/i.test(text) && kit.includes('Docker Compose')) problems.push(`${m.id}: Docker rule for a non-Docker install`);
    }
    expect(problems).toEqual([]);
  });

  it('absorb cards have a kit too', () => {
    const m = MERCHANTS.find((x) => x.plans.absorb && x.verdict === 'absorb')!;
    const kit = kitFor(m, 'absorb');
    expect(kit).toContain('## Prompt');
    expect(kit).not.toContain('..');
  });
});
