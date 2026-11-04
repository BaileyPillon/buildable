// Regression tests for the knowledge-base fixes that came out of the holdout evaluation, the verdict-truthfulness
// review and the prompt-quality review (finding ids in the test names). They read the REAL KB (src/kb/merchants.json),
// so a later edit that brings a bug back fails here. Schema, policy and pattern-collision rules live in
// scripts/validate-kb.mjs; this file covers what those cannot: engine behaviour against the real catalog and
// content rules that need a sentence-level check.
import { describe, expect, it } from 'vitest';
import type { Merchant } from '../types';
import { MERCHANTS } from '../kb';
import { bundleCandidates, matchMerchant } from '../engine/match';
import { normalizeDescriptor } from '../engine/normalize';
import { findRecurring } from '../engine/recurring';

const byId = (id: string): Merchant => {
  const m = MERCHANTS.find((x) => x.id === id);
  if (!m) throw new Error(`no KB merchant ${id}`);
  return m;
};
const idOf = (raw: string, amount?: number): string | null =>
  matchMerchant(MERCHANTS, normalizeDescriptor(raw), raw.toUpperCase(), amount)?.id ?? null;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const selfhostOf = (m: Merchant) => m.plans.selfhost;

describe('descriptor matching on unseen statements (HO-05, HO-06, HO-08)', () => {
  it('HO-05: "GOOGLE *Google One" matches Google One and offers it for the $2.99 tier', () => {
    const raw = 'GOOGLE *Google One g.co/helppay#CA';
    expect(idOf(raw, 2.99)).toBe('google-one');
    expect(bundleCandidates(MERCHANTS, 'google', 2.99, 'monthly')).toContain('google-one');
  });

  it('HO-05: Google AI Pro and Google One AI Premium stay with google-ai-pro, not google-one', () => {
    expect(idOf('GOOGLE *Google AI Pro g.co/helppay#CA', 19.99)).toBe('google-ai-pro');
    expect(idOf('GOOGLE *Google One AI Premium g.co/helppay#CA', 19.99)).toBe('google-ai-pro');
    expect(idOf('GOOGLE *Google One g.co/helppay#CA', 9.99)).toBe('google-one');
    expect(idOf('GOOGLE *Nest Aware g.co/helppay#CA', 8)).toBe('google-nest-aware');
  });

  it('HO-06: Peacock billed through PayPal matches, and the existing forms still do', () => {
    expect(idOf('PAYPAL *PEACOCK 402-935-7733 CA')).toBe('peacock');
    expect(idOf('PEACOCKTV.COM NEW YORK NY')).toBe('peacock');
    expect(idOf('PEACOCK PREMIUM NEW YORK NY')).toBe('peacock');
  });

  it('HO-08: Philo, Garmin Connect+ and Optimum printed forms match; Optimum Nutrition does not', () => {
    expect(idOf('PHILO NEW YORK NY')).toBe('philo');
    expect(idOf('PHILO.COM NEW YORK NY')).toBe('philo');
    expect(idOf('PHILOSOPHY SKINCARE NEW YORK NY')).toBeNull();
    expect(idOf('GARMIN INTERNATIONAL OLATHE KS')).toBe('garmin-connect-plus');
    expect(idOf('OPTIMUM BETHPAGE NY')).toBe('optimum');
    expect(idOf('OPTIMUM NUTRITION GOLD STANDARD')).toBeNull();
    expect(idOf('OPTIMUM CAFE BROOKLYN NY')).toBeNull();
  });
});

describe('single annual charges are detected for KB merchants with an annual price hint (HO-04)', () => {
  // [merchant id, annual amounts that must be recognised]. Amounts come from the official pricing page or from
  // consistent sources listed in the entry's `sources`.
  const cases: [string, number[]][] = [
    ['ynab', [109]],
    ['bitwarden-premium', [19.8, 47.88]],
    ['masterclass', [120, 180, 240]],
    ['1password', [47.88, 35.88, 71.88, 53.88]],
    ['expressvpn', [99.95, 119.95, 199.95]],
    ['proton', [119.88, 47.88]],
    ['lastpass', [36, 48]],
    ['dashlane', [59.88, 89.88]],
    ['grammarly-pro', [144]],
    ['todoist-pro', [60]],
    ['coursera-plus', [399]],
    ['microsoft-365', [99.99, 129.99]],
    ['backblaze-personal', [99]],
    ['dropbox-plus', [119.88]],
    ['ring-protect', [49.99, 99.99, 199.99]],
    ['norton-360', [49.99, 119.99, 124.99]],
    ['malwarebytes-premium', [44.99]],
    ['github-pro', [48]],
    ['github-copilot', [100]],
    ['namecheap', [19.98, 15.98]],
    ['pluralsight', [299, 449]],
    ['babbel', [107.4]],
    ['figma', [192]],
    ['wix', [213.24, 357.24, 477.24]],
    ['squarespace', [228, 348]],
    ['claude-pro', [200]],
  ];
  for (const [id, amounts] of cases) {
    it(`${id}: ${amounts.map((a) => `$${a}`).join(', ')}`, () => {
      const m = byId(id);
      const raw = m.match.examples[0];
      for (const amount of amounts) {
        expect(
          m.match.priceHints?.some((h) => h.cadence === 'annual' && Math.abs(h.amount - amount) < 0.005),
          `${id} has an annual hint for ${amount}`,
        ).toBe(true);
        const series = findRecurring([{ date: '2026-06-15', description: raw, amount }], MERCHANTS);
        expect(series.map((s) => s.merchantId), `${id} @ ${amount} from "${raw}"`).toEqual([id]);
        expect(series[0].cadence).toBe('annual');
        expect(series[0].annualCost).toBeCloseTo(amount, 2);
      }
    });
  }

  it('the holdout descriptors for YNAB, Bitwarden Premium and MasterClass are found', () => {
    const one = (description: string, amount: number) => findRecurring([{ date: '2026-03-02', description, amount }], MERCHANTS).map((s) => s.merchantId);
    expect(one('Recurring Card Purchase 01/20 YNAB.COM SALT LAKE CITY UT Card 4567', 109)).toEqual(['ynab']);
    expect(one('BITWARDEN INC SANTA BARBARA CA', 19.8)).toEqual(['bitwarden-premium']);
    expect(one('MASTERCLASS.COM SAN FRANCISCO CA', 120)).toEqual(['masterclass']);
  });

  it('a one-off charge that is not an annual price is still ignored', () => {
    expect(findRecurring([{ date: '2026-03-02', description: 'YNAB.COM SALT LAKE CITY UT', amount: 31.5 }], MERCHANTS)).toEqual([]);
  });
});

describe('KB patterns stay cheap on hostile descriptors (ROB-4)', () => {
  // strip escapes and character classes, then look for an unbounded gap
  const unbounded = (source: string) => /\.[*+]/.test(source.replace(/\\./g, '').replace(/\[[^\]]*\]/g, ''));

  it('no pattern uses an unbounded .* or .+ gap', () => {
    const bad: string[] = [];
    for (const m of MERCHANTS) for (const p of m.match.patterns) if (unbounded(p)) bad.push(`${m.id}: /${p}/`);
    expect(bad).toEqual([]);
  });

  it('every pattern runs in well under a second on a 100,000-character descriptor', () => {
    const slow: string[] = [];
    for (const m of MERCHANTS) {
      for (const p of m.match.patterns) {
        const re = new RegExp(p, 'i');
        const lead = /[A-Z0-9]{3,}/i.exec(p)?.[0].toUpperCase() ?? 'ABC';
        const inputs = [' A'.repeat(50_000), `${lead} `.repeat(Math.ceil(100_000 / (lead.length + 1)))];
        for (const input of inputs) {
          const t0 = performance.now();
          re.test(input);
          const ms = performance.now() - t0;
          if (ms > 400) slow.push(`${m.id} /${p}/ took ${Math.round(ms)} ms`);
        }
      }
    }
    expect(slow).toEqual([]);
  });
});

describe('verdict truthfulness (F1 to F16)', () => {
  it('F1: ChatGPT Pro is keep, with absorb only as a chip that tells the user to test first', () => {
    const m = byId('chatgpt-pro');
    expect(m.verdict).toBe('keep');
    expect(m.also).toEqual(['absorb', 'cancel']);
    expect(m.plans.absorb?.howTo).toMatch(/ceiling/);
    expect(m.plans.absorb?.howTo).toMatch(/Max|Ultra/);
  });

  it('F2: bundles and non-replacements offer no absorb chip (no honest absorb saving)', () => {
    for (const id of ['google-ai-pro', 'microsoft-copilot-pro', 'replika', 'github-copilot', 'writesonic']) {
      const m = byId(id);
      expect(m.also ?? [], id).not.toContain('absorb');
      expect(m.plans.absorb, `${id} keeps no dead absorb plan`).toBeUndefined();
    }
  });

  it('F2/F14: every VPN self-host plan says what it does not replace, and its power cost matches its hardware', () => {
    for (const id of ['nordvpn', 'expressvpn', 'surfshark', 'private-internet-access']) {
      const s = selfhostOf(byId(id))!;
      expect(s.youLose, id).toMatch(/home IP|your home IP/);
      expect(s.hardware, id).not.toContain('spare-pc');
    }
    expect(selfhostOf(byId('private-internet-access'))!.hardware).toEqual(['raspberry-pi']);
    expect(byId('private-internet-access').why).not.toMatch(/electricity cost of a home server/);
  });

  it('F3: therapy services warn about continuity of care and offer no cancel chip', () => {
    for (const id of ['betterhelp', 'talkspace']) {
      const m = byId(id);
      expect(m.plans.cancel.gotchas, id).toMatch(/tell your therapist before stopping/);
      expect(m.plans.cancel.gotchas, id).toMatch(/988/);
      expect(m.also ?? [], id).not.toContain('cancel');
    }
  });

  it('F4/R7: self-host plans that require an off-site copy count its cost, so the saving is not just electricity', () => {
    for (const id of ['dropbox-plus', 'flickr-pro', 'google-one', 'icloud-plus', 'digitalocean']) {
      const s = selfhostOf(byId(id))!;
      expect(s.prompt, id).toMatch(/off-?site/i);
      expect(s.powerCostYear, id).toBeGreaterThanOrEqual(26);
    }
    expect(selfhostOf(byId('dropbox-plus'))!.youLose).toMatch(/2 TB library would cost about \$167/);
    expect(byId('icloud-plus').why).not.toMatch(/only pays at 2 TB/);
  });

  it('F5/F6: Dropbox Plus and Monarch Money are keep, with self-host as a chip', () => {
    for (const id of ['dropbox-plus', 'monarch-money']) {
      const m = byId(id);
      expect(m.verdict, id).toBe('keep');
      expect(m.also, id).toContain('selfhost');
    }
    expect(byId('monarch-money').why).not.toMatch(/covers most of what Monarch does/);
    expect(byId('ynab').verdict).toBe('selfhost');
  });

  it('F7: Fabulous is a rebuild, and no absorb prompt asks Claude to start a conversation or edit Project instructions', () => {
    const f = byId('fabulous');
    expect(f.verdict).toBe('rebuild');
    expect(f.also).toEqual(['absorb', 'cancel']);
    const prompt = f.plans.absorb!.prompt;
    expect(prompt).not.toMatch(/Each time I open this chat|Every Sunday|Save the plan in this Project/);
    expect(prompt).toMatch(/When I say check-in/);
    expect(byId('headway').plans.absorb!.prompt).not.toMatch(/quiz me on the cards the next day/);
  });

  it('F8: the X Subscription bundle (Grok, Cursor, X Premium) is matched and disclosed', () => {
    expect(idOf('X SUBSCRIPTION CORP. SAN FRANCISCO CA', 30)).toBe('x-premium');
    expect(idOf('CLAUDE.AI MAX SUBSCRIPTION ANTHROPIC.COM CA')).toBe('claude-max');
    const x = byId('x-premium');
    expect(x.why).toMatch(/Grok/);
    expect(x.plans.cancel.gotchas).toMatch(/Grok and Cursor/);
    expect(byId('cursor').plans.cancel.gotchas).toMatch(/X SUBSCRIPTION CORP/);
  });

  it('F10: Cursor limits no longer say Claude has no cloud tasks', () => {
    const limits = byId('cursor').plans.absorb!.limits;
    expect(limits).not.toMatch(/background cloud agents/);
    expect(limits).toMatch(/cloud and scheduled tasks/);
  });

  it('F11/R5: the Plex Pass prompt does not claim Roku cannot run Jellyfin, and backs up Jellyfin', () => {
    const p = selfhostOf(byId('plex-pass'))!;
    expect(p.prompt).not.toMatch(/Roku and most smart TVs cannot/);
    expect(p.prompt).toMatch(/Roku and LG webOS have clients/);
    expect(p.prompt).toMatch(/backup of Jellyfin/);
    expect(p.powerCostYear).toBe(0);
  });

  it('F12/R13: the iCloud+ prompt handles Advanced Data Protection and per-album downloads', () => {
    const p = selfhostOf(byId('icloud-plus'))!;
    expect(p.prompt).toMatch(/Advanced Data Protection/);
    expect(p.prompt).toMatch(/--album/);
    expect(p.youLose).toMatch(/Advanced Data Protection/);
    expect(p.prompt).not.toMatch(/keeping dates and albums/);
  });

  it('F13: absorb limits for DeepL, Jasper and Grammarly mention the Help improve Claude setting', () => {
    for (const id of ['deepl-pro', 'jasper', 'grammarly-pro']) {
      expect(byId(id).plans.absorb!.limits, id).toMatch(/Help improve Claude/);
    }
  });

  it('F14: a plan that lists a spare desktop prices its power like one, unless the host already runs the service', () => {
    for (const m of MERCHANTS) {
      const s = selfhostOf(m);
      if (!s || !s.hardware.includes('spare-pc')) continue;
      expect(m.id === 'plex-pass' || s.powerCostYear >= 60, `${m.id} lists spare-pc at $${s.powerCostYear} a year`).toBe(true);
    }
    for (const id of ['ynab', 'copilot-money', 'monarch-money']) expect(selfhostOf(byId(id))!.powerCostYear, id).toBe(37);
  });

  it('F15: Headspace is a rotate item, like Ten Percent Happier', () => {
    expect(byId('headspace').verdict).toBe('rotate');
    expect(byId('headspace').also).toContain('cancel');
    expect(byId('ten-percent-happier').verdict).toBe('rotate');
  });

  it('F16: ChatPDF does not present 1,000 pages as the working capacity', () => {
    const m = byId('chatpdf');
    expect(m.why).toMatch(/accepts PDFs of up to 1,000 pages/);
    expect(m.plans.absorb!.limits).toMatch(/exceed the conversation length/);
  });
});

describe('prompt quality (R2 to R16)', () => {
  const buildPrompts = MERCHANTS.flatMap((m) =>
    (['rebuild', 'selfhost'] as const).flatMap((k) => (m.plans[k] ? [{ id: m.id, kind: k, prompt: m.plans[k]!.prompt }] : [])),
  );

  it('R3: no rebuild or self-host prompt ships a bracket placeholder the UI cannot fill', () => {
    const bad = buildPrompts.filter((p) => /\[[^\]]+\]/.test(p.prompt)).map((p) => `${p.id}.${p.kind}: ${p.prompt.match(/\[[^\]]+\]/g)!.join(' ')}`);
    expect(bad).toEqual([]);
  });

  it('R15: every self-host prompt says where Claude Code runs', () => {
    const missing = buildPrompts
      .filter((p) => p.kind === 'selfhost')
      .filter((p) => !/I am running you on the target machine|I will run you on the home machine/.test(p.prompt))
      .map((p) => p.id);
    expect(missing).toEqual([]);
  });

  it('every prompt is 80 to 180 words (the SPEC limit)', () => {
    for (const p of buildPrompts) {
      const w = words(p.prompt);
      expect(w >= 80 && w <= 180, `${p.id}.${p.kind} has ${w} words`).toBe(true);
    }
  });

  it('R2: the Calendly prompt moves the Google OAuth consent screen out of Testing', () => {
    const p = byId('calendly-standard').plans.rebuild!;
    expect(p.prompt).toMatch(/In production/);
    expect(p.prompt).toMatch(/7 days/);
    expect(p.prompt).toMatch(/invalid_grant/);
    expect(p.youLose).toMatch(/Testing to In production/);
  });

  it('R4: the SaneBox prompt uses OAuth2 for Outlook instead of app passwords', () => {
    const p = byId('sanebox').plans.rebuild!;
    expect(p.prompt).toMatch(/XOAUTH2/);
    expect(p.prompt).toMatch(/Gmail app password/);
    expect(p.runsOn).not.toMatch(/an app password or OAuth/);
    expect(p.hours).toBeGreaterThanOrEqual(9);
  });

  it('R6: polling automations run on Cloudflare Cron Triggers, not on GitHub Actions cron alone', () => {
    for (const id of ['zapier', 'ifttt-pro']) {
      const r = byId(id).plans.rebuild!;
      expect(r.prompt, id).toMatch(/Cron Triggers/);
      expect(r.prompt, id).toMatch(/up to five/);
      expect(r.runsOn, id).toMatch(/Cron Triggers/);
    }
    expect(byId('zapier').plans.rebuild!.runsOn).not.toMatch(/free minutes on a private repo\)/);
    expect(byId('make').plans.rebuild!.prompt).toMatch(/up to five scenarios/);
  });

  it('R9: every import-from-export rebuild tells the user to export before cancelling', () => {
    const ids = ['fitbod', 'glow-baby', 'huckleberry', 'lose-it-premium', 'myfitnesspal-premium', 'rise-science', 'yazio-pro', 'zero-fasting', 'habitify', 'quizlet-plus'];
    for (const id of ids) {
      const c = byId(id).plans.cancel;
      expect(`${c.howTo} ${c.gotchas ?? ''}`, id).toMatch(/export/i);
      expect(c.gotchas, id).toMatch(/until the import is verified/);
    }
    expect(byId('myfitnesspal-premium').plans.cancel.gotchas).toMatch(/Premium feature/);
    expect(byId('myfitnesspal-premium').plans.rebuild!.prompt).toMatch(/before I cancel/);
  });

  it('R10: the YNAB rebuild covers credit cards, transfers and splits, and 12 hours', () => {
    const r = byId('ynab').plans.rebuild!;
    expect(r.hours).toBe(12);
    expect(r.prompt).toMatch(/credit card/);
    expect(r.prompt).toMatch(/transfers/);
    expect(r.prompt).toMatch(/split/);
    expect(r.youLose).toMatch(/credit card handling is the hardest part/i);
  });

  it('R11: import steps name the real export formats', () => {
    expect(byId('fireflies-ai').plans.rebuild!.prompt).toMatch(/DOCX, SRT or JSON/);
    expect(byId('todoist-pro').plans.rebuild!.prompt).toMatch(/one file per project/);
    expect(byId('toggl-track').plans.rebuild!.prompt).toMatch(/Start date, Start time, End date, End time, Duration, Tags/);
    expect(byId('lose-it-premium').plans.rebuild!.prompt).toMatch(/free USDA API key/);
    expect(byId('linktree-pro').plans.rebuild!.prompt).toMatch(/^First ask me to paste my current links/);
    expect(byId('typeform').plans.rebuild!.prompt).toMatch(/^First ask me to paste my questions/);
  });

  it('R12: whatYouBuild and runsOn match their prompts', () => {
    expect(byId('bitly-core').plans.rebuild!.whatYouBuild).toMatch(/secret admin token/);
    expect(byId('bitly-core').plans.rebuild!.prompt).not.toMatch(/bring over my existing Bitly links/);
    expect(byId('toggl-track').plans.rebuild!.runsOn).not.toMatch(/sync file/);
    expect(byId('readwise').plans.rebuild!.runsOn).not.toMatch(/email/i);
    expect(byId('linktree-pro').why).toMatch(/about four hours/);
    expect(byId('smugmug').plans.rebuild!.prompt).toMatch(/noindex/);
  });

  it('R14: the Wyze Cam Plus plan states the breakeven', () => {
    expect(byId('wyze-cam-plus').why).toMatch(/3 or more cameras/);
    expect(selfhostOf(byId('wyze-cam-plus'))!.prompt).toMatch(/3 or more cameras/);
  });

  it('R16: Loom prefers MP4, and Speechify is estimated at 12 hours', () => {
    expect(byId('loom').plans.rebuild!.prompt).toMatch(/MP4 H\.264/);
    expect(byId('speechify').plans.rebuild!.hours).toBe(12);
  });
});
