import { describe, expect, it } from 'vitest';
import { createZip, crc32 } from '../src/lib/zip';

describe('zip writer', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes a readable archive structure', () => {
    const a = new TextEncoder().encode('hello');
    const b = new TextEncoder().encode('world!!');
    const zip = createZip([
      { name: 'a.txt', data: a },
      { name: 'b.txt', data: b },
    ]);
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    // end of central directory is the last 22 bytes
    const eocd = zip.length - 22;
    expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
    expect(dv.getUint16(eocd + 10, true)).toBe(2); // two entries
    const cdOffset = dv.getUint32(eocd + 16, true);
    expect(dv.getUint32(cdOffset, true)).toBe(0x02014b50);
    expect(dv.getUint32(cdOffset + 16, true)).toBe(crc32(a));
    // first local header at 0, data right after the 30 + name bytes
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    expect(new TextDecoder().decode(zip.slice(30 + 5, 30 + 5 + 5))).toBe('hello');
  });
});
