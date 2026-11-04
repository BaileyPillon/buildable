// Small pure pieces: messages, source links, drag detection, card naming, deploy config and colour contrast.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Context, RecurringSeries } from '../types';
import { MERCHANTS } from '../kb';
import { REPO_URL, sourceLinks } from './config';
import { DEFAULT_CONTEXT, assess } from './data';
import { cardName, derive, locationOf } from './derive';
import { asSentence, noTransactionsMessage } from './messages';
import { isFileDrag } from './useFileDrop';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('messages', () => {
  it('makes an engine warning a sentence, without doubling a period', () => {
    expect(asSentence('empty.csv: the file is empty')).toBe('empty.csv: the file is empty.');
    expect(asSentence('already ends here. ')).toBe('already ends here.');
    expect(asSentence('   ')).toBe('');
  });

  it('does not run the warning into the next sentence, and says "those files" for several', () => {
    const one = noTransactionsMessage(['empty.csv: the file is empty'], 1);
    expect(one).toBe('We could not find any transactions in that file. empty.csv: the file is empty. Try a CSV, OFX or QFX export from your bank.');
    const many = noTransactionsMessage(['a.csv: could not find date and amount columns, so this file was skipped', 'b.csv: the file is empty'], 2);
    expect(many).toContain('in those files.');
    expect(many).toContain('skipped. b.csv: the file is empty. Try');
    expect(noTransactionsMessage([], 1)).toBe('We could not find any transactions in that file. Try a CSV, OFX or QFX export from your bank.');
  });
});

describe('sourceLinks', () => {
  it('shows a host once, and tells two links on one host apart', () => {
    const links = sourceLinks([
      'https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus',
      'https://help.openai.com/en/articles/8264644-how-can-i-cancel-my-chatgpt-subscription',
      'https://claude.com/pricing',
      'https://claude.com/pricing',
    ]);
    expect(links.map((l) => l.label)).toEqual([
      'help.openai.com/6950777-what-is-chatgpt-plus',
      'help.openai.com/8264644-how-can-i-cancel-my…',
      'claude.com',
    ]);
  });

  it('never repeats a label for any merchant in the catalog', () => {
    const dupes = MERCHANTS.filter((m) => {
      const labels = sourceLinks(m.sources).map((l) => l.label);
      return new Set(labels).size !== labels.length;
    }).map((m) => m.id);
    expect(dupes).toEqual([]);
  });
});

describe('isFileDrag', () => {
  it('is true only for drags that carry files', () => {
    expect(isFileDrag({ dataTransfer: { types: ['Files'] } })).toBe(true);
    expect(isFileDrag({ dataTransfer: { types: ['text/plain', 'Files'] } })).toBe(true);
    expect(isFileDrag({ dataTransfer: { types: ['text/plain'] } })).toBe(false);
    expect(isFileDrag({ dataTransfer: null })).toBe(false);
  });
});

describe('card naming and location', () => {
  const bundle: RecurringSeries = {
    key: 'apple-bill@9.99',
    displayName: 'App Store subscription ($9.99/mo)',
    descriptors: ['APPLE.COM/BILL'],
    cadence: 'monthly',
    charges: [
      { date: '2026-08-05', amount: 9.99 },
      { date: '2026-09-05', amount: 9.99 },
      { date: '2026-10-05', amount: 9.99 },
    ],
    currentAmount: 9.99,
    annualCost: 119.88,
    firstSeen: '2026-08-05',
    lastSeen: '2026-10-05',
    active: true,
    priceChanges: [],
    confidence: 0.8,
    merchantId: null,
    candidates: ['icloud-plus', 'apple-fitness-plus'],
  };
  const range = { statementStart: '2025-09-01', statementEnd: '2026-10-31' };

  it('names a picked store-billed app and moves it out of "pick the app"', () => {
    const before = assess([bundle], MERCHANTS, DEFAULT_CONTEXT, range);
    expect(cardName(before.items[0]!)).toBe('App Store subscription ($9.99/mo)');
    expect(locationOf(derive(before.items, before.summary), bundle.key)?.id).toBe('pick');

    const ctx: Context = { ...DEFAULT_CONTEXT, merchantOverrides: { [bundle.key]: 'icloud-plus' } };
    const after = assess([bundle], MERCHANTS, ctx, range);
    expect(cardName(after.items[0]!)).toBe('iCloud+ (billed via App Store)');
    expect(locationOf(derive(after.items, after.summary), bundle.key)?.id).not.toBe('pick');
  });
});

describe('deploy config', () => {
  const vercel = JSON.parse(read('vercel.json')) as {
    trailingSlash?: boolean;
    rewrites?: { source: string; destination: string }[];
    redirects?: { source: string }[];
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };

  it('serves /rebuilt/* as plain static files: no rewrite or redirect rule can swallow it', () => {
    // vercel.json "source" patterns are path-to-regexp; a catch-all like "/(.*)" or "/:path*" would match these URLs
    const probe = ['/rebuilt/huckleberry/', '/rebuilt/huckleberry/index.html', '/rebuilt/habitify/assets/index-abc.js', '/rebuilt/adobe-acrobat-pro/sw.js'];
    const matches = (source: string, url: string): boolean => {
      if (source === '/(.*)' || source === '/:path*' || source === '/:path(.*)' || source === '/(.+)') return true;
      const re = new RegExp(`^${source.replace(/[.+?^${}|[\]\\]/g, '\\$&').replace(/\(\.\*\)/g, '.*').replace(/:[A-Za-z_]+\*/g, '.*').replace(/:[A-Za-z_]+/g, '[^/]+')}$`);
      return re.test(url);
    };
    for (const rule of [...(vercel.rewrites ?? []), ...(vercel.redirects ?? [])]) {
      for (const url of probe) expect(matches(rule.source, url), `${rule.source} would catch ${url}`).toBe(false);
    }
  });

  it('keeps the strict policy on every route, so the proof apps run under the same CSP they were tested under', () => {
    const all = vercel.headers.find((h) => h.source === '/(.*)')!;
    const csp = all.headers.find((h) => h.key === 'Content-Security-Policy')!.value;
    expect(csp).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'self'; object-src 'none'",
    );
  });

  it('redirects /rebuilt/<app> to /rebuilt/<app>/, since the apps load their files by relative URL', () => {
    expect(vercel.trailingSlash).toBe(true);
  });

  it('has a real repository link, not the bare host', () => {
    expect(REPO_URL).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+$/);
  });
});

describe('colour contrast of verdict text in the light theme', () => {
  const css = read('src/ui/styles.css');
  const root = /:root \{([\s\S]*?)\n\}/.exec(css)![1]!;
  const token = (name: string): string => new RegExp(`--${name}:\\s*([^;]+);`).exec(root)![1]!.trim();
  const hex = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lin = (c: number): number => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const lum = (c: number[]): number => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
  const mix = (a: number[], b: number[], t: number): number[] => a.map((v, i) => v * t + b[i]! * (1 - t)); // t of a
  const ratio = (a: number[], b: number[]): number => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };

  it('keeps pill text at 4.5:1 or better on its 12% tint, on the page and on a card', () => {
    const inkMix = Number.parseFloat(token('ink-mix')) / 100;
    expect(inkMix).toBeGreaterThan(0);
    expect(inkMix).toBeLessThan(1);
    const failures: string[] = [];
    for (const v of ['absorb', 'rebuild', 'selfhost', 'haggle', 'rotate', 'cancel', 'keep']) {
      const fill = hex(token(`v-${v}`));
      const ink = mix(fill, [0, 0, 0], inkMix); // color-mix(in srgb, fill 78%, #000)
      for (const [where, bg] of [['page', hex(token('bg'))], ['card', hex(token('surface'))], ['receipt paper', hex(token('paper'))]] as const) {
        const r = ratio(ink, mix(fill, bg, 0.12));
        if (r < 4.5) failures.push(`${v} on ${where}: ${r.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('uses the mixed ink for pill and chip text, and sets 12 px', () => {
    expect(css).toMatch(/\.pill \{[^}]*color: var\(--vc-ink, var\(--vc\)\);[^}]*font-size: 12px;/);
    expect(css).toMatch(/\[data-verdict\] \{\s*--vc-ink: color-mix\(in srgb, var\(--vc\) var\(--ink-mix\), #000\);/);
    // dark themes keep the spec colours untouched
    expect(css.match(/--ink-mix: 100%;/g)).toHaveLength(2);
  });
});
