import { useState, type FormEvent } from 'react';
import type { Habit, Schedule, TimeOfDay } from '../types';
import { TIMES_OF_DAY, TIME_LABELS } from '../types';
import { WEEKDAY_SHORT } from '../lib/dates';
import { COLOR_NAMES, PALETTE } from '../lib/palette';
import { requestNotifications } from '../lib/reminders';
import { addHabit, updateHabit, useAppState } from '../lib/store';
import { Modal, announce } from './ui';

const EMOJIS = ['💧', '🏃', '📖', '🧘', '🥗', '😴', '✍️', '🎸', '💊', '🧹'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

type Kind = 'daily' | 'weekdays' | 'weekly';

export function HabitForm({ habit, onClose }: { habit?: Habit; onClose: () => void }) {
  const state = useAppState();
  const [name, setName] = useState(habit?.name ?? '');
  const [emoji, setEmoji] = useState(habit?.emoji ?? '');
  const [color, setColor] = useState(habit?.color ?? PALETTE[state.habits.length % PALETTE.length]!);
  const [kind, setKind] = useState<Kind>(habit?.schedule.type ?? 'daily');
  const [days, setDays] = useState<number[]>(habit?.schedule.type === 'weekdays' ? habit.schedule.days : [1, 2, 3, 4, 5]);
  const [times, setTimes] = useState(habit?.schedule.type === 'weekly' ? habit.schedule.times : 3);
  const [hasGoal, setHasGoal] = useState(!!habit?.goal);
  const [target, setTarget] = useState(String(habit?.goal?.target ?? 8));
  const [unit, setUnit] = useState(habit?.goal?.unit ?? 'glasses');
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(habit?.timeOfDay ?? 'anytime');
  const [remind, setRemind] = useState(!!habit?.reminder?.enabled);
  const [remindTime, setRemindTime] = useState(habit?.reminder?.time ?? '09:00');
  const [error, setError] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError('Give the habit a name.');
    if (kind === 'weekdays' && days.length === 0) return setError('Pick at least one day of the week.');
    const t = Number(target.replace(',', '.'));
    if (hasGoal && !(t > 0 && Number.isFinite(t))) return setError('The goal must be a number greater than zero.');
    const tp = Math.round(times);
    if (kind === 'weekly' && !(tp >= 1 && tp <= 7)) return setError('Times per week must be between 1 and 7.');

    const schedule: Schedule =
      kind === 'daily' ? { type: 'daily' } : kind === 'weekdays' ? { type: 'weekdays', days: [...days].sort() } : { type: 'weekly', times: tp };
    const base = {
      name: trimmed,
      emoji: emoji.trim().slice(0, 8),
      color,
      schedule,
      goal: hasGoal ? { target: t, unit: unit.trim() } : undefined,
      timeOfDay,
      reminder: remind ? { enabled: true, time: remindTime || '09:00' } : undefined,
    };
    if (habit) updateHabit(habit.id, base);
    else addHabit(base);
    if (remind) void requestNotifications();
    announce(habit ? `Saved ${trimmed}` : `Added ${trimmed}`);
    onClose();
  };

  const toggleDay = (d: number) => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  return (
    <Modal title={habit ? 'Edit habit' : 'New habit'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="hf-name">Name</label>
          <input id="hf-name" value={name} maxLength={80} data-autofocus onChange={(e) => setName(e.target.value)} placeholder="e.g. Drink water" required aria-invalid={!!error && !name.trim()} />
        </div>

        <div className="field">
          <label htmlFor="hf-emoji">Icon (optional emoji)</label>
          <div className="row-wrap">
            <input id="hf-emoji" className="short" value={emoji} maxLength={8} onChange={(e) => setEmoji(e.target.value)} />
            {EMOJIS.map((em) => (
              <button type="button" key={em} className="chip" aria-pressed={emoji === em} aria-label={`Use ${em}`} onClick={() => setEmoji(emoji === em ? '' : em)}>
                {em}
              </button>
            ))}
          </div>
        </div>

        <fieldset className="field">
          <legend>Color</legend>
          <div className="row-wrap">
            {PALETTE.map((c) => (
              <button key={c} type="button" className="swatch" style={{ background: c }} aria-pressed={color === c} aria-label={COLOR_NAMES[c] ?? c} onClick={() => setColor(c)} />
            ))}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend>Repeat</legend>
          <div className="seg" role="group" aria-label="Schedule type">
            <button type="button" aria-pressed={kind === 'daily'} onClick={() => setKind('daily')}>Every day</button>
            <button type="button" aria-pressed={kind === 'weekdays'} onClick={() => setKind('weekdays')}>Specific days</button>
            <button type="button" aria-pressed={kind === 'weekly'} onClick={() => setKind('weekly')}>Times a week</button>
          </div>
          {kind === 'weekdays' && (
            <div className="row-wrap" role="group" aria-label="Days of the week">
              {WEEK_ORDER.map((d) => (
                <button type="button" key={d} className="chip day" aria-pressed={days.includes(d)} onClick={() => toggleDay(d)}>
                  {WEEKDAY_SHORT[d]}
                </button>
              ))}
            </div>
          )}
          {kind === 'weekly' && (
            <div className="row-wrap">
              <label htmlFor="hf-times">Target</label>
              <input id="hf-times" type="number" min={1} max={7} className="short" value={times} onChange={(e) => setTimes(Number(e.target.value))} />
              <span>times per week, on any days</span>
            </div>
          )}
        </fieldset>

        <fieldset className="field">
          <legend>Goal</legend>
          <label className="check-line">
            <input type="checkbox" checked={hasGoal} onChange={(e) => setHasGoal(e.target.checked)} />
            Track a number (for example 8 glasses of water)
          </label>
          {hasGoal && (
            <div className="row-wrap">
              <label htmlFor="hf-target">Per day</label>
              <input id="hf-target" inputMode="decimal" className="short" value={target} onChange={(e) => setTarget(e.target.value)} />
              <label htmlFor="hf-unit" className="sr-only">Unit</label>
              <input id="hf-unit" value={unit} maxLength={24} onChange={(e) => setUnit(e.target.value)} placeholder="unit, e.g. glasses" />
            </div>
          )}
        </fieldset>

        <div className="field">
          <label htmlFor="hf-tod">Time of day</label>
          <select id="hf-tod" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value as TimeOfDay)}>
            {TIMES_OF_DAY.map((t) => (
              <option key={t} value={t}>{TIME_LABELS[t]}</option>
            ))}
          </select>
        </div>

        <fieldset className="field">
          <legend>Reminder</legend>
          <label className="check-line">
            <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
            Remind me if it is not done yet
          </label>
          {remind && (
            <div className="row-wrap">
              <label htmlFor="hf-rtime">At</label>
              <input id="hf-rtime" type="time" value={remindTime} onChange={(e) => setRemindTime(e.target.value)} />
            </div>
          )}
        </fieldset>

        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">{habit ? 'Save changes' : 'Add habit'}</button>
        </div>
      </form>
    </Modal>
  );
}
