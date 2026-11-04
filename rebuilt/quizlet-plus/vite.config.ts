import { defineConfig, type Plugin } from 'vitest/config';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

/** After the build, list every emitted file and write dist/sw.js with that precache list. */
function serviceWorkerPlugin(): Plugin {
  let outDir = 'dist';
  let root = process.cwd();
  return {
    name: 'flashcards-sw',
    apply: 'build',
    configResolved(cfg) {
      outDir = cfg.build.outDir;
      root = cfg.root;
    },
    closeBundle: {
      order: 'post',
      handler() {
        const dir = join(root, outDir);
        const files: string[] = [];
        const walk = (d: string) => {
          for (const name of readdirSync(d)) {
            const p = join(d, name);
            if (statSync(p).isDirectory()) walk(p);
            else files.push(relative(dir, p).split(sep).join('/'));
          }
        };
        walk(dir);
        const list = files.filter((f) => f !== 'sw.js').sort();
        const hash = createHash('sha1');
        for (const f of list) hash.update(f).update(readFileSync(join(dir, f)));
        const version = hash.digest('hex').slice(0, 10);
        const tpl = readFileSync(join(root, 'sw.template.js'), 'utf8');
        const out = tpl
          .replace('__VERSION__', version)
          .replace('__PRECACHE__', JSON.stringify(['./', ...list], null, 1));
        writeFileSync(join(dir, 'sw.js'), out);
      },
    },
  };
}

export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: false, assetsInlineLimit: 0 },
  plugins: [serviceWorkerPlugin()],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
