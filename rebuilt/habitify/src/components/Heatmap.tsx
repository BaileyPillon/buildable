import { useRef, useState } from 'react';
import type { DateKey, EntryMap, Habit } from '../types';
import { addDays, formatDate, startOfWeek, weekday } from '../lib/dates';
import { cellInfo, type CellState } from '../lib/streaks';

const STATE_TEXT: Record<CellState, string> = {
  done: 'done',
  partial: 'partly done',
  skipped: 'skipped',
  missed: 'missed',
  pending: 'not done yet',
  off: 'not scheduled',
  future: '',
};

export function Heatmap({
  habit,
  entries,
  today,
  weekStart,
  weeks,
  onSelect,
}: {
  habit: Habit;
  entries: EntryMap;
  today: DateKey;
  weekStart: 0 | 1;
  weeks: number;
  onSelect: (date: DateKey) => void;
}) {
  const gridStart = addDays(startOfWeek(today, weekStart), -(weeks - 1) * 7);
  const [focus, setFocus] = useState<DateKey>(today);
  const root = useRef<HTMLDivElement>(null);

  const columns = Array.from({ length: weeks }, (_, c) => Array.from({ length: 7 }, (_, r) => addDays(gridStart, c * 7 + r)));
  const monthOf = (d: DateKey) => d.slice(0, 7);
  const monthName = (d: DateKey) => formatDate(d, { month: 'short' });

  const move = (from: DateKey, delta: number) => {
    let next = addDays(from, delta);
    if (next > today) next = today;
    if (next < gridStart) next = gridStart;
    setFocus(next);
    root.current?.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)?.focus();
  };

  const onKey = (e: React.KeyboardEvent, date: DateKey) => {
    const deltas: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    const inWeek = (weekday(date) - weekStart + 7) % 7;
    const delta = deltas[e.key] ?? (e.key === 'Home' ? -inWeek : e.key === 'End' ? 6 - inWeek : undefined);
    if (delta === undefined) return;
    e.preventDefault();
    move(date, delta);
  };

  const weekdayRows = columns[0]!;

  return (
    <div className="heat-wrap" style={{ '--c': habit.color } as React.CSSProperties}>
      <div
        className="heat"
        ref={root}
        role="group"
        aria-label={`Calendar heatmap for ${habit.name}, last ${weeks} weeks. Use the arrow keys to move between days and Enter to edit a day.`}
      >
        <div className="heat-labels" aria-hidden="true">
          <div className="heat-month-spacer" />
          {weekdayRows.map((d, i) => (
            <div key={d} className="heat-dow">{i % 2 === 1 ? formatDate(d, { weekday: 'short' }) : ''}</div>
          ))}
        </div>
        {columns.map((col, c) => {
          const prev = c > 0 ? columns[c - 1]![0]! : null;
          const showMonth = !prev || monthOf(col[0]!) !== monthOf(prev);
          return (
            <div className="heat-col" key={col[0]}>
              <div className="heat-month" aria-hidden="true">{showMonth ? monthName(col[0]!) : ''}</div>
              {col.map((d) => {
                if (d > today) return <span key={d} className="cell future" aria-hidden="true" />;
                const info = cellInfo(habit, entries, d, today);
                const e = entries[d];
                const label = `${formatDate(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}: ${STATE_TEXT[info.state]}${
                  info.state === 'partial' && habit.goal ? ` (${e?.value ?? 0} of ${habit.goal.target} ${habit.goal.unit})` : ''
                }${e?.note ? ', has a note' : ''}`;
                return (
                  <button
                    key={d}
                    type="button"
                    className={`cell ${info.state}`}
                    data-date={d}
                    tabIndex={d === focus ? 0 : -1}
                    aria-label={label}
                    title={label}
                    style={info.ratio !== undefined ? ({ '--p': `${Math.round(30 + info.ratio * 60)}%` } as React.CSSProperties) : undefined}
                    onFocus={() => setFocus(d)}
                    onKeyDown={(ev) => onKey(ev, d)}
                    onClick={() => onSelect(d)}
                  >
                    {e?.note && <span className="cell-note" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <ul className="legend" aria-label="Legend">
        <li><span className="cell done" aria-hidden="true" /> Done</li>
        <li><span className="cell partial" style={{ '--p': '55%' } as React.CSSProperties} aria-hidden="true" /> Partly</li>
        <li><span className="cell skipped" aria-hidden="true" /> Skipped</li>
        <li><span className="cell missed" aria-hidden="true" /> Missed</li>
      </ul>
    </div>
  );
}
