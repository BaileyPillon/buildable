import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

/** Emits dist/sw.js with a precache list of every built file (offline-first). */
export function serviceWorkerPlugin(): Plugin {
  let outDir = 'dist';
  let root = process.cwd();
  return {
    name: 'habit-sw',
    apply: 'build',
    configResolved(cfg) {
      outDir = join(cfg.root, cfg.build.outDir);
      root = cfg.root;
    },
    writeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const p = join(dir, name);
          if (statSync(p).isDirectory()) walk(p);
          else files.push(relative(outDir, p).split(sep).join('/'));
        }
      };
      walk(outDir);
      const list = files.filter((f) => f !== 'sw.js' && !f.endsWith('.map')).sort();
      const hash = createHash('sha1');
      for (const f of list) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 10);
      const tpl = readFileSync(join(root, 'src', 'sw.template.js'), 'utf8');
      const out = tpl
        .replace('__VERSION__', version)
        .replace('__ASSETS__', JSON.stringify(['./', ...list.map((f) => './' + f)]));
      writeFileSync(join(outDir, 'sw.js'), out);
    },
  };
}
