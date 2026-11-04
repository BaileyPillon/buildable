import { useMemo, useState } from 'react';
import type { DateKey, Habit } from '../types';
import { TIMES_OF_DAY, TIME_LABELS } from '../types';
import { addDays, formatDate } from '../lib/dates';
import { increment, toggleDone } from '../lib/checkin';
import { isScheduledOn } from '../lib/schedule';
import { activeHabits, entriesOf, updateEntry, useAppState, type State } from '../lib/store';
import { computeStreaks, weekProgress } from '../lib/streaks';
import { DayDialog } from './DayDialog';
import { HabitForm } from './HabitForm';
import { Icon, ProgressBar, announce, go, plural } from './ui';

function visibleOn(state: State, date: DateKey): Habit[] {
  return activeHabits(state).filter((h) => {
    const e = entriesOf(state, h.id)[date];
    if (e) return true;
    return h.createdAt <= date && isScheduledOn(h.schedule, date);
  });
}

export function Today({ today }: { today: DateKey }) {
  const state = useAppState();
  const [date, setDate] = useState<DateKey>(today);
  const [dialog, setDialog] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const weekStart = state.settings.weekStart;

  // follow midnight rollover if the user was looking at "today"
  const [lastToday, setLastToday] = useState(today);
  if (lastToday !== today) {
    setLastToday(today);
    if (date === lastToday) setDate(today);
  }

  const habits = useMemo(() => visibleOn(state, date), [state, date]);

  const rows = habits.map((h) => {
    const entries = entriesOf(state, h.id);
    const entry = entries[date];
    const wp = h.schedule.type === 'weekly' ? weekProgress(h, entries, date, today, weekStart) : null;
    return { habit: h, entry, wp, streak: computeStreaks(h, entries, today, weekStart) };
  });

  // weekly habits whose weekly target is already met count only if done on this day
  const counted = rows.filter((r) => r.entry?.status !== 'skipped' && !(r.wp && r.wp.done >= r.wp.target && r.entry?.status !== 'done'));
  const doneCount = counted.filter((r) => r.entry?.status === 'done').length;
  const isToday = date === today;
  const hasAny = state.habits.length > 0;
  const hasActive = activeHabits(state).length > 0;

  const label = isToday ? 'Today' : date === addDays(today, -1) ? 'Yesterday' : formatDate(date, { weekday: 'long' });

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>{label}</h1>
          <p className="muted">{formatDate(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
        <div className="head-actions">
          <button className="icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
            <Icon name="left" />
          </button>
          {!isToday && (
            <button className="btn small" onClick={() => setDate(today)}>Today</button>
          )}
          <button className="icon-btn" onClick={() => setDate(addDays(date, 1))} disabled={date >= today} aria-label="Next day">
            <Icon name="right" />
          </button>
        </div>
      </header>

      {!hasAny && (
        <section className="card empty">
          <h2>Welcome</h2>
          <p>Track habits privately on this device. Nothing leaves your browser.</p>
          <div className="actions start">
            <button className="btn primary" onClick={() => setCreating(true)}>Add your first habit</button>
            <button className="btn" onClick={() => go('/settings')}>Import data</button>
          </div>
        </section>
      )}

      {hasAny && (
        <>
          <section className="summary" aria-label="Progress for the day">
            <div className="summary-text">
              <strong>{doneCount}</strong> of {counted.length} done
            </div>
            <ProgressBar value={counted.length ? doneCount / counted.length : 0} label={`${doneCount} of ${counted.length} habits done`} />
          </section>

          {habits.length === 0 && (
            <section className="card empty">
              <p>{hasActive ? 'Nothing is scheduled for this day.' : 'All habits are archived.'}</p>
              <button className="btn" onClick={() => (hasActive ? setCreating(true) : go('/habits'))}>
                {hasActive ? 'Add a habit' : 'Manage habits'}
              </button>
            </section>
          )}

          {TIMES_OF_DAY.map((tod) => {
            const group = rows.filter((r) => r.habit.timeOfDay === tod);
            if (group.length === 0) return null;
            return (
              <section key={tod} aria-labelledby={`tod-${tod}`} className="group">
                <h2 id={`tod-${tod}`} className="group-title">{TIME_LABELS[tod]}</h2>
                <ul className="habit-list">
                  {group.map(({ habit: h, entry, wp, streak }) => {
                    const status = entry?.status ?? 'none';
                    const done = status === 'done';
                    const skipped = status === 'skipped';
                    const value = entry?.value ?? 0;
                    const sub: string[] = [];
                    if (skipped) sub.push('Skipped');
                    if (wp) sub.push(`${wp.done} of ${wp.target} this week`);
                    if (streak.current > 0) sub.push(`${plural(streak.current, streak.unit)} streak`);
                    return (
                      <li key={h.id} className={`row ${done ? 'is-done' : ''} ${skipped ? 'is-skipped' : ''}`} style={{ '--c': h.color } as React.CSSProperties}>
                        <button
                          className="check"
                          aria-pressed={done}
                          aria-label={`${h.name}${h.goal ? `, ${value} of ${h.goal.target} ${h.goal.unit}` : ''}`}
                          onClick={() => {
                            updateEntry(h.id, date, (p) => toggleDone(h, p));
                            announce(done ? `${h.name} marked not done` : `${h.name} done`);
                          }}
                        >
                          {done ? <Icon name="check" size={22} /> : skipped ? <Icon name="skip" size={18} /> : <span aria-hidden="true">{h.emoji}</span>}
                        </button>
                        <div className="row-main">
                          <button className="row-name" onClick={() => go(`/habit/${h.id}`)}>
                            {h.name}
                          </button>
                          <div className="row-sub">
                            {sub.length > 0 && (
                              <span>
                                {streak.current > 0 && !skipped && !wp && <Icon name="flame" size={14} />}
                                {sub.join(' · ')}
                              </span>
                            )}
                            {entry?.note && (
                              <span className="note-flag" title={entry.note}>
                                <Icon name="note" size={14} />
                                <span className="sr-only">Has a note: {entry.note}</span>
                              </span>
                            )}
                          </div>
                          {h.goal && (
                            <div className="goal-line">
                              <ProgressBar value={value / h.goal.target} label={`${h.name} progress`} color={h.color} />
                            </div>
                          )}
                        </div>
                        {h.goal && (
                          <div className="stepper compact" role="group" aria-label={`${h.name} progress`}>
                            <button className="icon-btn" aria-label={`Remove one ${h.goal.unit || 'unit'} from ${h.name}`} onClick={() => updateEntry(h.id, date, (p) => increment(h, -1, p))} disabled={value <= 0}>
                              <Icon name="minus" size={18} />
                            </button>
                            <span className="stepper-val" aria-live="polite">
                              {value}/{h.goal.target}
                              <small>{h.goal.unit}</small>
                            </span>
                            <button className="icon-btn" aria-label={`Add one ${h.goal.unit || 'unit'} to ${h.name}`} onClick={() => updateEntry(h.id, date, (p) => increment(h, 1, p))}>
                              <Icon name="plus" size={18} />
                            </button>
                          </div>
                        )}
                        <button className="icon-btn" aria-label={`Skip, add a note or edit ${h.name}`} onClick={() => setDialog(h.id)}>
                          <Icon name="more" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          {hasActive && (
            <div className="actions start">
              <button className="btn" onClick={() => setCreating(true)}>
                <Icon name="plus" size={18} /> Add habit
              </button>
            </div>
          )}
        </>
      )}

      {dialog && <DayDialog habitId={dialog} date={date} onClose={() => setDialog(null)} />}
      {creating && <HabitForm onClose={() => setCreating(false)} />}
    </div>
  );
}
