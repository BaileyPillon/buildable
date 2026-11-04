// Matching specificity: among all merchants whose patterns match, the longest regex span wins; ties go to the
// priceHint closest to the charge amount, then to KB order. Sibling plans are checked against the REAL KB.
import { describe, expect, it } from 'vitest';
import type { Merchant, Txn } from '../types';
import { MERCHANTS } from '../kb';
import { matchMerchant } from './match';
import { normalizeDescriptor } from './normalize';
import { findRecurring } from './recurring';

const idOf = (raw: string, amount?: number): string | null =>
  matchMerchant(MERCHANTS, normalizeDescriptor(raw), raw.toUpperCase(), amount)?.id ?? null;

/** Minimal KB entry: the matcher and the recurrence engine only read id, name, category and `match`. */
function fake(id: string, patterns: string[], priceHints?: Merchant['match']['priceHints']): Merchant {
  return {
    id,
    name: id,
    category: 'productivity',
    match: { patterns, examples: [], ...(priceHints ? { priceHints } : {}) },
  } as unknown as Merchant;
}

describe('matchMerchant: longest span, then closest priceHint, then KB order', () => {
  it('prefers the pattern that covers more of the descriptor, whatever the KB order', () => {
    const generic = fake('acme', ['ACME']);
    const specific = fake('acme-pro', ['ACME PRO']);
    expect(matchMerchant([generic, specific], 'ACME PRO ANNUAL', 'ACME PRO ANNUAL')?.id).toBe('acme-pro');
    expect(matchMerchant([specific, generic], 'ACME PRO ANNUAL', 'ACME PRO ANNUAL')?.id).toBe('acme-pro');
    expect(matchMerchant([specific, generic], 'ACME BASIC', 'ACME BASIC')?.id).toBe('acme');
  });

  it('measures the span of a merchant by its best pattern', () => {
    const multi = fake('multi', ['ZZZ', 'ACME PRO PLAN']);
    const other = fake('other', ['ACME PRO']);
    expect(matchMerchant([other, multi], 'ACME PRO PLAN', 'ACME PRO PLAN')?.id).toBe('multi');
  });

  it('breaks an equal span by the priceHint closest to the charge amount', () => {
    const plus = fake('plus', ['ACME'], [
      { amount: 20, cadence: 'monthly', plan: 'p' },
      { amount: 200, cadence: 'annual', plan: 'q' },
    ]);
    const pro = fake('pro', ['ACME'], [{ amount: 100, cadence: 'monthly', plan: 'p' }]);
    expect(matchMerchant([plus, pro], 'ACME', 'ACME', 20)?.id).toBe('plus');
    expect(matchMerchant([plus, pro], 'ACME', 'ACME', 99)?.id).toBe('pro');
    expect(matchMerchant([pro, plus], 'ACME', 'ACME', 199)?.id).toBe('plus');
    expect(matchMerchant([pro, plus], 'ACME', 'ACME', 105)?.id).toBe('pro');
  });

  it('falls back to KB order without an amount, without hints, or when distances are equal', () => {
    const a = fake('a', ['ACME'], [{ amount: 20, cadence: 'monthly', plan: 'p' }]);
    const b = fake('b', ['ACME'], [{ amount: 100, cadence: 'monthly', plan: 'p' }]);
    const c = fake('c', ['ACME']);
    expect(matchMerchant([b, a], 'ACME', 'ACME')?.id).toBe('b'); // amount unknown
    expect(matchMerchant([c, a], 'ACME', 'ACME', 20)?.id).toBe('a'); // no hints loses to a hint
    expect(matchMerchant([c, fake('d', ['ACME'])], 'ACME', 'ACME', 20)?.id).toBe('c'); // nobody has hints
    expect(matchMerchant([a, b], 'ACME', 'ACME', 60)?.id).toBe('a'); // 40 and 40 apart
  });

  it('span beats priceHints, and the normalized descriptor beats the raw fallback', () => {
    const near = fake('near', ['ACME'], [{ amount: 20, cadence: 'monthly', plan: 'p' }]);
    const long = fake('long', ['ACME GOLD'], [{ amount: 500, cadence: 'monthly', plan: 'p' }]);
    expect(matchMerchant([near, long], 'ACME GOLD', 'ACME GOLD', 20)?.id).toBe('long');
    // matches only the raw string: used when nothing matches the normalized one
    const rawOnly = fake('raw', ['CRYPTIC123']);
    expect(matchMerchant([rawOnly], 'CRYPTIC', 'CRYPTIC123')?.id).toBe('raw');
    const normHit = fake('norm', ['CRYPTIC']);
    expect(matchMerchant([rawOnly, normHit], 'CRYPTIC', 'CRYPTIC123')?.id).toBe('norm');
  });

  it('survives merchants with a broken pattern or no patterns at all', () => {
    const broken = fake('broken', ['(']);
    const empty = { id: 'empty', match: { examples: [] } } as unknown as Merchant;
    expect(matchMerchant([broken, empty, fake('ok', ['ACME'])], 'ACME', 'ACME', 5)?.id).toBe('ok');
    expect(matchMerchant([broken, empty], 'ACME', 'ACME')).toBeNull();
  });

  it('routes each charge of one descriptor to the plan whose price it is, end to end', () => {
    const kb = [
      fake('acme-lite', ['ACME'], [{ amount: 10, cadence: 'monthly', plan: 'Lite' }]),
      fake('acme-max', ['ACME'], [{ amount: 100, cadence: 'monthly', plan: 'Max' }]),
    ];
    const txns: Txn[] = [];
    for (let m = 0; m < 6; m++) {
      const mm = String(m + 1).padStart(2, '0');
      txns.push({ date: `2026-${mm}-05`, description: 'ACME SUBSCRIPTION', amount: 10 });
      txns.push({ date: `2026-${mm}-20`, description: 'ACME SUBSCRIPTION', amount: 100 });
    }
    const series = findRecurring(txns, kb);
    expect(series.map((s) => [s.merchantId, s.currentAmount]).sort()).toEqual([['acme-lite', 10], ['acme-max', 100]]);
  });
});

describe('real KB: sibling plans resolve to the right merchant', () => {
  it('Microsoft 365 vs Copilot Pro / Microsoft 365 Premium vs OneDrive', () => {
    expect(idOf('MICROSOFT*MICROSOFT 365 PERSONAL MSBILL.INFO WA', 9.99)).toBe('microsoft-365');
    expect(idOf('MSFT *MICROSOFT 365 FAMILY MSBILL.INFO WA', 12.99)).toBe('microsoft-365');
    expect(idOf('MICROSOFT*COPILOT PRO MSBILL.INFO WA', 19.99)).toBe('microsoft-copilot-pro');
    expect(idOf('MICROSOFT*M365 PREMIUM MSBILL.INFO WA', 19.99)).toBe('microsoft-copilot-pro');
    // matches both merchants' patterns: the longer span (Copilot Pro) wins over the bare "MICROSOFT 365"
    expect(idOf('MICROSOFT 365 PREMIUM (FORMERLY COPILOT PRO)', 19.99)).toBe('microsoft-copilot-pro');
    expect(idOf('MICROSOFT*ONEDRIVE 100GB WA', 1.99)).toBe('onedrive');
    expect(idOf('GITHUB COPILOT SAN FRANCISCO CA', 10)).toBe('github-copilot');
    expect(idOf('COPILOT MONEY', 9)).toBe('copilot-money');
  });

  it('ChatGPT Plus vs Pro', () => {
    expect(idOf('OPENAI *CHATGPT SUBSCR SAN FRANCISCO CA', 20)).toBe('chatgpt-plus');
    expect(idOf('OPENAI *CHATGPT SUBSCR OPENAI.COM CA', 22.4)).toBe('chatgpt-plus'); // with sales tax
    expect(idOf('OPENAI *CHATGPT PRO SAN FRANCISCO CA', 200)).toBe('chatgpt-pro');
    expect(idOf('OPENAI *CHATGPT PRO SUBSCR OPENAI.COM CA', 200)).toBe('chatgpt-pro');
    // the descriptor decides: the amount alone never turns a Plus descriptor into Pro (neither entry has priceHints)
    expect(idOf('OPENAI *CHATGPT SUBSCR SAN FRANCISCO CA', 200)).toBe('chatgpt-plus');
  });

  it('Claude Pro vs Max at $20 / $100 / $200', () => {
    for (const amount of [20, 100, 200]) {
      expect(idOf('CLAUDE.AI SUBSCRIPTION ANTHROPIC.COM CA', amount), `pro @${amount}`).toBe('claude-pro');
    }
    for (const amount of [100, 200]) {
      expect(idOf('CLAUDE.AI MAX SUBSCRIPTION ANTHROPIC.COM CA', amount), `max @${amount}`).toBe('claude-max');
      expect(idOf('ANTHROPIC CLAUDE MAX SAN FRANCISCO CA', amount), `max @${amount}`).toBe('claude-max');
    }
    expect(idOf('ANTHROPIC CLAUDE PRO SAN FRANCISCO CA', 20)).toBe('claude-pro');
    expect(idOf('ANTHROPIC CLAUDE SAN FRANCISCO CA', 20)).toBe('claude-pro');
  });

  it('YouTube Premium vs YouTube TV vs YouTube Music', () => {
    expect(idOf('GOOGLE *YOUTUBEPREMIUM G.CO/HELPPAY# CA', 15.99)).toBe('youtube-premium');
    expect(idOf('GOOGLE *YOUTUBE PREMIUM G.CO/HELPPAY# CA', 15.99)).toBe('youtube-premium');
    expect(idOf('GOOGLE *YOUTUBETV G.CO/HELPPAY# CA', 82.99)).toBe('youtube-tv');
    expect(idOf('GOOGLE *YOUTUBE TV G.CO/HELPPAY# CA', 82.99)).toBe('youtube-tv');
    expect(idOf('GOOGLE *YOUTUBE MUSIC G.CO/HELPPAY# CA', 11.99)).toBe('youtube-music');
    expect(idOf('GOOGLE *YOUTUBEMUSIC G.CO/HELPPAY# CA', 11.99)).toBe('youtube-music');
    expect(idOf('GOOGLE *YOUTUBE MUSIC PREMIUM G.CO/HELPPAY# CA', 11.99)).toBe('youtube-music');
  });

  it('Amazon Prime vs Prime Video Channels vs Amazon Music', () => {
    expect(idOf('AMAZON PRIME*2K4TY87 AMZN.COM/BILL WA', 14.99)).toBe('amazon-prime');
    expect(idOf('AMZN PRIME MEMBERSHIP AMZN.COM/BILL WA', 139)).toBe('amazon-prime');
    expect(idOf('PRIME MEMBERSHIP AMZN.COM/BILL WA', 139)).toBe('amazon-prime');
    expect(idOf('PRIMEVIDEO CHANNELS SEATTLE WA', 8.99)).toBe('prime-video-channels');
    expect(idOf('AMAZON PRIME VIDEO CHANNELS', 8.99)).toBe('prime-video-channels');
    expect(idOf('AMAZON CHANNELS 888-802-3080 WA', 8.99)).toBe('prime-video-channels');
    expect(idOf('AMAZON MUSIC UNLIMITED WA', 11.99)).toBe('amazon-music-unlimited');
    expect(idOf('AMZN MUSIC*RT4HJ8K20 WA', 11.99)).toBe('amazon-music-unlimited');
    expect(idOf('AMZN MKTP US*2K4TY87 AMZN.COM/BILL WA', 23.18)).toBeNull(); // marketplace purchases are not subscriptions
  });

  it('Google One vs Google AI Pro', () => {
    expect(idOf('GOOGLE *GOOGLE STORAGE', 1.99)).toBe('google-one');
    expect(idOf('GOOGLE *GOOGLE ONE BASIC G.CO/HELPPAY# CA', 1.99)).toBe('google-one');
    expect(idOf('GOOGLE *GOOGLE AI PRO G.CO/HELPPAY# CA', 19.99)).toBe('google-ai-pro');
    expect(idOf('GOOGLE *GEMINI ADVANCED', 19.99)).toBe('google-ai-pro');
  });

  it('every KB example resolves to its own merchant, at its typical price and with no amount', () => {
    const wrong: string[] = [];
    for (const m of MERCHANTS) {
      for (const ex of m.match.examples) {
        for (const amount of [undefined, m.typicalMonthly ?? undefined]) {
          const got = idOf(ex, amount);
          if (got !== m.id) wrong.push(`${ex} @${amount} -> ${got} (want ${m.id})`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});
