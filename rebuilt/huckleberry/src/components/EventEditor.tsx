import { useState } from 'react';
import type { BabyEvent, BottleContent, DiaperKind, EventType, FeedMethod } from '../lib/types';
import { useStore } from '../lib/store';
import { fromLocalInput, toLocalInput, MIN } from '../lib/time';
import { mlToUnits, unitsToMl } from '../lib/share';
import { Icon, Modal, TYPE_LABEL, useToast } from './ui';

interface Draft {
  type: EventType;
  start: string;
  end: string;
  running: boolean;
  method: FeedMethod;
  leftMin: string;
  rightMin: string;
  amount: string;
  content: BottleContent | '';
  diaper: DiaperKind;
  notes: string;
}

const round1 = (n: number) => String(Math.round(n * 10) / 10);

function toDraft(e: BabyEvent | undefined, type: EventType, units: 'ml' | 'oz', now: number): Draft {
  if (!e) {
    const instant = type === 'diaper';
    return {
      type,
      start: toLocalInput(instant ? now : now - 20 * MIN),
      end: instant ? '' : toLocalInput(now),
      running: false,
      method: 'breast',
      leftMin: '',
      rightMin: '',
      amount: '',
      content: '',
      diaper: 'pee',
      notes: '',
    };
  }
  return {
    type: e.type,
    start: toLocalInput(e.start),
    end: e.end != null ? toLocalInput(e.end) : '',
    running: e.end == null,
    method: e.method ?? 'breast',
    leftMin: e.leftMs ? round1(e.leftMs / MIN) : '',
    rightMin: e.rightMs ? round1(e.rightMs / MIN) : '',
    amount: e.amountMl ? round1(mlToUnits(e.amountMl, units)) : '',
    content: e.content ?? '',
    diaper: e.diaper ?? 'pee',
    notes: e.notes ?? '',
  };
}

export function EventEditor({ event, initialType = 'sleep', onClose }: { event?: BabyEvent; initialType?: EventType; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const units = store.settings.units;
  const [d, setD] = useState<Draft>(() => toDraft(event, event?.type ?? initialType, units, Date.now()));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const isNew = !event;
  const instant = d.type === 'diaper';

  const shiftStart = (minutesAgo: number) => {
    const oldStart = fromLocalInput(d.start);
    const oldEnd = d.end ? fromLocalInput(d.end) : null;
    const newStart = Date.now() - minutesAgo * MIN;
    setD((x) => ({
      ...x,
      start: toLocalInput(newStart),
      // keep the duration when an end exists so backdating a finished entry moves it as a block
      end: oldStart != null && oldEnd != null && !x.running ? toLocalInput(newStart + (oldEnd - oldStart)) : x.end,
    }));
  };

  const save = () => {
    const start = fromLocalInput(d.start);
    if (start == null) return setError('Enter a start time.');
    if (start > Date.now() + 5 * MIN) return setError('Start time is in the future.');
    let end: number | null = null;
    if (instant) end = start;
    else if (!d.running) {
      const e = fromLocalInput(d.end);
      if (e == null) return setError('Enter an end time, or tick "Still running".');
      if (e < start) return setError('End time is before the start time.');
      end = e;
    }
    if (d.running && store.running.some((r) => r.type === d.type && r.id !== event?.id)) {
      return setError(`Another ${TYPE_LABEL[d.type].toLowerCase()} timer is already running.`);
    }
    const base: Partial<BabyEvent> = { type: d.type, start, end, notes: d.notes.trim() || undefined };
    if (d.type === 'feed') {
      base.method = d.method;
      if (d.method === 'breast') {
        base.amountMl = undefined;
        base.content = undefined;
        if (!d.running) {
          const l = parseFloat(d.leftMin);
          const r = parseFloat(d.rightMin);
          base.leftMs = l > 0 ? Math.round(l * MIN) : undefined;
          base.rightMs = r > 0 ? Math.round(r * MIN) : undefined;
          base.activeSide = null;
          base.sideSince = null;
        }
      } else {
        const a = parseFloat(d.amount);
        base.amountMl = a > 0 ? Math.round(unitsToMl(a, units)) : undefined;
        base.content = d.content || undefined;
        base.leftMs = base.rightMs = undefined;
        base.activeSide = null;
        base.sideSince = null;
      }
    }
    if (d.type === 'pump') {
      const a = parseFloat(d.amount);
      base.amountMl = a > 0 ? Math.round(unitsToMl(a, units)) : undefined;
    }
    if (d.type === 'diaper') base.diaper = d.diaper;
    if (event) store.updateEvent(event.id, base);
    else store.addEvent({ ...(base as Omit<BabyEvent, 'id' | 'childId'>), end });
    toast(isNew ? 'Entry added' : 'Entry saved');
    onClose();
  };

  const remove = () => {
    if (!event) return;
    const gone = store.deleteEvent(event.id);
    onClose();
    if (gone) toast('Entry deleted', { label: 'Undo', run: () => store.restoreEvent(gone) });
  };

  return (
    <Modal title={isNew ? 'Add entry' : `Edit ${TYPE_LABEL[d.type].toLowerCase()}`} onClose={onClose}>
      <div className="form">
        {isNew && (
          <div className="seg" role="group" aria-label="Entry type">
            {(['sleep', 'feed', 'diaper', 'pump'] as EventType[]).map((t) => (
              <button key={t} className={d.type === t ? 'on' : ''} onClick={() => setD(toDraft(undefined, t, units, Date.now()))}>
                <Icon name={t} size={18} /> {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        )}

        <label>
          {instant ? 'Time' : 'Started'}
          <input type="datetime-local" value={d.start} onChange={(e) => set('start', e.target.value)} />
        </label>
        <div className="chips" aria-label="Backdate">
          <span>Backdate:</span>
          {[0, 5, 10, 15, 30, 60].map((m) => (
            <button key={m} type="button" className="chip" onClick={() => shiftStart(m)}>
              {m === 0 ? 'now' : m === 60 ? '1 h ago' : `${m} min ago`}
            </button>
          ))}
        </div>

        {!instant && (
          <>
            <label className="check">
              <input type="checkbox" checked={d.running} onChange={(e) => set('running', e.target.checked)} />
              Still running (timer keeps going)
            </label>
            {!d.running && (
              <label>
                Ended
                <input type="datetime-local" value={d.end} onChange={(e) => set('end', e.target.value)} />
              </label>
            )}
          </>
        )}

        {d.type === 'feed' && (
          <>
            <div className="seg" role="group" aria-label="Feed type">
              {(['breast', 'bottle'] as FeedMethod[]).map((m) => (
                <button key={m} className={d.method === m ? 'on' : ''} onClick={() => set('method', m)}>
                  <Icon name={m} size={18} /> {m === 'breast' ? 'Breast' : 'Bottle'}
                </button>
              ))}
            </div>
            {d.method === 'breast' ? (
              !d.running && (
                <div className="row2">
                  <label>
                    Left (min)
                    <input inputMode="decimal" value={d.leftMin} onChange={(e) => set('leftMin', e.target.value)} />
                  </label>
                  <label>
                    Right (min)
                    <input inputMode="decimal" value={d.rightMin} onChange={(e) => set('rightMin', e.target.value)} />
                  </label>
                </div>
              )
            ) : (
              <div className="row2">
                <label>
                  Amount ({units})
                  <input inputMode="decimal" value={d.amount} onChange={(e) => set('amount', e.target.value)} />
                </label>
                <label>
                  Contents
                  <select value={d.content} onChange={(e) => set('content', e.target.value as BottleContent | '')}>
                    <option value="">Not set</option>
                    <option value="breastmilk">Breast milk</option>
                    <option value="formula">Formula</option>
                    <option value="other">Other</option>
                  </select>
                </label>
              </div>
            )}
          </>
        )}

        {d.type === 'pump' && (
          <label>
            Amount ({units})
            <input inputMode="decimal" value={d.amount} onChange={(e) => set('amount', e.target.value)} />
          </label>
        )}

        {d.type === 'diaper' && (
          <div className="seg" role="group" aria-label="Diaper contents">
            {(['pee', 'poo', 'both', 'dry'] as DiaperKind[]).map((k) => (
              <button key={k} className={d.diaper === k ? 'on' : ''} onClick={() => set('diaper', k)}>
                {k === 'pee' ? 'Wet' : k === 'poo' ? 'Dirty' : k === 'both' ? 'Both' : 'Dry'}
              </button>
            ))}
          </div>
        )}

        <label>
          Notes
          <textarea rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </label>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          {!isNew && (
            <button className="danger" onClick={remove}>
              Delete
            </button>
          )}
          <span className="grow" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
