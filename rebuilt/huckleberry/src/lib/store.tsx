import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppSettings, BabyEvent, Child, DiaperKind, EventType, FeedMethod, Side } from './types';
import { DEFAULT_SETTINGS } from './types';
import { createStorage, type Snapshot, type Storage } from './db';
import { uid } from './dataio';

interface StoreApi {
  ready: boolean;
  /** false when IndexedDB is unavailable and data lives only in memory */
  persistent: boolean;
  error: string | null;
  clearError(): void;
  children: Child[];
  events: BabyEvent[];
  settings: AppSettings;
  child: Child | null;
  childEvents: BabyEvent[];
  running: BabyEvent[];
  addChild(name: string, birthdate: string): Child;
  updateChild(id: string, patch: Partial<Omit<Child, 'id'>>): void;
  deleteChild(id: string): void;
  selectChild(id: string): void;
  setSettings(patch: Partial<AppSettings>): void;
  startTimer(type: Exclude<EventType, 'diaper'>, opts?: { method?: FeedMethod; at?: number }): BabyEvent | null;
  stopTimer(id: string, at?: number): BabyEvent | null;
  switchSide(id: string, side: Side): void;
  logDiaper(kind: DiaperKind, at?: number): BabyEvent | null;
  addEvent(e: Omit<BabyEvent, 'id' | 'childId'> & { childId?: string }): BabyEvent | null;
  updateEvent(id: string, patch: Partial<BabyEvent>): void;
  deleteEvent(id: string): BabyEvent | null;
  restoreEvent(e: BabyEvent): void;
  replaceAll(snap: Snapshot): Promise<void>;
  importMerged(children: Child[], events: BabyEvent[]): void;
}

const Ctx = createContext<StoreApi | null>(null);

export function useStore(): StoreApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside provider');
  return v;
}

/** pure helper: stop a running event at `at` (finalising the open breast side) */
export function finishEvent(e: BabyEvent, at: number): BabyEvent {
  const end = Math.max(at, e.start);
  const out: BabyEvent = { ...e, end };
  if (e.type === 'feed' && e.method === 'breast') {
    let left = e.leftMs ?? 0;
    let right = e.rightMs ?? 0;
    if (e.activeSide && e.sideSince != null) {
      const extra = Math.max(0, end - e.sideSince);
      if (e.activeSide === 'left') left += extra;
      else right += extra;
    }
    if (left > 0) out.leftMs = left;
    if (right > 0) out.rightMs = right;
    out.activeSide = null;
    out.sideSince = null;
  }
  return out;
}

export function StoreProvider({ children: kids }: { children: ReactNode }) {
  const [snap, setSnap] = useState<Snapshot>({ children: [], events: [], settings: DEFAULT_SETTINGS });
  const [ready, setReady] = useState(false);
  const [persistent, setPersistent] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const storage = useRef<Storage | null>(null);
  const snapRef = useRef(snap);
  snapRef.current = snap;

  useEffect(() => {
    let alive = true;
    (async () => {
      const st = await createStorage();
      storage.current = st;
      const loaded = await st.load();
      if (!alive) return;
      setPersistent(st.persistent);
      setSnap(loaded);
      setReady(true);
      if (st.persistent && navigator.storage?.persist) navigator.storage.persist().catch(() => undefined);
    })().catch((e) => {
      setError('Could not open local storage: ' + (e instanceof Error ? e.message : String(e)));
      storage.current = null;
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const fail = useCallback((e: unknown) => setError('Saving failed: ' + (e instanceof Error ? e.message : String(e))), []);
  const write = useCallback(
    (fn: (s: Storage) => Promise<void>) => {
      const st = storage.current;
      if (st) fn(st).catch(fail);
    },
    [fail],
  );

  const api = useMemo<StoreApi>(() => {
    const events = () => snapRef.current.events;
    const mutate = (fn: (s: Snapshot) => Snapshot) => {
      const next = fn(snapRef.current);
      snapRef.current = next;
      setSnap(next);
    };
    const selected = (s: Snapshot) => s.children.find((c) => c.id === s.settings.selectedChildId) ?? s.children[0] ?? null;
    const putEvent = (e: BabyEvent) => {
      mutate((s) => ({ ...s, events: [...s.events.filter((x) => x.id !== e.id), e] }));
      write((st) => st.putEvents([e]));
    };

    const base = {
      clearError: () => setError(null),
      addChild(name: string, birthdate: string) {
        const c: Child = { id: uid(), name: name.trim() || 'Baby', birthdate, createdAt: Date.now() };
        const settings = { ...snapRef.current.settings, selectedChildId: c.id };
        mutate((s) => ({ ...s, children: [...s.children, c], settings }));
        write(async (st) => {
          await st.putChild(c);
          await st.saveSettings(settings);
        });
        return c;
      },
      updateChild(id: string, patch: Partial<Omit<Child, 'id'>>) {
        const cur = snapRef.current.children.find((c) => c.id === id);
        if (!cur) return;
        const next = { ...cur, ...patch };
        mutate((s) => ({ ...s, children: s.children.map((c) => (c.id === id ? next : c)) }));
        write((st) => st.putChild(next));
      },
      deleteChild(id: string) {
        const remaining = snapRef.current.children.filter((c) => c.id !== id);
        const settings = {
          ...snapRef.current.settings,
          selectedChildId: snapRef.current.settings.selectedChildId === id ? remaining[0]?.id ?? null : snapRef.current.settings.selectedChildId,
        };
        mutate((s) => ({ children: remaining, events: s.events.filter((e) => e.childId !== id), settings }));
        write(async (st) => {
          await st.deleteChild(id);
          await st.saveSettings(settings);
        });
      },
      selectChild(id: string) {
        const settings = { ...snapRef.current.settings, selectedChildId: id };
        mutate((s) => ({ ...s, settings }));
        write((st) => st.saveSettings(settings));
      },
      setSettings(patch: Partial<AppSettings>) {
        const settings = { ...snapRef.current.settings, ...patch };
        mutate((s) => ({ ...s, settings }));
        write((st) => st.saveSettings(settings));
      },
      startTimer(type: Exclude<EventType, 'diaper'>, opts: { method?: FeedMethod; at?: number } = {}) {
        const c = selected(snapRef.current);
        if (!c) return null;
        if (events().some((e) => e.childId === c.id && e.type === type && e.end == null)) return null;
        const start = opts.at ?? Date.now();
        const e: BabyEvent = { id: uid(), childId: c.id, type, start, end: null };
        if (type === 'feed') {
          e.method = opts.method ?? 'breast';
          if (e.method === 'breast') {
            e.activeSide = null;
            e.sideSince = null;
          }
        }
        putEvent(e);
        return e;
      },
      stopTimer(id: string, at = Date.now()) {
        const cur = events().find((e) => e.id === id);
        if (!cur || cur.end != null) return null;
        const next = finishEvent(cur, at);
        putEvent(next);
        return next;
      },
      switchSide(id: string, side: Side) {
        const cur = events().find((e) => e.id === id);
        if (!cur || cur.end != null) return;
        if (cur.activeSide === side) return;
        const now = Date.now();
        const next: BabyEvent = { ...cur };
        if (cur.activeSide && cur.sideSince != null) {
          // bank the time on the side we are leaving
          const extra = Math.max(0, now - cur.sideSince);
          if (cur.activeSide === 'left') next.leftMs = (cur.leftMs ?? 0) + extra;
          else next.rightMs = (cur.rightMs ?? 0) + extra;
          next.sideSince = now;
        } else {
          // first side chosen: time since the feed began counts for it
          next.sideSince = cur.start;
        }
        next.activeSide = side;
        putEvent(next);
      },
      logDiaper(kind: DiaperKind, at = Date.now()) {
        const c = selected(snapRef.current);
        if (!c) return null;
        const e: BabyEvent = { id: uid(), childId: c.id, type: 'diaper', start: at, end: at, diaper: kind };
        putEvent(e);
        return e;
      },
      addEvent(e: Omit<BabyEvent, 'id' | 'childId'> & { childId?: string }) {
        const c = selected(snapRef.current);
        const childId = e.childId ?? c?.id;
        if (!childId) return null;
        const full: BabyEvent = { ...e, id: uid(), childId };
        putEvent(full);
        return full;
      },
      updateEvent(id: string, patch: Partial<BabyEvent>) {
        const cur = events().find((e) => e.id === id);
        if (!cur) return;
        putEvent({ ...cur, ...patch, id: cur.id, childId: patch.childId ?? cur.childId });
      },
      deleteEvent(id: string) {
        const cur = events().find((e) => e.id === id);
        if (!cur) return null;
        mutate((s) => ({ ...s, events: s.events.filter((e) => e.id !== id) }));
        write((st) => st.deleteEvents([id]));
        return cur;
      },
      restoreEvent(e: BabyEvent) {
        putEvent(e);
      },
      async replaceAll(next: Snapshot) {
        mutate(() => next);
        const st = storage.current;
        if (st) await st.replaceAll(next);
      },
      importMerged(children: Child[], evs: BabyEvent[]) {
        mutate((s) => {
          const cm = new Map(s.children.map((c) => [c.id, c]));
          for (const c of children) cm.set(c.id, c);
          const em = new Map(s.events.map((e) => [e.id, e]));
          for (const e of evs) em.set(e.id, e);
          return { ...s, children: [...cm.values()], events: [...em.values()] };
        });
        write(async (st) => {
          for (const c of children) await st.putChild(c);
          await st.putEvents(evs);
        });
      },
    };

    return base as unknown as StoreApi;
  }, [write]);

  const child = snap.children.find((c) => c.id === snap.settings.selectedChildId) ?? snap.children[0] ?? null;
  const childEvents = useMemo(() => (child ? snap.events.filter((e) => e.childId === child.id) : []), [snap.events, child]);
  const running = useMemo(() => childEvents.filter((e) => e.end == null), [childEvents]);

  const value: StoreApi = {
    ...api,
    ready,
    persistent,
    error,
    children: snap.children,
    events: snap.events,
    settings: snap.settings,
    child,
    childEvents,
    running,
  };
  return <Ctx.Provider value={value}>{kids}</Ctx.Provider>;
}
