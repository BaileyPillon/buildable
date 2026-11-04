/** Bridges the pure import/export formats to IndexedDB (cards with image Blobs). */
import {
  BACKUP_APP,
  BACKUP_VERSION,
  cardsToCsv,
  toCsv,
  type ImportBundle,
  type ImportCard,
  type ImportDeck,
} from './io';
import * as db from './db';
import { blobToDataUrl, dataUrlToBlob } from './images';
import { newSchedFields } from './scheduler';
import type { Card, Deck, ReviewLog, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';

async function exportCard(c: Card) {
  const out: Record<string, unknown> = {
    id: c.id,
    front: c.front,
    back: c.back,
    createdAt: c.createdAt,
    sched: {
      state: c.state,
      due: c.due,
      stability: c.stability,
      difficulty: c.difficulty,
      reps: c.reps,
      lapses: c.lapses,
      lastReview: c.lastReview,
      scheduledDays: c.scheduledDays,
    },
  };
  if (c.frontImage) out.frontImage = await blobToDataUrl(c.frontImage);
  if (c.backImage) out.backImage = await blobToDataUrl(c.backImage);
  return out;
}

async function exportDeck(deck: Deck, cards: Card[]) {
  return {
    id: deck.id,
    name: deck.name,
    description: deck.description,
    newPerDay: deck.newPerDay,
    reviewsPerDay: deck.reviewsPerDay,
    createdAt: deck.createdAt,
    cards: await Promise.all(cards.map(exportCard)),
  };
}

function exportReview(r: ReviewLog) {
  const { id: _id, ...rest } = r;
  return rest;
}

/** Everything: decks, cards, images, scheduling state, full review history and settings. */
export async function buildBackupJson(): Promise<string> {
  const snap = await db.snapshot();
  const settings = await db.loadSettings();
  const byDeck = new Map<string, Card[]>();
  for (const c of snap.cards) {
    const list = byDeck.get(c.deckId) ?? [];
    list.push(c);
    byDeck.set(c.deckId, list);
  }
  const decks = await Promise.all(snap.decks.map((d) => exportDeck(d, byDeck.get(d.id) ?? [])));
  return JSON.stringify({
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    decks,
    reviews: snap.reviews.map(exportReview),
  });
}

/** One deck as JSON: cards, images and scheduling, but no review history. */
export async function buildDeckJson(deckId: string): Promise<string> {
  const deck = await db.getDeck(deckId);
  if (!deck) throw new Error('Deck not found.');
  const cards = await db.listCards(deckId);
  return JSON.stringify({
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    decks: [await exportDeck(deck, cards)],
  });
}

/** CSV is text only: front and back. Images and scheduling are not part of CSV (use JSON for those). */
export async function buildDeckCsv(deckId: string): Promise<string> {
  const cards = (await db.listCards(deckId)).sort((a, b) => a.createdAt - b.createdAt);
  return '﻿' + cardsToCsv(cards);
}

export async function buildAllCsv(): Promise<string> {
  const decks = await db.listDecks();
  const rows: string[][] = [['deck', 'front', 'back']];
  for (const d of decks) {
    const cards = (await db.listCards(d.id)).sort((a, b) => a.createdAt - b.createdAt);
    for (const c of cards) rows.push([d.name, c.front, c.back]);
  }
  return '﻿' + toCsv(rows);
}

export function toCard(ic: ImportCard, deckId: string, keepId: boolean, now: number, offset: number): Card {
  const created = ic.createdAt ?? now + offset;
  const card: Card = {
    id: keepId && ic.id ? ic.id : db.uid(),
    deckId,
    front: ic.front,
    back: ic.back,
    createdAt: created,
    updatedAt: now,
    ...(ic.sched ?? newSchedFields(now)),
  };
  if (ic.frontImage) card.frontImage = dataUrlToBlob(ic.frontImage);
  if (ic.backImage) card.backImage = dataUrlToBlob(ic.backImage);
  return card;
}

export type RestoreMode = 'merge' | 'copy' | 'replace';

export interface ImportSummary {
  decks: number;
  cards: number;
  reviews: number;
}

/**
 * Plain card lists always become new cards. For this app's own backups, `merge` upserts by id,
 * `copy` creates fresh ids (nothing is overwritten) and `replace` empties the database first.
 */
export async function applyBundle(
  bundle: ImportBundle,
  mode: RestoreMode,
  settings: Settings,
  intoDeckId?: string,
): Promise<ImportSummary> {
  const now = Date.now();
  const keepIds = bundle.isBackup && mode !== 'copy';
  const decks: Deck[] = [];
  const cards: Card[] = [];
  const idMap = new Map<string, string>();

  let target: Deck | undefined;
  if (intoDeckId) target = await db.getDeck(intoDeckId);

  const addDeck = (src: ImportDeck): Deck => {
    const id = keepIds && src.id ? src.id : db.uid();
    if (src.id) idMap.set(src.id, id);
    const deck: Deck = {
      id,
      name: src.name,
      description: src.description ?? '',
      createdAt: src.createdAt ?? now,
      newPerDay: src.newPerDay ?? settings.defaultNewPerDay,
      reviewsPerDay: src.reviewsPerDay ?? settings.defaultReviewsPerDay,
    };
    decks.push(deck);
    return deck;
  };

  for (const src of bundle.decks) {
    const deck = target ?? addDeck(src);
    src.cards.forEach((ic, i) => {
      const card = toCard(ic, deck.id, keepIds, now, i);
      if (ic.id) idMap.set(ic.id, card.id);
      cards.push(card);
    });
  }

  const existingKeys = new Set<string>();
  if (mode === 'merge') {
    for (const r of await db.listReviews()) existingKeys.add(`${r.cardId}|${r.ts}`);
  }
  const reviews: ReviewLog[] = [];
  if (bundle.isBackup && !target) {
    for (const r of bundle.reviews) {
      const cardId = idMap.get(r.cardId);
      const deckId = idMap.get(r.deckId);
      if (!cardId || !deckId) continue;
      if (existingKeys.has(`${cardId}|${r.ts}`)) continue;
      reviews.push({ ...r, cardId, deckId });
    }
  }

  await db.writeAll({ decks, cards, reviews }, mode === 'replace' && bundle.isBackup);
  if (bundle.isBackup && bundle.settings && mode === 'replace') {
    await db.saveSettings({ ...DEFAULT_SETTINGS, ...bundle.settings });
  }
  return { decks: target ? 0 : decks.length, cards: cards.length, reviews: reviews.length };
}

export async function markBackedUp(): Promise<void> {
  await db.setMeta('lastBackup', Date.now());
}
