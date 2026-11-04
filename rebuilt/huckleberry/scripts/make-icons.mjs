// Generates the PWA icons (pure node, no dependencies): node scripts/make-icons.mjs
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
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [59, 58, 98], MOON = [246, 217, 139], STAR = [255, 244, 214];
function sample(u, v, rounded, scale) {
  // u,v in 0..1. returns [r,g,b,a]
  if (rounded) {
    const r = 0.22, cx = Math.min(Math.max(u, r), 1 - r), cy = Math.min(Math.max(v, r), 1 - r);
    if ((u - cx) ** 2 + (v - cy) ** 2 > r * r) return [0, 0, 0, 0];
  }
  // art is drawn in a box shrunk by `scale` around the centre
  const x = (u - 0.5) / scale + 0.5, y = (v - 0.5) / scale + 0.5;
  const inMoon = (x - 0.46) ** 2 + (y - 0.52) ** 2 < 0.27 ** 2;
  const cut = (x - 0.58) ** 2 + (y - 0.43) ** 2 < 0.23 ** 2;
  if (inMoon && !cut) return [...MOON, 255];
  if ((x - 0.76) ** 2 + (y - 0.27) ** 2 < 0.045 ** 2) return [...STAR, 255];
  if ((x - 0.80) ** 2 + (y - 0.66) ** 2 < 0.025 ** 2) return [...STAR, 255];
  return [...BG, 255];
}
function render(size, rounded, scale) {
  const out = Buffer.alloc(size * size * 4), N = 3;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) {
      const c = sample((x + (sx + 0.5) / N) / size, (y + (sy + 0.5) / N) / size, rounded, scale);
      r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
    }
    const o = (y * size + x) * 4;
    if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
    out[o + 3] = a / (N * N);
  }
  return out;
}
mkdirSync('public/icons', { recursive: true });
const jobs = [
  ['icon-192.png', 192, true, 1],
  ['icon-512.png', 512, true, 1],
  ['maskable-512.png', 512, false, 0.62],
  ['apple-touch-icon.png', 180, false, 0.8],
];
for (const [name, size, rounded, scale] of jobs) {
  writeFileSync('public/icons/' + name, png(size, render(size, rounded, scale)));
  console.log('wrote', name);
}
