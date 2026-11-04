// Static file server for a built site (dist/), a stand-in for Vercel: same response headers (read from
// vercel.json, so the Content-Security-Policy under test is the one that ships), correct MIME types, and the SPA
// fallback for the root app only.
//
// Usage: node scripts/serve-dist.mjs <dir> <port>
//   e.g. npm run build && node scripts/serve-dist.mjs dist 4173
//
// Behaviour
//   - Every response (200, 304, 404, fallback) carries the headers of every vercel.json "headers" entry whose
//     `source` matches the request path, applied in file order (later entries override earlier ones).
//   - GET/HEAD only. A directory serves its index.html. When vercel.json sets "trailingSlash": true, a directory asked
//     for without the slash is redirected to it (308), as Vercel does: the proof apps under /rebuilt/ use relative
//     URLs ("./assets/x.js"), which only resolve against a path that ends in a slash.
//   - Unknown paths fall back to /index.html (200) when they look like app routes (no file extension), except under
//     /rebuilt/, where each proof app is its own static site: there a missing path is a plain 404.
//     A missing file WITH an extension (/assets/x.js) is always a 404, never HTML pretending to be a script.
//   - Binds to the loopback addresses (127.0.0.1 and ::1) only. No directory listings, no dotfiles, no path traversal.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const VERCEL_JSON = path.resolve(here, '..', 'vercel.json');
const NO_FALLBACK_PREFIXES = ['/rebuilt/'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

/** vercel.json `source` (path-to-regexp style, as used by the headers key) -> RegExp. */
function sourceToRegExp(source) {
  let re = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '(') {
      // a raw regex group such as (.*): copy through to the matching paren
      let depth = 0;
      let j = i;
      for (; j < source.length; j++) {
        if (source[j] === '\\') j++;
        else if (source[j] === '(') depth++;
        else if (source[j] === ')' && --depth === 0) break;
      }
      re += source.slice(i, j + 1);
      i = j + 1;
    } else if (ch === ':') {
      const m = /^:[A-Za-z_][A-Za-z0-9_]*(\*|\+|\?)?/.exec(source.slice(i));
      const mod = m?.[1];
      re += mod === '*' ? '.*' : mod === '+' ? '.+' : mod === '?' ? '[^/]*' : '[^/]+';
      i += m ? m[0].length : 1;
    } else {
      re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  return new RegExp(`^${re}$`);
}

let TRAILING_SLASH = false;

function loadHeaderRules() {
  let json;
  try {
    json = JSON.parse(fs.readFileSync(VERCEL_JSON, 'utf8'));
  } catch (err) {
    console.error(`serve-dist: cannot read ${VERCEL_JSON}: ${err.message}`);
    process.exit(1);
  }
  TRAILING_SLASH = json.trailingSlash === true;
  const rules = [];
  for (const entry of json.headers ?? []) {
    rules.push({ re: sourceToRegExp(entry.source), headers: entry.headers ?? [] });
  }
  return rules;
}

const [dirArg, portArg] = process.argv.slice(2);
if (!dirArg || !portArg || process.argv.length > 4) {
  console.error('Usage: node scripts/serve-dist.mjs <dir> <port>');
  process.exit(2);
}
const ROOT = path.resolve(dirArg);
const PORT = Number(portArg);
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  console.error(`serve-dist: invalid port "${portArg}"`);
  process.exit(2);
}
if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) {
  console.error(`serve-dist: "${ROOT}" is not a directory (run npm run build first?)`);
  process.exit(2);
}
const RULES = loadHeaderRules();

function headersFor(pathname) {
  const out = {};
  for (const rule of RULES) {
    if (!rule.re.test(pathname)) continue;
    for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
}

/** Absolute file path for a URL pathname, or null if it escapes ROOT or touches a dotfile. */
function resolveInside(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const parts = decoded.split(/[\\/]+/).filter(Boolean);
  if (parts.some((p) => p === '..' || (p.startsWith('.') && p !== '.well-known'))) return null;
  const abs = path.resolve(ROOT, ...parts);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  return abs;
}

function statOrNull(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

/** The file to serve for a pathname: itself, a directory's index.html, or null. */
function fileFor(pathname) {
  const abs = resolveInside(pathname);
  if (!abs) return null;
  const st = statOrNull(abs);
  if (st?.isFile()) return { abs, st };
  if (st?.isDirectory()) {
    const idx = path.join(abs, 'index.html');
    const ist = statOrNull(idx);
    if (ist?.isFile()) return { abs: idx, st: ist, viaDirectory: true };
  }
  return null;
}

function handle(req, res) {
  let pathname;
  try {
    pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    pathname = '/';
  }
  const base = headersFor(pathname);

  const send = (status, headers, body) => {
    res.writeHead(status, { ...base, ...headers });
    res.end(req.method === 'HEAD' ? undefined : body);
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }, 'Method Not Allowed\n');
    return;
  }

  let hit = fileFor(pathname);
  let status = 200;
  if (hit?.viaDirectory && TRAILING_SLASH && !pathname.endsWith('/')) {
    let search = '';
    try {
      search = new URL(req.url ?? '/', 'http://localhost').search;
    } catch {
      /* keep the path only */
    }
    send(308, { Location: `${pathname}/${search}`, 'Content-Type': 'text/plain; charset=utf-8' }, `Redirecting to ${pathname}/\n`);
    return;
  }
  if (!hit) {
    const last = pathname.split('/').pop() ?? '';
    const looksLikeFile = path.extname(last) !== '';
    const underStaticSite = NO_FALLBACK_PREFIXES.some((p) => pathname.startsWith(p) || `${pathname}/` === p);
    if (!looksLikeFile && !underStaticSite) {
      hit = fileFor('/index.html');
    }
    if (!hit) {
      send(404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found\n');
      return;
    }
  }

  const type = MIME[path.extname(hit.abs).toLowerCase()] ?? 'application/octet-stream';
  const etag = `W/"${hit.st.size.toString(16)}-${Math.floor(hit.st.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': type,
    'Content-Length': hit.st.size,
    'Last-Modified': hit.st.mtime.toUTCString(),
    ETag: etag,
  };
  // Vercel's own default for static files without a Cache-Control rule
  if (!base['Cache-Control']) headers['Cache-Control'] = 'public, max-age=0, must-revalidate';

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ...base, ETag: etag, ...(headers['Cache-Control'] ? { 'Cache-Control': headers['Cache-Control'] } : {}) });
    res.end();
    return;
  }

  res.writeHead(status, { ...base, ...headers });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(hit.abs);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}


/** Listen on one loopback address; resolves with the bound port, or null if that address family is unavailable. */
function listen(host, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handle);
    server.once('error', (err) => {
      if (err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT') resolve(null);
      else reject(err);
    });
    server.listen(port, host, () => {
      servers.push(server);
      resolve(server.address().port);
    });
  });
}

const servers = [];
try {
  // Both loopbacks, so http://localhost:PORT reaches this server whichever way "localhost" resolves (a browser
  // tries ::1 first). Never a public interface.
  const port = await listen('127.0.0.1', PORT);
  await listen('::1', port);
  console.log(`Serving ${ROOT} at http://localhost:${port}  (headers from vercel.json: ${RULES.length} rule${RULES.length === 1 ? '' : 's'})`);
} catch (err) {
  console.error(`serve-dist: ${err.code === 'EADDRINUSE' ? `port ${PORT} is already in use on localhost (another server is listening there)` : err.message}`);
  process.exit(1);
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
