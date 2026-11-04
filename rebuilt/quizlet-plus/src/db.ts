/** IndexedDB storage: decks, cards (with image Blobs), review log and settings. No backend. */
import { DEFAULT_SETTINGS, type Card, type Deck, type ReviewLog, type Settings } from './types';
import { startOfDay } from './scheduler';
import { State } from './types';

const DB_NAME = 'flashcards-plus';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('decks', { keyPath: 'id' });
      const cards = db.createObjectStore('cards', { keyPath: 'id' });
      cards.createIndex('deckId', 'deckId');
      const reviews = db.createObjectStore('reviews', { keyPath: 'id', autoIncrement: true });
      reviews.createIndex('ts', 'ts');
      reviews.createIndex('deckId', 'deckId');
      db.createObjectStore('meta');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('Could not open the local database.'));
    req.onblocked = () => reject(new Error('Database is open in another tab; close it and reload.'));
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

const wrap = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

const finished = (tx: IDBTransaction): Promise<void> =>
  new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error ?? new Error('Transaction aborted'));
  });

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

// ------------------------------------------------------------ decks

export async function listDecks(): Promise<Deck[]> {
  const db = await openDb();
  const decks = await wrap<Deck[]>(db.transaction('decks').objectStore('decks').getAll());
  return decks.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export async function getDeck(id: string): Promise<Deck | undefined> {
  const db = await openDb();
  return wrap<Deck | undefined>(db.transaction('decks').objectStore('decks').get(id));
}

export async function putDeck(deck: Deck): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('decks', 'readwrite');
  tx.objectStore('decks').put(deck);
  await finished(tx);
}

export async function createDeck(name: string, settings: Settings): Promise<Deck> {
  const deck: Deck = {
    id: uid(),
    name: name.trim() || 'Untitled deck',
    description: '',
    createdAt: Date.now(),
    newPerDay: settings.defaultNewPerDay,
    reviewsPerDay: settings.defaultReviewsPerDay,
  };
  await putDeck(deck);
  return deck;
}

/** Deletes the deck, its cards and its review history. */
export async function deleteDeck(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['decks', 'cards', 'reviews'], 'readwrite');
  tx.objectStore('decks').delete(id);
  const cards = tx.objectStore('cards');
  const ckeys = await wrap(cards.index('deckId').getAllKeys(id));
  for (const k of ckeys) cards.delete(k);
  const reviews = tx.objectStore('reviews');
  const rkeys = await wrap(reviews.index('deckId').getAllKeys(id));
  for (const k of rkeys) reviews.delete(k);
  await finished(tx);
}

// ------------------------------------------------------------ cards

export async function listCards(deckId?: string): Promise<Card[]> {
  const db = await openDb();
  const store = db.transaction('cards').objectStore('cards');
  return deckId ? wrap<Card[]>(store.index('deckId').getAll(deckId)) : wrap<Card[]>(store.getAll());
}

export async function getCard(id: string): Promise<Card | undefined> {
  const db = await openDb();
  return wrap<Card | undefined>(db.transaction('cards').objectStore('cards').get(id));
}

export async function putCard(card: Card): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('cards', 'readwrite');
  tx.objectStore('cards').put(card);
  await finished(tx);
}

export async function putCards(cards: Card[]): Promise<void> {
  if (!cards.length) return;
  const db = await openDb();
  const tx = db.transaction('cards', 'readwrite');
  const store = tx.objectStore('cards');
  for (const c of cards) store.put(c);
  await finished(tx);
}

export async function deleteCard(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('cards', 'readwrite');
  tx.objectStore('cards').delete(id);
  await finished(tx);
}

// ------------------------------------------------------------ reviews

/** Saves the updated card and its review log entry in one transaction. Returns the log id. */
export async function saveReview(card: Card, log: ReviewLog): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(['cards', 'reviews'], 'readwrite');
  tx.objectStore('cards').put(card);
  const idReq = tx.objectStore('reviews').add(log);
  await finished(tx);
  return idReq.result as number;
}

/** Undo: restore the card as it was and drop the log entry. */
export async function undoReview(before: Card, logId: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['cards', 'reviews'], 'readwrite');
  tx.objectStore('cards').put(before);
  tx.objectStore('reviews').delete(logId);
  await finished(tx);
}

export async function listReviews(since?: number, deckId?: string): Promise<ReviewLog[]> {
  const db = await openDb();
  const store = db.transaction('reviews').objectStore('reviews');
  const all = since === undefined ? await wrap<ReviewLog[]>(store.getAll()) : await wrap<ReviewLog[]>(store.index('ts').getAll(IDBKeyRange.lowerBound(since)));
  return deckId ? all.filter((r) => r.deckId === deckId) : all;
}

export interface TodayCounts {
  newDone: number;
  reviewsDone: number;
}

/** How many new cards were first-reviewed today and how many review-state answers were given today. */
export async function todayCounts(deckId: string, now = Date.now()): Promise<TodayCounts> {
  const logs = await listReviews(startOfDay(now), deckId);
  const newIds = new Set<string>();
  let reviewsDone = 0;
  for (const l of logs) {
    if (l.prevState === State.New) newIds.add(l.cardId);
    else if (l.prevState === State.Review) reviewsDone += 1;
  }
  return { newDone: newIds.size, reviewsDone };
}

// ------------------------------------------------------------ settings / meta

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return wrap<T | undefined>(db.transaction('meta').objectStore('meta').get(key));
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put(value, key);
  await finished(tx);
}

export async function loadSettings(): Promise<Settings> {
  const saved = await getMeta<Partial<Settings>>('settings');
  return { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await setMeta('settings', s);
}

// ------------------------------------------------------------ whole-database operations

export interface Snapshot {
  decks: Deck[];
  cards: Card[];
  reviews: ReviewLog[];
}

export async function snapshot(): Promise<Snapshot> {
  const db = await openDb();
  const tx = db.transaction(['decks', 'cards', 'reviews']);
  const [decks, cards, reviews] = await Promise.all([
    wrap<Deck[]>(tx.objectStore('decks').getAll()),
    wrap<Card[]>(tx.objectStore('cards').getAll()),
    wrap<ReviewLog[]>(tx.objectStore('reviews').getAll()),
  ]);
  return { decks, cards, reviews };
}

/** Writes decks/cards/reviews in one transaction; `replace` wipes everything first. */
export async function writeAll(data: Snapshot, replace: boolean): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['decks', 'cards', 'reviews'], 'readwrite');
  const decks = tx.objectStore('decks');
  const cards = tx.objectStore('cards');
  const reviews = tx.objectStore('reviews');
  if (replace) {
    decks.clear();
    cards.clear();
    reviews.clear();
  }
  for (const d of data.decks) decks.put(d);
  for (const c of data.cards) cards.put(c);
  // review ids are auto-assigned; a restored log never overwrites an existing entry
  for (const r of data.reviews) {
    const { id: _id, ...rest } = r;
    reviews.add(rest);
  }
  await finished(tx);
}

export async function estimateStorage(): Promise<{ usage: number; quota: number; persisted: boolean } | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    const persisted = (await navigator.storage?.persisted?.()) ?? false;
    return { usage: est?.usage ?? 0, quota: est?.quota ?? 0, persisted };
  } catch {
    return null;
  }
}

export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
