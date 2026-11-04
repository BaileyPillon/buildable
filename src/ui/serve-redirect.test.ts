// scripts/serve-dist.mjs emulates vercel.json's "trailingSlash": true, so the proof apps under /rebuilt/ (which load
// their files by relative URL) are tested the way they will be served: a directory asked for without the slash is
// redirected to it, and everything else is untouched.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildable-redirect-'));
  fs.mkdirSync(path.join(dir, 'rebuilt', 'habit', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>root app</title>');
  fs.writeFileSync(path.join(dir, 'rebuilt', 'habit', 'index.html'), '<!doctype html><title>habit</title>');
  fs.writeFileSync(path.join(dir, 'rebuilt', 'habit', 'assets', 'app.js'), 'export {};');
  base = await start();
}, 15000);

afterAll(() => {
  child?.removeAllListeners('exit');
  child?.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

const manual = (p: string) => fetch(base + p, { redirect: 'manual' });

describe('serve-dist trailing slash', () => {
  it('redirects a proof app folder to its slash form, keeping the query and the security headers', async () => {
    const r = await manual('/rebuilt/habit?x=1');
    expect(r.status).toBe(308);
    expect(r.headers.get('location')).toBe('/rebuilt/habit/?x=1');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('serves the slash form, the files inside it and the root without a redirect', async () => {
    for (const p of ['/', '/rebuilt/habit/', '/rebuilt/habit/index.html', '/rebuilt/habit/assets/app.js']) {
      expect((await manual(p)).status, p).toBe(200);
    }
  });

  it('still 404s a missing folder under /rebuilt/ instead of redirecting or falling back to the root app', async () => {
    expect((await manual('/rebuilt/nope')).status).toBe(404);
    expect((await manual('/rebuilt/nope/')).status).toBe(404);
  });
});
