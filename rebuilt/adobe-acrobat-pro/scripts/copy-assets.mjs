// Copies the runtime assets that pdf.js and tesseract.js load by URL into
// public/vendor so they ship with the app (no CDN, no external requests).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const out = (...p) => path.join(root, 'public', 'vendor', ...p);

function copy(src, dest) {
  if (!fs.existsSync(src)) throw new Error('Missing asset: ' + src + ' (run npm install)');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

fs.rmSync(out(), { recursive: true, force: true });

// pdf.js: standard font data, CMaps, ICC profiles, wasm decoders
for (const dir of ['standard_fonts', 'cmaps', 'iccs', 'wasm']) copy(nm('pdfjs-dist', dir), out('pdfjs', dir));

// tesseract.js worker + engine cores + English model
copy(nm('tesseract.js', 'dist', 'worker.min.js'), out('tesseract', 'worker.min.js'));
copy(nm('tesseract.js-core', 'tesseract-core.asm.js'), out('tesseract', 'tesseract-core.asm.js'));
copy(nm('tesseract.js-core', 'tesseract-core.wasm.js'), out('tesseract', 'tesseract-core.wasm.js'));
copy(nm('@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'), out('tesseract', 'lang', 'eng.traineddata.gz'));

console.log('vendor assets copied to public/vendor');
