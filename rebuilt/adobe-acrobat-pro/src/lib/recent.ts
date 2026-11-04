/**
 * Recent-files list. Stores ONLY metadata (name, size, tool, time) in IndexedDB.
 * File contents are never written anywhere.
 */
export interface RecentEntry {
  key: string; // name + size, so re-opening the same file moves it to the top
  name: string;
  size: number;
  tool: string;
  openedAt: number;
}

const DB_NAME = 'pdf-toolkit';
const STORE = 'recent-files';
export const MAX_RECENT = 20;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is not available'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function requestResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listRecent(): Promise<RecentEntry[]> {
  try {
    const db = await open();
    const all = (await requestResult(db.transaction(STORE).objectStore(STORE).getAll())) as RecentEntry[];
    db.close();
    return all.sort((a, b) => b.openedAt - a.openedAt);
  } catch {
    return [];
  }
}

/** Remember that a file was opened. Only the whitelisted fields below are ever stored. */
export async function addRecent(file: { name: string; size: number }, tool: string): Promise<void> {
  try {
    const db = await open();
    const entry: RecentEntry = {
      key: `${file.name}\u0000${file.size}`,
      name: String(file.name),
      size: Number(file.size) || 0,
      tool,
      openedAt: Date.now(),
    };
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(entry);
    await done(tx);
    // trim to the most recent MAX_RECENT
    const all = (await requestResult(db.transaction(STORE).objectStore(STORE).getAll())) as RecentEntry[];
    const extra = all.sort((a, b) => b.openedAt - a.openedAt).slice(MAX_RECENT);
    if (extra.length) {
      const tx2 = db.transaction(STORE, 'readwrite');
      for (const e of extra) tx2.objectStore(STORE).delete(e.key);
      await done(tx2);
    }
    db.close();
  } catch {
    /* the list is a convenience; never block real work on it */
  }
}

export async function removeRecent(key: string): Promise<void> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    await done(tx);
    db.close();
  } catch {
    /* ignore */
  }
}

export async function clearRecent(): Promise<void> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await done(tx);
    db.close();
  } catch {
    /* ignore */
  }
}
