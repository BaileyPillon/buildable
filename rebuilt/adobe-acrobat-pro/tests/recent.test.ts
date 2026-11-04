import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { addRecent, clearRecent, listRecent, MAX_RECENT, removeRecent } from '../src/lib/recent';

describe('recent files list', () => {
  beforeEach(async () => {
    await clearRecent();
  });

  it('stores only metadata, never contents', async () => {
    // Even if a caller passes something with contents attached, only whitelisted fields persist.
    const sneaky = { name: 'report.pdf', size: 1234, bytes: new Uint8Array([1, 2, 3]), data: 'secret' };
    await addRecent(sneaky, 'merge');
    const [entry] = await listRecent();
    expect(Object.keys(entry).sort()).toEqual(['key', 'name', 'openedAt', 'size', 'tool']);
    expect(JSON.stringify(entry)).not.toContain('secret');
    expect(entry.name).toBe('report.pdf');
  });

  it('puts the most recently opened first and de-duplicates', async () => {
    await addRecent({ name: 'a.pdf', size: 1 }, 'split');
    await new Promise((r) => setTimeout(r, 5));
    await addRecent({ name: 'b.pdf', size: 2 }, 'ocr');
    await new Promise((r) => setTimeout(r, 5));
    await addRecent({ name: 'a.pdf', size: 1 }, 'compress');
    const list = await listRecent();
    expect(list.map((e) => e.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(list[0].tool).toBe('compress');
  });

  it(`keeps at most ${MAX_RECENT} entries`, async () => {
    for (let i = 0; i < MAX_RECENT + 5; i++) {
      await addRecent({ name: `f${i}.pdf`, size: i }, 'merge');
      await new Promise((r) => setTimeout(r, 1));
    }
    expect(await listRecent()).toHaveLength(MAX_RECENT);
  });

  it('can remove one entry and clear all', async () => {
    await addRecent({ name: 'x.pdf', size: 1 }, 'merge');
    await addRecent({ name: 'y.pdf', size: 2 }, 'merge');
    const [first] = await listRecent();
    await removeRecent(first.key);
    expect(await listRecent()).toHaveLength(1);
    await clearRecent();
    expect(await listRecent()).toHaveLength(0);
  });
});
