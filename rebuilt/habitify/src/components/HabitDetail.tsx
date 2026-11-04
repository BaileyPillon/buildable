import { useState } from 'react';
import { describeGoal, describeSchedule } from '../lib/schedule';
import { archiveHabit, entriesOf, getHabit, useAppState } from '../lib/store';
import { completionRate, computeStreaks, totalDone } from '../lib/streaks';
import { addDays, formatDate } from '../lib/dates';
import { TIME_LABELS } from '../types';
import { DayDialog } from './DayDialog';
import { Heatmap } from './Heatmap';
import { HabitForm } from './HabitForm';
import { Icon, announce, go, pct, plural } from './ui';

export function HabitDetail({ id, today }: { id: string; today: string }) {
  const state = useAppState();
  const habit = getHabit(state, id);
  const [weeks, setWeeks] = useState(26);
  const [dayDialog, setDayDialog] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  if (!habit) {
    return (
      <div className="card empty">
        <h1>Habit not found</h1>
        <button className="btn" onClick={() => go('/habits')}>Back to habits</button>
      </div>
    );
  }

  const entries = entriesOf(state, id);
  const ws = state.settings.weekStart;
  const streak = computeStreaks(habit, entries, today, ws);
  const r30 = completionRate(habit, entries, today, ws, addDays(today, -29));
  const rAll = completionRate(habit, entries, today, ws, null);
  const total = totalDone(entries);
  const unit = streak.unit;

  const notes = Object.values(entries)
    .filter((e) => e.note)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 8);

  const valued = Object.values(entries).filter((e) => e.status === 'done' && e.value);
  const avg = habit.goal && valued.length ? valued.reduce((s, e) => s + (e.value ?? 0), 0) / valued.length : null;

  return (
    <div style={{ '--c': habit.color } as React.CSSProperties}>
      <p><a href="#/habits" className="back"><Icon name="left" size={16} /> Habits</a></p>
      <header className="page-head">
        <div>
          <h1>
            {habit.emoji && <span aria-hidden="true">{habit.emoji} </span>}
            {habit.name}
            {habit.archived && <span className="badge">Archived</span>}
          </h1>
          <p className="muted">
            {describeSchedule(habit.schedule)}
            {habit.goal ? ` · goal ${describeGoal(habit)}` : ''} · {TIME_LABELS[habit.timeOfDay]}
            {habit.reminder?.enabled ? ` · reminder ${habit.reminder.time}` : ''}
          </p>
        </div>
        <div className="head-actions">
          <button className="btn small" onClick={() => setEditing(true)}><Icon name="edit" size={16} /> Edit</button>
          <button
            className="btn small"
            onClick={() => {
              archiveHabit(habit.id, !habit.archived);
              announce(habit.archived ? 'Restored' : 'Archived');
            }}
          >
            <Icon name={habit.archived ? 'restore' : 'archive'} size={16} /> {habit.archived ? 'Restore' : 'Archive'}
          </button>
        </div>
      </header>

      <section aria-label="Statistics" className="stats">
        <div className="stat">
          <span className="stat-label">Current streak</span>
          <span className="stat-value"><Icon name="flame" size={22} /> {streak.current}</span>
          <span className="stat-unit">{plural(streak.current, unit).replace(/^\d+ /, '')}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Best streak</span>
          <span className="stat-value">{streak.best}</span>
          <span className="stat-unit">{plural(streak.best, unit).replace(/^\d+ /, '')}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Last 30 days</span>
          <span className="stat-value">{pct(r30.rate)}</span>
          <span className="stat-unit">{r30.possible ? `${r30.done} of ${r30.possible}` : 'no data yet'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">All time</span>
          <span className="stat-value">{pct(rAll.rate)}</span>
          <span className="stat-unit">{plural(total, 'check-in')}</span>
        </div>
        {avg !== null && habit.goal && (
          <div className="stat">
            <span className="stat-label">Average logged</span>
            <span className="stat-value">{Math.round(avg * 10) / 10}</span>
            <span className="stat-unit">{habit.goal.unit} per done day</span>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="heat-h">
        <div className="card-head">
          <h2 id="heat-h">History</h2>
          <div className="seg small" role="group" aria-label="Heatmap range">
            <button aria-pressed={weeks === 13} onClick={() => setWeeks(13)}>3 months</button>
            <button aria-pressed={weeks === 26} onClick={() => setWeeks(26)}>6 months</button>
            <button aria-pressed={weeks === 53} onClick={() => setWeeks(53)}>1 year</button>
          </div>
        </div>
        <Heatmap key={weeks} habit={habit} entries={entries} today={today} weekStart={ws} weeks={weeks} onSelect={setDayDialog} />
        <p className="hint">Select a day to change its status or add a note.</p>
      </section>

      {notes.length > 0 && (
        <section className="card" aria-labelledby="notes-h">
          <h2 id="notes-h">Recent notes</h2>
          <ul className="notes">
            {notes.map((n) => (
              <li key={n.key}>
                <button className="link" onClick={() => setDayDialog(n.date)}>
                  {formatDate(n.date, { month: 'short', day: 'numeric', year: 'numeric' })}
                </button>
                <span>{n.note}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dayDialog && <DayDialog habitId={habit.id} date={dayDialog} onClose={() => setDayDialog(null)} />}
      {editing && <HabitForm habit={habit} onClose={() => setEditing(false)} />}
    </div>
  );
}
