// Generates PNG icons with no dependencies (zlib + manual PNG encoding).
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const png = (w, h, rgba) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const distSeg = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function render(size, { maskable }) {
  const out = Buffer.alloc(size * size * 4);
  const S = 512,
    ss = 2;
  const scale = maskable ? 0.78 : 1; // keep glyph inside the maskable safe zone
  const bg = [15, 118, 110],
    ring = [204, 251, 241],
    white = [255, 255, 255];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const u = ((x + (sx + 0.5) / ss) / size) * S,
            v = ((y + (sy + 0.5) / ss) / size) * S;
          let inside = true;
          if (!maskable) {
            const rad = 112,
              cx = Math.min(Math.max(u, rad), S - rad),
              cy = Math.min(Math.max(v, rad), S - rad);
            inside = Math.hypot(u - cx, v - cy) <= rad;
          }
          if (!inside) continue;
          let col = bg;
          const gu = (u - 256) / scale + 256,
            gv = (v - 256) / scale + 256;
          const dr = Math.abs(Math.hypot(gu - 256, gv - 256) - 150);
          if (dr < 18) col = mix(col, ring, 0.45);
          const d = Math.min(distSeg(gu, gv, 178, 262, 234, 318), distSeg(gu, gv, 234, 318, 338, 196));
          if (d < 22) col = white;
          r += col[0];
          g += col[1];
          b += col[2];
          a += 255;
        }
      const n = ss * ss,
        i = (y * size + x) * 4;
      const cov = a / (255 * n);
      out[i] = cov ? r / (cov * n) : 0;
      out[i + 1] = cov ? g / (cov * n) : 0;
      out[i + 2] = cov ? b / (cov * n) : 0;
      out[i + 3] = Math.round(cov * 255);
    }
  return png(size, size, out);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', render(192, { maskable: false }));
writeFileSync('public/icons/icon-512.png', render(512, { maskable: false }));
writeFileSync('public/icons/icon-maskable-512.png', render(512, { maskable: true }));
writeFileSync('public/icons/apple-touch-icon.png', render(180, { maskable: true }));
console.log('icons written');
