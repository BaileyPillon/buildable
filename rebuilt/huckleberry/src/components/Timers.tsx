import { useState } from 'react';
import type { BabyEvent, DiaperKind, EventType } from '../lib/types';
import { useStore } from '../lib/store';
import { formatClock, formatTimer } from '../lib/time';
import { breastMs } from '../lib/summary';
import { Icon, TYPE_LABEL, useNow, useToast } from './ui';
import { EventEditor } from './EventEditor';

const TIMED: { type: Exclude<EventType, 'diaper'>; method?: 'breast' | 'bottle'; label: string; icon: string }[] = [
  { type: 'sleep', label: 'Sleep', icon: 'sleep' },
  { type: 'feed', method: 'breast', label: 'Breast', icon: 'breast' },
  { type: 'feed', method: 'bottle', label: 'Bottle', icon: 'bottle' },
  { type: 'pump', label: 'Pump', icon: 'pump' },
];

function runningLabel(e: BabyEvent): string {
  if (e.type === 'feed') return e.method === 'bottle' ? 'Bottle feed' : 'Breast feed';
  return TYPE_LABEL[e.type];
}

export function Timers() {
  const store = useStore();
  const toast = useToast();
  const now = useNow(1000);
  const [editing, setEditing] = useState<BabyEvent | null>(null);
  const [lastDiaper, setLastDiaper] = useState<{ id: string; kind: DiaperKind } | null>(null);

  const runningOf = (t: (typeof TIMED)[number]) =>
    store.running.find((r) => r.type === t.type && (t.type !== 'feed' || r.method === t.method));
  const feedBusy = store.running.some((r) => r.type === 'feed');

  const tap = (t: (typeof TIMED)[number]) => {
    const r = runningOf(t);
    if (r) {
      const stopped = store.stopTimer(r.id);
      // bottle and pump want an amount: open the editor straight away
      if (stopped && (stopped.type === 'pump' || stopped.method === 'bottle')) setEditing(stopped);
      else toast(`${runningLabel(r)} saved`);
      return;
    }
    if (t.type === 'feed' && feedBusy) {
      toast('Stop the running feed first');
      return;
    }
    store.startTimer(t.type, { method: t.method });
  };

  const diaper = (kind: DiaperKind) => {
    const e = store.logDiaper(kind);
    if (e) {
      setLastDiaper({ id: e.id, kind });
      toast(`Diaper logged at ${formatClock(e.start)}`, { label: 'Undo', run: () => store.deleteEvent(e.id) });
    }
  };

  return (
    <section aria-label="Timers">
      {store.running.length > 0 && (
        <div className="running">
          {store.running.map((r) => (
            <div className={`run-card t-${r.type}`} key={r.id}>
              <div className="run-top">
                <Icon name={r.type === 'feed' ? r.method ?? 'breast' : r.type} />
                <div className="grow">
                  <strong>{runningLabel(r)}</strong>
                  <div className="muted small">since {formatClock(r.start)}</div>
                </div>
                <div className="clock" aria-live="off">
                  {formatTimer(now - r.start)}
                </div>
              </div>
              {r.type === 'feed' && r.method === 'breast' && (
                <div className="sides">
                  {(['left', 'right'] as const).map((s) => {
                    const banked = s === 'left' ? r.leftMs ?? 0 : r.rightMs ?? 0;
                    const live = r.activeSide === s && r.sideSince != null ? now - r.sideSince : 0;
                    return (
                      <button key={s} className={r.activeSide === s ? 'on' : ''} onClick={() => store.switchSide(r.id, s)} aria-pressed={r.activeSide === s}>
                        {s === 'left' ? 'Left' : 'Right'} <span className="mono">{formatTimer(banked + live)}</span>
                      </button>
                    );
                  })}
                  <span className="muted small">total {formatTimer(breastMs(r, now))}</span>
                </div>
              )}
              <div className="actions">
                <button onClick={() => setEditing(r)}>Edit / backdate</button>
                <button
                  onClick={() => {
                    const gone = store.deleteEvent(r.id);
                    if (gone) toast('Timer discarded', { label: 'Undo', run: () => store.restoreEvent(gone) });
                  }}
                >
                  Discard
                </button>
                <span className="grow" />
                <button className="primary" onClick={() => tap({ type: r.type as Exclude<EventType, 'diaper'>, method: r.method, label: '', icon: '' })}>
                  <Icon name="stop" size={16} /> Stop
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="tiles">
        {TIMED.map((t) => {
          const r = runningOf(t);
          const disabled = !r && t.type === 'feed' && feedBusy;
          return (
            <button key={t.label} className={`tile t-${t.type} ${r ? 'live' : ''}`} onClick={() => tap(t)} disabled={disabled} aria-pressed={!!r}>
              <Icon name={t.icon} size={28} />
              <span>{r ? 'Stop' : t.label}</span>
              <small>{r ? formatTimer(now - r.start) : 'tap to start'}</small>
            </button>
          );
        })}
        <div className="tile diaper-tile t-diaper">
          <div className="diaper-head">
            <Icon name="diaper" size={22} /> <span>Diaper</span>
          </div>
          <div className="diaper-btns">
            {([
              ['pee', 'Wet'],
              ['poo', 'Dirty'],
              ['both', 'Both'],
            ] as [DiaperKind, string][]).map(([k, label]) => (
              <button key={k} onClick={() => diaper(k)} className={lastDiaper?.kind === k ? 'recent' : ''}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="muted small hint">Tapping logs it now. Forgot to tap? Use Edit / backdate on a running timer, or Add past entry below.</p>
      {editing && <EventEditor event={store.events.find((e) => e.id === editing.id) ?? editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

