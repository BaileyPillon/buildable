import { useSyncExternalStore } from 'react';
import type { DateKey, Entry, EntryMap, Habit, Settings } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import * as db from './db';
import { entryKey, isEmptyEntry } from './checkin';
import { mergeData, type AppData } from './exportImport';
import { newId, PALETTE } from './palette';
import { todayKey } from './dates';

export interface State {
  ready: boolean;
  error?: string; // set when IndexedDB is unavailable or a write failed
  habits: Habit[]; // sorted by order, includes archived
  entries: Record<string, EntryMap>; // habitId -> date -> entry
  settings: Settings;
}

let state: State = { ready: false, habits: [], entries: {}, settings: { ...DEFAULT_SETTINGS } };
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export const getState = () => state;
export const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export const useAppState = (): State => useSyncExternalStore(subscribe, getState, getState);

const byOrder = (a: Habit, b: Habit) => a.order - b.order || a.name.localeCompare(b.name);

function indexEntries(list: Entry[]): Record<string, EntryMap> {
  const out: Record<string, EntryMap> = {};
  for (const e of list) (out[e.habitId] ??= {})[e.date] = e;
  return out;
}

function flattenEntries(map: Record<string, EntryMap>): Entry[] {
  return Object.values(map).flatMap((m) => Object.values(m));
}

/* cross-tab sync */
let channel: BroadcastChannel | null = null;
function announce() {
  try {
    channel?.postMessage('changed');
  } catch {
    /* ignore */
  }
}

async function persist(write: () => Promise<void>) {
  try {
    await write();
    announce();
  } catch (err) {
    set({ error: `Could not save to this browser's storage: ${err instanceof Error ? err.message : String(err)}` });
  }
}

async function refresh() {
  try {
    const snap = await db.loadAll();
    set({ habits: snap.habits.sort(byOrder), entries: indexEntries(snap.entries), settings: snap.settings, ready: true });
  } catch (err) {
    set({ ready: true, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function initStore() {
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('habit-tracker-sync');
    channel.onmessage = () => void refresh();
  }
  await refresh();
}

export function dismissError() {
  set({ error: undefined });
}

/* ------------------------------------------------------------- selectors */

export const activeHabits = (s: State) => s.habits.filter((h) => !h.archived);
export const archivedHabits = (s: State) => s.habits.filter((h) => h.archived);
const NO_ENTRIES: EntryMap = {};
export const entriesOf = (s: State, habitId: string): EntryMap => s.entries[habitId] ?? NO_ENTRIES;
export const getHabit = (s: State, id: string) => s.habits.find((h) => h.id === id);

/* --------------------------------------------------------------- habits */

export type HabitInput = Omit<Habit, 'id' | 'order' | 'archived' | 'createdAt'> & { createdAt?: DateKey };

export function addHabit(input: HabitInput): Habit {
  const order = state.habits.reduce((m, h) => Math.max(m, h.order), -1) + 1;
  const habit: Habit = {
    ...input,
    id: newId(),
    order,
    archived: false,
    createdAt: input.createdAt ?? todayKey(),
    color: input.color || PALETTE[state.habits.length % PALETTE.length]!,
  };
  set({ habits: [...state.habits, habit].sort(byOrder) });
  void persist(() => db.putHabit(habit));
  return habit;
}

export function updateHabit(id: string, patch: Partial<Omit<Habit, 'id'>>) {
  const prev = getHabit(state, id);
  if (!prev) return;
  const next: Habit = { ...prev, ...patch };
  if (!next.goal) delete next.goal;
  if (!next.reminder) delete next.reminder;
  set({ habits: state.habits.map((h) => (h.id === id ? next : h)).sort(byOrder) });
  void persist(() => db.putHabit(next));
}

export function archiveHabit(id: string, archived: boolean) {
  if (archived) {
    updateHabit(id, { archived, reminder: undefined });
  } else {
    const order = state.habits.reduce((m, h) => Math.max(m, h.order), -1) + 1;
    updateHabit(id, { archived, order });
  }
}

export function deleteHabit(id: string) {
  const { [id]: _removed, ...rest } = state.entries;
  void _removed;
  set({ habits: state.habits.filter((h) => h.id !== id), entries: rest });
  void persist(() => db.deleteHabit(id));
}

/** Persist a new order for the active habits (archived ones keep theirs, after the active ones). */
export function reorderHabits(activeIdsInOrder: string[]) {
  const orderOf = new Map(activeIdsInOrder.map((id, i) => [id, i]));
  const archived = state.habits.filter((h) => h.archived);
  const next = state.habits.map((h) => {
    const o = orderOf.get(h.id);
    return o !== undefined ? { ...h, order: o } : { ...h, order: activeIdsInOrder.length + archived.indexOf(h) };
  });
  const changed = next.filter((h, i) => h.order !== state.habits[i]!.order);
  set({ habits: [...next].sort(byOrder) });
  void persist(() => db.putHabits(changed));
}

export function moveHabit(id: string, delta: -1 | 1) {
  const ids = activeHabits(state).map((h) => h.id);
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  reorderHabits(ids);
}

/* -------------------------------------------------------------- entries */

type Draft = Pick<Entry, 'status' | 'value' | 'note'>;

export function updateEntry(habitId: string, date: DateKey, fn: (prev?: Draft) => Draft) {
  const prev = state.entries[habitId]?.[date];
  const draft = fn(prev);
  const key = entryKey(habitId, date);
  const map = { ...(state.entries[habitId] ?? {}) };
  if (isEmptyEntry(draft)) {
    delete map[date];
    set({ entries: { ...state.entries, [habitId]: map } });
    if (prev) void persist(() => db.deleteEntry(key));
    return;
  }
  const entry: Entry = { key, habitId, date, status: draft.status, updatedAt: Date.now() };
  if (draft.value !== undefined) entry.value = draft.value;
  if (draft.note) entry.note = draft.note;
  map[date] = entry;
  set({ entries: { ...state.entries, [habitId]: map } });
  void persist(() => db.putEntry(entry));
}

/* ------------------------------------------------------------- settings */

export function updateSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch };
  set({ settings });
  void persist(() => db.saveSettings(settings));
}

/* ------------------------------------------------------- import / export */

export function snapshot(): Required<AppData> {
  return { habits: state.habits, entries: flattenEntries(state.entries), settings: state.settings };
}

export async function importData(incoming: AppData, mode: 'merge' | 'replace') {
  const merged = mergeData(snapshot(), incoming, mode);
  const habitIds = new Set(merged.habits.map((h) => h.id));
  const entries = merged.entries.filter((e) => habitIds.has(e.habitId));
  const snap = { habits: [...merged.habits].sort(byOrder), entries, settings: merged.settings };
  await db.replaceAll(snap);
  set({ habits: snap.habits, entries: indexEntries(entries), settings: snap.settings, error: undefined });
  announce();
}

export async function resetAll() {
  await db.replaceAll({ habits: [], entries: [], settings: { ...DEFAULT_SETTINGS } });
  set({ habits: [], entries: {}, settings: { ...DEFAULT_SETTINGS } });
  announce();
}
