import { useMemo, useState } from 'react';
import type { BabyEvent } from '../lib/types';
import { useStore } from '../lib/store';
import { DAY, addDays, formatClock, formatDayLabel, startOfDay, formatDuration } from '../lib/time';
import { describeEvent } from '../lib/describe';
import { eventsForDay, summarizeDay } from '../lib/summary';
import { Icon, useNow } from './ui';
import { EventEditor } from './EventEditor';

function DayStrip({ events, dayStart, now }: { events: BabyEvent[]; dayStart: number; now: number }) {
  const dayEnd = addDays(dayStart, 1);
  const len = dayEnd - dayStart || DAY;
  const frac = (ms: number) => Math.min(100, Math.max(0, ((ms - dayStart) / len) * 100));
  return (
    <div className="daystrip" role="img" aria-label="24 hour view of the day">
      {events.map((e) => {
        if (e.type === 'sleep') {
          const from = Math.max(e.start, dayStart);
          const to = Math.min(e.end ?? now, dayEnd);
          if (to <= from) return null;
          return <span key={e.id} className="seg-sleep" style={{ left: `${frac(from)}%`, width: `${Math.max(0.4, frac(to) - frac(from))}%` }} />;
        }
        return <span key={e.id} className={`tick t-${e.type}`} style={{ left: `${frac(e.start)}%` }} />;
      })}
      <div className="hours">
        {['12a', '6a', '12p', '6p', '12a'].map((h, i) => (
          <span key={i}>{h}</span>
        ))}
      </div>
    </div>
  );
}

export function Timeline() {
  const store = useStore();
  const now = useNow(30_000);
  // null = follow "today" (so the view rolls over at midnight)
  const [picked, setPicked] = useState<number | null>(null);
  const [editing, setEditing] = useState<BabyEvent | null>(null);
  const [adding, setAdding] = useState(false);
  const today = startOfDay(now);
  const day = picked ?? today;
  const setDay = (d: number) => setPicked(d >= today ? null : d);

  const list = useMemo(() => eventsForDay(store.childEvents, day, now), [store.childEvents, day, now]);
  const sum = useMemo(() => summarizeDay(store.childEvents, day, now), [store.childEvents, day, now]);
  const rows = [...list].reverse();

  return (
    <section className="card" aria-label="Timeline">
      <div className="card-head">
        <button className="icon-btn" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day">
          <Icon name="chevL" />
        </button>
        <h2 className="grow center">{formatDayLabel(day, now)}</h2>
        <button className="icon-btn" onClick={() => setDay(addDays(day, 1))} disabled={day >= today} aria-label="Next day">
          <Icon name="chevR" />
        </button>
      </div>
      <div className="mini-stats">
        <span>
          <b>{formatDuration(sum.sleepMs)}</b> sleep
        </span>
        <span>
          <b>{sum.feeds}</b> feeds
        </span>
        <span>
          <b>{sum.diapers}</b> diapers
        </span>
        <span>
          <b>{formatDuration(sum.longestSleepMs)}</b> longest
        </span>
      </div>
      <DayStrip events={list} dayStart={day} now={now} />
      {rows.length === 0 ? (
        <p className="muted empty">Nothing logged for this day yet.</p>
      ) : (
        <ul className="timeline">
          {rows.map((e) => {
            const d = describeEvent(e, store.settings.units, now);
            const crossesIn = e.type === 'sleep' && e.start < day;
            return (
              <li key={e.id}>
                <button className={`row t-${e.type}`} onClick={() => setEditing(e)}>
                  <span className="dot">
                    <Icon name={e.type === 'feed' ? e.method ?? 'breast' : e.type} size={18} />
                  </span>
                  <span className="when">
                    {crossesIn ? `from ${formatClock(e.start)}` : formatClock(e.start)}
                    {e.end != null && e.type !== 'diaper' && <> to {formatClock(e.end)}</>}
                    {e.end == null && <> (running)</>}
                  </span>
                  <span className="what">
                    <b>{d.title}</b> {d.detail}
                    {e.notes && <em> {e.notes}</em>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="actions">
        <button onClick={() => setAdding(true)}>
          <Icon name="plus" size={16} /> Add past entry
        </button>
      </div>
      {editing && <EventEditor event={store.events.find((e) => e.id === editing.id) ?? editing} onClose={() => setEditing(null)} />}
      {adding && <EventEditor onClose={() => setAdding(false)} />}
    </section>
  );
}
