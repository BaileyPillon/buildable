import { useState } from 'react';
import { formatDate } from '../lib/dates';
import { increment, setNote, setStatus, setValue } from '../lib/checkin';
import { entriesOf, updateEntry, useAppState } from '../lib/store';
import { Icon, Modal, announce } from './ui';

/** Edit one habit on one day: done / skipped / not done, numeric progress, and a note. */
export function DayDialog({ habitId, date, onClose }: { habitId: string; date: string; onClose: () => void }) {
  const state = useAppState();
  const habit = state.habits.find((h) => h.id === habitId);
  const entry = habit ? entriesOf(state, habit.id)[date] : undefined;
  const [note, setNoteDraft] = useState(entry?.note ?? '');
  const [valueText, setValueText] = useState<string | null>(null);
  if (!habit) return null;

  const status = entry?.status ?? 'none';
  const commitNote = () => {
    if ((entry?.note ?? '') !== note.trim()) updateEntry(habit.id, date, (p) => setNote(note, p));
  };
  const close = () => {
    commitNote();
    onClose();
  };
  const choose = (s: 'none' | 'done' | 'skipped') => {
    updateEntry(habit.id, date, (p) => setStatus(habit, s, p));
    announce(`${habit.name}: ${s === 'none' ? 'cleared' : s === 'done' ? 'marked done' : 'skipped'}`);
  };
  const commitValue = () => {
    if (valueText === null) return;
    const n = Number(valueText.replace(',', '.'));
    if (valueText.trim() !== '' && Number.isFinite(n)) updateEntry(habit.id, date, (p) => setValue(habit, n, p));
    setValueText(null);
  };

  return (
    <Modal title={`${habit.emoji ? habit.emoji + ' ' : ''}${habit.name}`} onClose={close}>
      <p className="muted">{formatDate(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>

      <div className="seg" role="group" aria-label="Status for this day">
        <button type="button" aria-pressed={status === 'none'} onClick={() => choose('none')}>Not done</button>
        <button type="button" aria-pressed={status === 'done'} onClick={() => choose('done')}>Done</button>
        <button type="button" aria-pressed={status === 'skipped'} onClick={() => choose('skipped')}>Skipped</button>
      </div>
      {status === 'skipped' && <p className="hint">Skipped days do not break your streak and are left out of your completion rate.</p>}

      {habit.goal && (
        <div className="field">
          <label htmlFor="day-value">Progress ({habit.goal.unit || 'units'}, goal {habit.goal.target})</label>
          <div className="stepper">
            <button type="button" className="icon-btn" aria-label="Decrease by one" onClick={() => updateEntry(habit.id, date, (p) => increment(habit, -1, p))}>
              <Icon name="minus" />
            </button>
            <input
              id="day-value"
              inputMode="decimal"
              value={valueText ?? String(entry?.value ?? 0)}
              onChange={(e) => setValueText(e.target.value)}
              onBlur={commitValue}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), commitValue())}
            />
            <button type="button" className="icon-btn" aria-label="Increase by one" onClick={() => updateEntry(habit.id, date, (p) => increment(habit, 1, p))}>
              <Icon name="plus" />
            </button>
          </div>
        </div>
      )}

      <div className="field">
        <label htmlFor="day-note">Note</label>
        <textarea id="day-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNoteDraft(e.target.value)} onBlur={commitNote} placeholder="How did it go?" />
      </div>

      <div className="actions">
        <button type="button" className="btn primary" onClick={close}>Done</button>
      </div>
    </Modal>
  );
}
