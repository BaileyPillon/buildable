import type { Entry, Habit, Settings } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { normalizeSettings } from './exportImport';

const DB_NAME = 'habit-tracker';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('habits')) db.createObjectStore('habits', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('entries')) {
        const s = db.createObjectStore('entries', { keyPath: 'key' });
        s.createIndex('byHabit', 'habitId');
        s.createIndex('byDate', 'date');
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('Could not open the database.'));
    req.onblocked = () => reject(new Error('The database is blocked by another tab.'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });

const result = <T,>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export interface Snapshot {
  habits: Habit[];
  entries: Entry[];
  settings: Settings;
}

export async function loadAll(): Promise<Snapshot> {
  const db = await openDb();
  const tx = db.transaction(['habits', 'entries', 'meta'], 'readonly');
  const [habits, entries, meta] = await Promise.all([
    result(tx.objectStore('habits').getAll() as IDBRequest<Habit[]>),
    result(tx.objectStore('entries').getAll() as IDBRequest<Entry[]>),
    result(tx.objectStore('meta').get('settings') as IDBRequest<{ key: string; value: unknown } | undefined>),
  ]);
  return { habits, entries, settings: meta ? normalizeSettings(meta.value) : { ...DEFAULT_SETTINGS } };
}

export async function putHabit(h: Habit) {
  const db = await openDb();
  const tx = db.transaction('habits', 'readwrite');
  tx.objectStore('habits').put(h);
  await done(tx);
}

export async function putHabits(list: Habit[]) {
  const db = await openDb();
  const tx = db.transaction('habits', 'readwrite');
  for (const h of list) tx.objectStore('habits').put(h);
  await done(tx);
}

export async function deleteHabit(id: string) {
  const db = await openDb();
  const tx = db.transaction(['habits', 'entries'], 'readwrite');
  tx.objectStore('habits').delete(id);
  const idx = tx.objectStore('entries').index('byHabit');
  const cur = idx.openKeyCursor(IDBKeyRange.only(id));
  cur.onsuccess = () => {
    const c = cur.result;
    if (c) {
      tx.objectStore('entries').delete(c.primaryKey);
      c.continue();
    }
  };
  await done(tx);
}

export async function putEntry(e: Entry) {
  const db = await openDb();
  const tx = db.transaction('entries', 'readwrite');
  tx.objectStore('entries').put(e);
  await done(tx);
}

export async function deleteEntry(key: string) {
  const db = await openDb();
  const tx = db.transaction('entries', 'readwrite');
  tx.objectStore('entries').delete(key);
  await done(tx);
}

export async function saveSettings(s: Settings) {
  const db = await openDb();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put({ key: 'settings', value: s });
  await done(tx);
}

/** Replace the whole database in one transaction (import / reset). */
export async function replaceAll(snap: Snapshot) {
  const db = await openDb();
  const tx = db.transaction(['habits', 'entries', 'meta'], 'readwrite');
  tx.objectStore('habits').clear();
  tx.objectStore('entries').clear();
  for (const h of snap.habits) tx.objectStore('habits').put(h);
  for (const e of snap.entries) tx.objectStore('entries').put(e);
  tx.objectStore('meta').put({ key: 'settings', value: snap.settings });
  await done(tx);
}
