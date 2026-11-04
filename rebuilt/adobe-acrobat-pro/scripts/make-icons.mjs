// Renders the app icon to PNG with no dependencies (analytic shapes + 3x3 supersampling).
//   node scripts/make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
fs.mkdirSync(out, { recursive: true });

const BG = [0x2f, 0x4b, 0xd0];
const PAGE = [255, 255, 255];
const FOLD = [0xc9, 0xd2, 0xff];

function inPoly(x, y, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function inRound(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
const rect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

// sample(x, y) -> [r,g,b,a]; maskable icons get a full-bleed background and a smaller glyph
function sample(x, y, maskable) {
  if (!maskable && !inRound(x, y, 0.2)) return [0, 0, 0, 0];
  let gx = x;
  let gy = y;
  if (maskable) {
    gx = (x - 0.5) / 0.74 + 0.5;
    gy = (y - 0.5) / 0.74 + 0.5;
  }
  const page = [[0.3, 0.14], [0.6, 0.14], [0.74, 0.28], [0.74, 0.86], [0.3, 0.86]];
  if (inPoly(gx, gy, page)) {
    if (inPoly(gx, gy, [[0.6, 0.14], [0.74, 0.28], [0.6, 0.28]])) return [...FOLD, 255];
    if (rect(gx, gy, 0.37, 0.42, 0.67, 0.46) || rect(gx, gy, 0.37, 0.54, 0.67, 0.58) || rect(gx, gy, 0.37, 0.66, 0.56, 0.7)) return [...BG, 255];
    return [...PAGE, 255];
  }
  return [...BG, 255];
}

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, maskable) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const SS = 3;
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const s = sample((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, maskable);
          r += s[0] * s[3];
          g += s[1] * s[3];
          b += s[2] * s[3];
          a += s[3];
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      if (a > 0) {
        raw[o] = Math.round(r / a);
        raw[o + 1] = Math.round(g / a);
        raw[o + 2] = Math.round(b / a);
      }
      raw[o + 3] = Math.round(a / (SS * SS));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.writeFileSync(path.join(out, 'icon-192.png'), png(192, false));
fs.writeFileSync(path.join(out, 'icon-512.png'), png(512, false));
fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), png(512, true));
fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), png(180, true));
console.log('icons written to', out);
