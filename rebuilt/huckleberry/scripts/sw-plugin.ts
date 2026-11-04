import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Builds dist/sw.js from src/sw-template.js with a precache list of every emitted file. */
export function buildServiceWorker(outDir: string, template: string): string {
  const files = walk(outDir)
    .map((f) => relative(outDir, f).split(sep).join('/'))
    .filter((f) => f !== 'sw.js' && !f.endsWith('.map'))
    .sort();
  const hash = createHash('sha1');
  for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
  const urls = ['./', ...files.map((f) => './' + f)];
  return template
    .replace('__VERSION__', hash.digest('hex').slice(0, 10))
    .replace('__PRECACHE__', JSON.stringify(urls, null, 2));
}

export function serviceWorkerPlugin(): Plugin {
  let outDir = 'dist';
  let root = process.cwd();
  return {
    name: 'nestlog-sw',
    apply: 'build',
    configResolved(cfg) {
      outDir = resolve(cfg.root, cfg.build.outDir);
      root = cfg.root;
    },
    closeBundle() {
      const template = readFileSync(join(root, 'src/sw-template.js'), 'utf8');
      writeFileSync(join(outDir, 'sw.js'), buildServiceWorker(outDir, template));
    },
  };
}
