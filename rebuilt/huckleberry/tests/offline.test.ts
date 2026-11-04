import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { buildServiceWorker } from '../scripts/sw-plugin';

const template = readFileSync(join(__dirname, '../src/sw-template.js'), 'utf8');
const BASE = 'https://example.test/app/';

/** a fake dist folder like the one `vite build` produces */
function fakeDist() {
  const dir = mkdtempSync(join(tmpdir(), 'nestlog-dist-'));
  mkdirSync(join(dir, 'assets'));
  mkdirSync(join(dir, 'icons'));
  const files: Record<string, string> = {
    'index.html': '<html>app shell</html>',
    'assets/index-abc123.js': 'console.log(1)',
    'assets/index-abc123.css': 'body{}',
    'manifest.webmanifest': '{}',
    'theme-init.js': '//',
    'icons/icon-192.png': 'png',
    'sw.js': 'OLD',
    'assets/index-abc123.js.map': '{}',
  };
  for (const [f, c] of Object.entries(files)) writeFileSync(join(dir, f), c);
  return { dir, files };
}

type Handler = (e: any) => void;

/** Minimal service-worker runtime: Cache Storage + fetch + event dispatch. */
function runSw(code: string, web: { online: boolean; files: Record<string, string> }, existingCaches: string[] = []) {
  const handlers: Record<string, Handler> = {};
  const abs = (r: any) => new URL(typeof r === 'string' ? r : r.url, BASE + 'sw.js').href;
  const stores = new Map<string, Map<string, Response>>();
  for (const n of existingCaches) stores.set(n, new Map());
  const fetchFn = async (r: any) => {
    if (!web.online) throw new TypeError('Failed to fetch');
    const url = new URL(abs(r));
    const path = url.pathname.replace('/app/', '') || 'index.html';
    const body = web.files[path === '' ? 'index.html' : path];
    return body === undefined ? new Response('nope', { status: 404 }) : new Response(body, { status: 200 });
  };
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name)!;
      return {
        async addAll(urls: string[]) {
          for (const u of urls) {
            const res = await fetchFn(u);
            if (!res.ok) throw new Error('addAll failed for ' + u);
            m.set(abs(u), res);
          }
        },
        async put(r: any, res: Response) {
          m.set(abs(r), res);
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
    async match(r: any) {
      for (const m of stores.values()) {
        const hit = m.get(abs(r));
        if (hit) return hit.clone();
      }
      return undefined;
    },
  };
  const calls = { skipWaiting: 0, claim: 0 };
  const self = {
    location: { origin: 'https://example.test' },
    addEventListener: (t: string, h: Handler) => (handlers[t] = h),
    skipWaiting: async () => void calls.skipWaiting++,
    clients: { claim: async () => void calls.claim++ },
  };
  vm.runInNewContext(code, { self, caches, fetch: fetchFn, URL, Response, Promise, console });

  const dispatch = async (type: string, extra: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = [];
    let responded: Promise<Response> | undefined;
    handlers[type]({
      ...extra,
      waitUntil: (p: Promise<unknown>) => waits.push(p),
      respondWith: (p: Promise<Response>) => (responded = Promise.resolve(p)),
    });
    await Promise.all(waits);
    return responded ? await responded : undefined;
  };
  const req = (path: string, init: { mode?: string; method?: string; origin?: string } = {}) => ({
    url: (init.origin ?? 'https://example.test') + '/app/' + path,
    method: init.method ?? 'GET',
    mode: init.mode ?? 'cors',
  });
  return { dispatch, req, stores, calls };
}

describe('service worker build step', () => {
  it('precaches every emitted file except itself and source maps', () => {
    const { dir } = fakeDist();
    const sw = buildServiceWorker(dir, template);
    const list = JSON.parse(/const PRECACHE = (\[[\s\S]*?\]);/.exec(sw)![1]) as string[];
    expect(list).toContain('./');
    expect(list).toContain('./index.html');
    expect(list).toContain('./assets/index-abc123.js');
    expect(list).toContain('./assets/index-abc123.css');
    expect(list).toContain('./manifest.webmanifest');
    expect(list).toContain('./theme-init.js');
    expect(list).toContain('./icons/icon-192.png');
    expect(list).not.toContain('./sw.js');
    expect(list.some((x) => x.endsWith('.map'))).toBe(false);
    expect(sw).not.toContain('__PRECACHE__');
    expect(sw).not.toContain('__VERSION__');
  });

  it('changes the cache version when the content changes', () => {
    const a = fakeDist();
    const b = fakeDist();
    writeFileSync(join(b.dir, 'assets/index-abc123.js'), 'console.log(2)');
    const va = /const VERSION = '(\w+)'/.exec(buildServiceWorker(a.dir, template))![1];
    const vb = /const VERSION = '(\w+)'/.exec(buildServiceWorker(b.dir, template))![1];
    expect(va).not.toBe(vb);
  });
});

describe('service worker offline behaviour', () => {
  const { dir, files } = fakeDist();
  const code = buildServiceWorker(dir, template);
  // what the "server" has: the files plus the directory index
  const web = { online: true, files: { ...files } };

  it('installs by caching the whole app shell, then serves it with no network', async () => {
    const sw = runSw(code, web);
    await sw.dispatch('install');
    expect(sw.calls.skipWaiting).toBe(1);
    const [cacheName] = [...sw.stores.keys()];
    expect(cacheName).toMatch(/^nestlog-/);
    expect(sw.stores.get(cacheName)!.size).toBeGreaterThanOrEqual(6);

    web.online = false; // airplane mode
    const nav = await sw.dispatch('fetch', { request: sw.req('', { mode: 'navigate' }) });
    expect(await nav!.text()).toBe('<html>app shell</html>');
    // deep links and reloads still get the shell
    const deep = await sw.dispatch('fetch', { request: sw.req('anything/else', { mode: 'navigate' }) });
    expect(await deep!.text()).toBe('<html>app shell</html>');
    const js = await sw.dispatch('fetch', { request: sw.req('assets/index-abc123.js') });
    expect(await js!.text()).toBe('console.log(1)');
    const manifest = await sw.dispatch('fetch', { request: sw.req('manifest.webmanifest') });
    expect(await manifest!.text()).toBe('{}');
    web.online = true;
  });

  it('does not touch non-GET or cross-origin requests', async () => {
    const sw = runSw(code, web);
    await sw.dispatch('install');
    expect(await sw.dispatch('fetch', { request: sw.req('x', { method: 'POST' }) })).toBeUndefined();
    expect(await sw.dispatch('fetch', { request: sw.req('x', { origin: 'https://other.test' }) })).toBeUndefined();
  });

  it('fails the install (so the old version keeps running) if a precache file is missing', async () => {
    const sw = runSw(code, { online: true, files: { 'index.html': 'x' } });
    await expect(sw.dispatch('install')).rejects.toThrow();
  });

  it('removes caches from older versions on activate', async () => {
    const sw = runSw(code, web, ['nestlog-old1', 'someone-elses-cache']);
    await sw.dispatch('install');
    await sw.dispatch('activate');
    const names = [...sw.stores.keys()];
    expect(names).not.toContain('nestlog-old1');
    expect(names).toContain('someone-elses-cache');
    expect(names.filter((n) => n.startsWith('nestlog-'))).toHaveLength(1);
    expect(sw.calls.claim).toBe(1);
  });
});

describe('web app manifest', () => {
  const m = JSON.parse(readFileSync(join(__dirname, '../public/manifest.webmanifest'), 'utf8'));
  it('is installable: standalone, relative start_url and scope, 192 and 512 icons', () => {
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('./');
    expect(m.scope).toBe('./');
    const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(m.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
    for (const i of m.icons) expect(i.src.startsWith('/')).toBe(false);
  });
});
