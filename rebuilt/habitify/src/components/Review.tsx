import { useMemo, useState } from 'react';
import { addDays, addMonths, endOfMonth, formatDate, startOfMonth, startOfWeek } from '../lib/dates';
import { previousRange, reviewPeriod, type DaySummary } from '../lib/review';
import { entriesOf, useAppState } from '../lib/store';
import { BarChart, type Bar } from './Charts';
import { Icon, ProgressBar, go, pct, plural } from './ui';

type Mode = 'week' | 'month';

function delta(cur: number | null, prev: number | null): string | null {
  if (cur === null || prev === null) return null;
  const d = Math.round((cur - prev) * 100);
  return d === 0 ? 'same as before' : `${d > 0 ? '+' : ''}${d} pts vs previous`;
}

export function Review({ today }: { today: string }) {
  const state = useAppState();
  const [mode, setMode] = useState<Mode>('week');
  const [anchor, setAnchor] = useState(today);
  const ws = state.settings.weekStart;

  const range = useMemo(() => {
    if (mode === 'week') {
      const from = startOfWeek(anchor, ws);
      return { from, to: addDays(from, 6) };
    }
    return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
  }, [mode, anchor, ws]);

  const prevRange = mode === 'week' ? previousRange(range.from, range.to) : { from: addMonths(range.from, -1), to: addDays(range.from, -1) };
  const entriesFor = (id: string) => entriesOf(state, id);
  const cur = useMemo(() => reviewPeriod(state.habits, entriesFor, range.from, range.to, today), [state, range, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const prev = useMemo(() => reviewPeriod(state.habits, entriesFor, prevRange.from, prevRange.to, today), [state, prevRange.from, prevRange.to, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const shift = (dir: -1 | 1) => setAnchor(mode === 'week' ? addDays(range.from, dir * 7) : addMonths(range.from, dir));
  const nextStart = mode === 'week' ? addDays(range.from, 7) : addMonths(range.from, 1);
  const title =
    mode === 'week'
      ? `${formatDate(range.from, { month: 'short', day: 'numeric' })} – ${formatDate(range.to, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : formatDate(range.from, { month: 'long', year: 'numeric' });

  const dayBar = (d: DaySummary, label: string): Bar => ({
    label,
    value: d.rate,
    title: `${formatDate(d.date, { weekday: 'long', month: 'short', day: 'numeric' })}: ${
      d.rate === null ? 'nothing scheduled or not reached yet' : `${Math.round(d.rate * 100)}% (${d.done} of ${d.possible})`
    }${d.checkins ? `, ${plural(d.checkins, 'check-in')}` : ''}`,
  });

  const dayBars: Bar[] = cur.days.map((d) => dayBar(d, mode === 'week' ? formatDate(d.date, { weekday: 'short' }) : String(+d.date.slice(8))));

  const weekBars: Bar[] = [];
  if (mode === 'month') {
    const groups = new Map<string, { done: number; possible: number }>();
    for (const d of cur.days) {
      const w = startOfWeek(d.date, ws);
      const g = groups.get(w) ?? { done: 0, possible: 0 };
      g.done += d.done;
      g.possible += d.possible;
      groups.set(w, g);
    }
    for (const [w, g] of groups) {
      const v = g.possible ? g.done / g.possible : null;
      weekBars.push({
        label: formatDate(w, { month: 'short', day: 'numeric' }),
        value: v,
        title: `Week of ${formatDate(w, { month: 'short', day: 'numeric' })}: ${v === null ? 'no data' : `${Math.round(v * 100)}% (${g.done} of ${g.possible})`}`,
      });
    }
  }

  const prevById = new Map(prev.habits.map((p) => [p.habit.id, p]));
  const hasData = cur.habits.length > 0;

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Review</h1>
          <p className="muted">{title}</p>
        </div>
        <div className="head-actions">
          <div className="seg small" role="group" aria-label="Review period">
            <button aria-pressed={mode === 'week'} onClick={() => setMode('week')}>Week</button>
            <button aria-pressed={mode === 'month'} onClick={() => setMode('month')}>Month</button>
          </div>
          <button className="icon-btn" aria-label={`Previous ${mode}`} onClick={() => shift(-1)}><Icon name="left" /></button>
          <button className="icon-btn" aria-label={`Next ${mode}`} onClick={() => shift(1)} disabled={nextStart > today}><Icon name="right" /></button>
        </div>
      </header>

      {!hasData && (
        <section className="card empty">
          <p>No scheduled habits or check-ins in this {mode}.</p>
          <button className="btn" onClick={() => go('/today')}>Go to Today</button>
        </section>
      )}

      {hasData && (
        <>
          <section className="stats" aria-label="Summary">
            <div className="stat">
              <span className="stat-label">Completion</span>
              <span className="stat-value">{pct(cur.rate)}</span>
              <span className="stat-unit">{delta(cur.rate, prev.rate) ?? `${cur.done} of ${cur.possible}`}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Check-ins</span>
              <span className="stat-value">{cur.checkins}</span>
              <span className="stat-unit">{prev.checkins} previous {mode}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Perfect days</span>
              <span className="stat-value">{cur.perfectDays}</span>
              <span className="stat-unit">every scheduled habit done</span>
            </div>
            <div className="stat">
              <span className="stat-label">Best day</span>
              <span className="stat-value">{cur.bestDay ? formatDate(cur.bestDay.date, mode === 'week' ? { weekday: 'short' } : { month: 'short', day: 'numeric' }) : '–'}</span>
              <span className="stat-unit">{cur.bestDay ? pct(cur.bestDay.rate) : 'no data yet'}</span>
            </div>
          </section>

          <section className="card" aria-labelledby="daily-h">
            <h2 id="daily-h">Daily completion</h2>
            <BarChart bars={dayBars} ariaLabel={`Daily completion for ${title}`} labelEvery={mode === 'week' ? 1 : 3} showValues={mode === 'week'} />
          </section>

          {mode === 'month' && (
            <section className="card" aria-labelledby="weekly-h">
              <h2 id="weekly-h">By week</h2>
              <BarChart bars={weekBars} ariaLabel={`Weekly completion for ${title}`} showValues />
            </section>
          )}

          <section className="card" aria-labelledby="habits-h">
            <h2 id="habits-h">By habit</h2>
            <ul className="review-list">
              {cur.habits.map((p) => {
                const before = prevById.get(p.habit.id);
                const d = delta(p.rate, before?.rate ?? null);
                return (
                  <li key={p.habit.id} style={{ '--c': p.habit.color } as React.CSSProperties}>
                    <div className="review-top">
                      <button className="row-name" onClick={() => go(`/habit/${p.habit.id}`)}>
                        {p.habit.emoji} {p.habit.name}
                      </button>
                      <span className="review-num">
                        {p.done}/{p.possible} · <strong>{pct(p.rate)}</strong>
                      </span>
                    </div>
                    <ProgressBar value={p.rate ?? 0} label={`${p.habit.name}: ${pct(p.rate)}`} color={p.habit.color} />
                    {(d || p.skipped > 0) && (
                      <div className="row-sub">
                        {[d, p.skipped ? `${p.skipped} skipped` : null].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="hint">Archived habits are left out. Skipped days and days that have not happened yet are not counted against you.</p>
          </section>
        </>
      )}
    </div>
  );
}
