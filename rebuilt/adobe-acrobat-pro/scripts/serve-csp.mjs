// Tiny static server that sends the strict Content-Security-Policy this app is
// designed for. Use it to check the production build behaves under the policy.
//   node scripts/serve-csp.mjs [dir=dist] [port=4173] [prefix=/]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || 'dist');
const port = Number(process.argv[3] || 4173);
let prefix = process.argv[4] || '/';
if (!prefix.endsWith('/')) prefix += '/';

export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "font-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'self'; object-src 'none'";

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.pdf': 'application/pdf',
  '.gz': 'application/octet-stream', '.ico': 'image/x-icon', '.map': 'application/json',
};

http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (!url.startsWith(prefix)) { res.writeHead(404); res.end('not found'); return; }
  let rel = url.slice(prefix.length);
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = path.join(dir, rel);
  if (!file.startsWith(dir)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Security-Policy': CSP }); res.end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Content-Security-Policy': CSP,
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}).listen(port, () => console.log(`serving ${dir} at http://localhost:${port}${prefix} with strict CSP`));
