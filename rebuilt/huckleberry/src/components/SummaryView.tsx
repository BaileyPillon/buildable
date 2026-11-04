import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { addDays, formatDayLabel, formatDuration, startOfDay } from '../lib/time';
import { summarizeDay, summarizeRange } from '../lib/summary';
import { formatAmount } from '../lib/share';
import { Icon, useNow } from './ui';

function Stat({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls: string }) {
  return (
    <div className={`stat t-${cls}`}>
      <div className="muted small">{label}</div>
      <div className="stat-v">{value}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}

export function SummaryView() {
  const store = useStore();
  const now = useNow(60_000);
  const [mode, setMode] = useState<'day' | 'week'>('day');
  const [pickedEnd, setPickedEnd] = useState<number | null>(null);
  const today = startOfDay(now);
  const end = pickedEnd ?? today;
  const units = store.settings.units;
  const step = mode === 'day' ? 1 : 7;
  const move = (dir: number) => {
    const n = addDays(end, dir * step);
    setPickedEnd(n >= today ? null : n);
  };

  const day = useMemo(() => summarizeDay(store.childEvents, end, now), [store.childEvents, end, now]);
  const week = useMemo(() => summarizeRange(store.childEvents, addDays(end, -6), 7, now), [store.childEvents, end, now]);

  const label =
    mode === 'day'
      ? formatDayLabel(end, now)
      : `${new Date(addDays(end, -6)).toLocaleDateString([], { month: 'short', day: 'numeric' })} to ${new Date(end).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  const maxSleep = Math.max(1, ...week.days.map((d) => d.sleepMs));

  return (
    <div className="stack">
      <div className="seg" role="group" aria-label="Summary range">
        <button className={mode === 'day' ? 'on' : ''} onClick={() => setMode('day')}>
          Daily
        </button>
        <button className={mode === 'week' ? 'on' : ''} onClick={() => setMode('week')}>
          Weekly
        </button>
      </div>
      <div className="card">
        <div className="card-head">
          <button className="icon-btn" onClick={() => move(-1)} aria-label={`Previous ${mode}`}>
            <Icon name="chevL" />
          </button>
          <h2 className="grow center">{label}</h2>
          <button className="icon-btn" onClick={() => move(1)} disabled={end >= today} aria-label={`Next ${mode}`}>
            <Icon name="chevR" />
          </button>
        </div>

        {mode === 'day' ? (
          <div className="stats">
            <Stat cls="sleep" label="Total sleep" value={formatDuration(day.sleepMs)} sub={`${day.sleepCount} sleeps, ${day.napCount} naps`} />
            <Stat cls="sleep" label="Longest stretch" value={formatDuration(day.longestSleepMs)} sub="single sleep" />
            <Stat
              cls="feed"
              label="Feeds"
              value={String(day.feeds)}
              sub={[day.breastFeeds ? `${day.breastFeeds} breast (${formatDuration(day.breastMs)})` : '', day.bottleFeeds ? `${day.bottleFeeds} bottle ${formatAmount(day.bottleMl, units)}` : ''].filter(Boolean).join(', ') || 'none'}
            />
            <Stat cls="diaper" label="Diapers" value={String(day.diapers)} sub={`${day.pee} wet, ${day.poo} dirty`} />
            {day.pumps > 0 && <Stat cls="pump" label="Pumping" value={formatAmount(day.pumpMl, units) || `${day.pumps}x`} sub={`${day.pumps} session${day.pumps === 1 ? '' : 's'}`} />}
          </div>
        ) : (
          <>
            <div className="stats">
              <Stat cls="sleep" label="Avg sleep per day" value={formatDuration(week.avg.sleepMs)} sub={`${week.avg.napCount.toFixed(1)} naps per day`} />
              <Stat cls="sleep" label="Longest stretch" value={formatDuration(week.longestSleepMs)} sub={`avg ${formatDuration(week.avg.longestSleepMs)} per day`} />
              <Stat cls="feed" label="Avg feeds per day" value={week.avg.feeds.toFixed(1)} sub={`${week.totals.feeds} this week`} />
              <Stat cls="diaper" label="Avg diapers per day" value={week.avg.diapers.toFixed(1)} sub={`${week.totals.diapers} this week`} />
            </div>
            <div className="bars" role="img" aria-label="Sleep per day">
              {week.days.map((d) => (
                <div className="bar-col" key={d.dayStart}>
                  <span className="bar-val">{d.sleepMs ? formatDuration(d.sleepMs) : ''}</span>
                  <div className="bar-track">
                    <div className="bar" style={{ height: `${(d.sleepMs / maxSleep) * 100}%` }} />
                  </div>
                  <span className="bar-lab">{new Date(d.dayStart).toLocaleDateString([], { weekday: 'short' })}</span>
                </div>
              ))}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Sleep</th>
                    <th>Longest</th>
                    <th>Feeds</th>
                    <th>Diapers</th>
                  </tr>
                </thead>
                <tbody>
                  {week.days.map((d) => (
                    <tr key={d.dayStart}>
                      <td>{new Date(d.dayStart).toLocaleDateString([], { weekday: 'short', day: 'numeric' })}</td>
                      <td>{formatDuration(d.sleepMs)}</td>
                      <td>{formatDuration(d.longestSleepMs)}</td>
                      <td>{d.feeds}</td>
                      <td>{d.diapers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
