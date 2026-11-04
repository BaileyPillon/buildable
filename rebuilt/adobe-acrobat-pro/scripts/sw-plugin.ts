import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

// After the bundle is written, emit sw.js with a precache list of the app shell.
// Big optional assets (OCR engine, CJK cmaps, wasm) are cached on first use instead.
const LAZY = [/^vendor\/tesseract\//, /^vendor\/pdfjs\/cmaps\//, /^vendor\/pdfjs\/wasm\//, /\.map$/, /^sw\.js$/];

function walk(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

export function swPlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'pdf-toolkit-sw',
    apply: 'build',
    configResolved(cfg) {
      outDir = path.resolve(cfg.root, cfg.build.outDir);
    },
    closeBundle() {
      const files = walk(outDir).filter((f) => !LAZY.some((re) => re.test(f)));
      const hash = crypto.createHash('sha1');
      for (const f of files.sort()) {
        hash.update(f);
        hash.update(fs.readFileSync(path.join(outDir, f)));
      }
      const precache = ['./', ...files.map((f) => './' + f)];
      const tpl = fs.readFileSync(fileURLToPath(new URL('./sw.template.js', import.meta.url)), 'utf8');
      const sw = tpl
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__PRECACHE__', JSON.stringify(precache, null, 2));
      fs.writeFileSync(path.join(outDir, 'sw.js'), sw);
    },
  };
}

/**
 * The same policy the app is designed for, written into the built index.html so it also applies on
 * hosts that cannot send headers (GitHub Pages). The frame-ancestors directive only works as a real header, so it
 * lives in public/_headers instead.
 */
export const CSP_META =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "font-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'self'; object-src 'none'";

export function cspMetaPlugin(): Plugin {
  return {
    name: 'pdf-toolkit-csp-meta',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP_META }, injectTo: 'head-prepend' }],
    },
  };
}
