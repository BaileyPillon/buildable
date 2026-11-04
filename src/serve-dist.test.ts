// scripts/serve-dist.mjs: the local stand-in for Vercel used to check the CSP against the built site.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const csp = vercel.headers[0].headers.find((h) => h.key === 'Content-Security-Policy')!.value;

let dir: string;
let child: ChildProcess;
let base: string;

function start(): Promise<string> {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve-dist.mjs'), dir, '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => reject(new Error(`server did not start: ${out}`)), 8000);
    child.stdout!.on('data', (b: Buffer) => {
      out += b.toString();
      const m = /http:\/\/localhost:(\d+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${m[1]}`);
      }
    });
    child.stderr!.on('data', (b: Buffer) => {
      out += b.toString();
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited with ${code}: ${out}`));
    });
  });
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildable-serve-'));
  const write = (rel: string, body: string | Buffer) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  write('index.html', '<!doctype html><title>root app</title>');
  write('assets/app-abc123.js', 'export {};');
  write('assets/font.woff2', Buffer.from([0, 1, 2]));
  write('data/sample.csv', 'a,b\n1,2\n');
  write('x.mjs', 'export {};');
  write('x.wasm', Buffer.from([0, 0x61, 0x73, 0x6d]));
  write('app.webmanifest', '{}');
  write('rebuilt/habit/index.html', '<!doctype html><title>habit</title>');
  write('rebuilt/habit/main.js', 'console.log(1)');
  base = await start();
}, 15000);

afterAll(() => {
  child?.removeAllListeners('exit');
  child?.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

const get = (p: string, init?: RequestInit) => fetch(base + p, init);

describe('serve-dist', () => {
  it('applies the vercel.json headers (CSP etc.) to every kind of response', async () => {
    for (const p of ['/', '/assets/app-abc123.js', '/some/route', '/missing.js', '/rebuilt/nope']) {
      const r = await get(p);
      expect(r.headers.get('content-security-policy'), p).toBe(csp);
      expect(r.headers.get('referrer-policy'), p).toBe('no-referrer');
      expect(r.headers.get('x-content-type-options'), p).toBe('nosniff');
      expect(r.headers.get('permissions-policy'), p).toBe('camera=(), microphone=(), geolocation=()');
    }
  });

  it('adds the immutable cache header only under /assets/', async () => {
    expect((await get('/assets/app-abc123.js')).headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect((await get('/')).headers.get('cache-control')).not.toContain('immutable');
  });

  it('serves the right MIME types', async () => {
    const types: Record<string, string> = {
      '/': 'text/html',
      '/assets/app-abc123.js': 'text/javascript',
      '/x.mjs': 'text/javascript',
      '/x.wasm': 'application/wasm',
      '/app.webmanifest': 'application/manifest+json',
      '/data/sample.csv': 'text/csv',
      '/assets/font.woff2': 'font/woff2',
    };
    for (const [p, type] of Object.entries(types)) {
      const r = await get(p);
      expect(r.status, p).toBe(200);
      expect(r.headers.get('content-type'), p).toContain(type);
    }
  });

  it('falls back to the root app for unknown routes, but never for files or under /rebuilt/', async () => {
    const route = await get('/results/2026');
    expect(route.status).toBe(200);
    expect(await route.text()).toContain('root app');

    expect((await get('/assets/missing.js')).status).toBe(404);
    expect((await get('/rebuilt/nope')).status).toBe(404);
    expect((await get('/rebuilt/')).status).toBe(404);
    expect((await get('/rebuilt/habit/missing.css')).status).toBe(404);

    const app = await get('/rebuilt/habit/');
    expect(app.status).toBe(200);
    expect(await app.text()).toContain('<title>habit</title>');
    expect(await (await get('/rebuilt/habit')).text()).toContain('<title>habit</title>');
    expect((await get('/rebuilt/habit/main.js')).status).toBe(200);
  });

  it('supports HEAD, rejects other methods, and does not escape the directory', async () => {
    const head = await get('/', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(Number(head.headers.get('content-length'))).toBeGreaterThan(0);
    expect((await get('/', { method: 'POST', body: 'x' })).status).toBe(405);
    for (const p of ['/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/assets/..%5c..%5cpackage.json']) {
      const r = await get(p);
      expect(await r.text(), p).not.toContain('"name"');
    }
  });
});
