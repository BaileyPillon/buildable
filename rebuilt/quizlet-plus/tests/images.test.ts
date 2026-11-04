import { describe, expect, it } from 'vitest';
import { dataUrlToBlob } from '../src/images';

describe('dataUrlToBlob (fetch on data: URLs is blocked by CSP, so it is decoded by hand)', () => {
  it('decodes base64 into a Blob with the right type and bytes', async () => {
    const blob = dataUrlToBlob('data:image/png;base64,iVBORw0KGgo=');
    expect(blob.type).toBe('image/png');
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('rejects things that are not base64 data URLs', () => {
    expect(() => dataUrlToBlob('http://example.com/a.png')).toThrow();
    expect(() => dataUrlToBlob('data:text/plain,hello')).toThrow();
  });
});
