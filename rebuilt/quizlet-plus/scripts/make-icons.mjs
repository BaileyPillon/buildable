// Generates PNG icons with no dependencies (zlib only). Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, draw) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const INDIGO = [79, 70, 229, 255], WHITE = [255, 255, 255, 255];
function inRound(u, v, x0, y0, x1, y1, r) {
  if (u < x0 || u > x1 || v < y0 || v > y1) return false;
  const cx = Math.min(Math.max(u, x0 + r), x1 - r), cy = Math.min(Math.max(v, y0 + r), y1 - r);
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
}
// scale = how much of the canvas the card occupies (maskable needs a larger safe zone)
const make = (rounded, scale) => (u, v) => {
  if (rounded && !inRound(u, v, 0, 0, 1, 1, 0.19)) return [0, 0, 0, 0];
  const m = 0.5, s = scale;
  const card = inRound(u, v, m - 0.3 * s, m - 0.21 * s, m + 0.3 * s, m + 0.21 * s, 0.055 * s);
  const line1 = Math.abs(v - (m - 0.04 * s)) < 0.022 * s && u > m - 0.2 * s && u < m + 0.2 * s;
  const line2 = Math.abs(v - (m + 0.07 * s)) < 0.022 * s && u > m - 0.2 * s && u < m + 0.05 * s;
  if (card) return line1 || line2 ? INDIGO : WHITE;
  return INDIGO;
};
writeFileSync('public/icon-192.png', png(192, make(true, 1)));
writeFileSync('public/icon-512.png', png(512, make(true, 1)));
writeFileSync('public/icon-maskable-512.png', png(512, make(false, 0.8)));
writeFileSync('public/apple-touch-icon.png', png(180, make(false, 0.9)));
console.log('icons written');
