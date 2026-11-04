import type { AppSettings, BabyEvent, Child } from './types';
import { DEFAULT_SETTINGS } from './types';

const DB_NAME = 'nestlog';
const DB_VERSION = 1;

export interface Snapshot {
  children: Child[];
  events: BabyEvent[];
  settings: AppSettings;
}

/** Storage backend; IndexedDB in the browser, in-memory when IndexedDB is unavailable. */
export interface Storage {
  readonly persistent: boolean;
  load(): Promise<Snapshot>;
  putChild(c: Child): Promise<void>;
  deleteChild(id: string): Promise<void>;
  putEvents(e: BabyEvent[]): Promise<void>;
  deleteEvents(ids: string[]): Promise<void>;
  saveSettings(s: AppSettings): Promise<void>;
  replaceAll(snap: Snapshot): Promise<void>;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

export function openDb(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      db.createObjectStore('children', { keyPath: 'id' });
      const ev = db.createObjectStore('events', { keyPath: 'id' });
      ev.createIndex('childId', 'childId');
      ev.createIndex('start', 'start');
      db.createObjectStore('settings', { keyPath: 'key' });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('Database upgrade blocked by another tab'));
  });
}

export class IdbStorage implements Storage {
  readonly persistent = true;
  constructor(private db: IDBDatabase) {}

  async load(): Promise<Snapshot> {
    const tx = this.db.transaction(['children', 'events', 'settings'], 'readonly');
    const [children, events, settingsRow] = await Promise.all([
      req(tx.objectStore('children').getAll() as IDBRequest<Child[]>),
      req(tx.objectStore('events').getAll() as IDBRequest<BabyEvent[]>),
      req(tx.objectStore('settings').get('app') as IDBRequest<{ key: string; value: AppSettings } | undefined>),
    ]);
    return { children, events, settings: { ...DEFAULT_SETTINGS, ...(settingsRow?.value ?? {}) } };
  }
  async putChild(c: Child) {
    const tx = this.db.transaction('children', 'readwrite');
    tx.objectStore('children').put(c);
    await done(tx);
  }
  async deleteChild(id: string) {
    const tx = this.db.transaction(['children', 'events'], 'readwrite');
    tx.objectStore('children').delete(id);
    const store = tx.objectStore('events');
    const keys = await req(store.index('childId').getAllKeys(id));
    for (const k of keys) store.delete(k);
    await done(tx);
  }
  async putEvents(events: BabyEvent[]) {
    if (!events.length) return;
    const tx = this.db.transaction('events', 'readwrite');
    const store = tx.objectStore('events');
    for (const e of events) store.put(e);
    await done(tx);
  }
  async deleteEvents(ids: string[]) {
    if (!ids.length) return;
    const tx = this.db.transaction('events', 'readwrite');
    const store = tx.objectStore('events');
    for (const id of ids) store.delete(id);
    await done(tx);
  }
  async saveSettings(s: AppSettings) {
    const tx = this.db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ key: 'app', value: s });
    await done(tx);
  }
  async replaceAll(snap: Snapshot) {
    const tx = this.db.transaction(['children', 'events', 'settings'], 'readwrite');
    tx.objectStore('children').clear();
    tx.objectStore('events').clear();
    for (const c of snap.children) tx.objectStore('children').put(c);
    for (const e of snap.events) tx.objectStore('events').put(e);
    tx.objectStore('settings').put({ key: 'app', value: snap.settings });
    await done(tx);
  }
}

export class MemoryStorage implements Storage {
  readonly persistent = false;
  private snap: Snapshot = { children: [], events: [], settings: { ...DEFAULT_SETTINGS } };
  async load() {
    return structuredClone(this.snap);
  }
  async putChild(c: Child) {
    this.snap.children = [...this.snap.children.filter((x) => x.id !== c.id), structuredClone(c)];
  }
  async deleteChild(id: string) {
    this.snap.children = this.snap.children.filter((c) => c.id !== id);
    this.snap.events = this.snap.events.filter((e) => e.childId !== id);
  }
  async putEvents(events: BabyEvent[]) {
    const ids = new Set(events.map((e) => e.id));
    this.snap.events = [...this.snap.events.filter((e) => !ids.has(e.id)), ...structuredClone(events)];
  }
  async deleteEvents(ids: string[]) {
    const set = new Set(ids);
    this.snap.events = this.snap.events.filter((e) => !set.has(e.id));
  }
  async saveSettings(s: AppSettings) {
    this.snap.settings = { ...s };
  }
  async replaceAll(snap: Snapshot) {
    this.snap = structuredClone(snap);
  }
}

export async function createStorage(): Promise<Storage> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable');
    return new IdbStorage(await openDb());
  } catch {
    return new MemoryStorage();
  }
}
