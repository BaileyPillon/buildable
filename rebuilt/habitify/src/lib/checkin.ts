import type { DateKey, Entry, Habit } from '../types';

export const entryKey = (habitId: string, date: DateKey) => `${habitId}|${date}`;

type Draft = Pick<Entry, 'status' | 'value' | 'note'>;

const EMPTY: Draft = { status: 'none' };

export function isEmptyEntry(e: Draft): boolean {
  return e.status === 'none' && !(e.value && e.value > 0) && !e.note;
}

function build(prev: Draft | undefined, patch: Partial<Draft>): Draft {
  const next: Draft = { ...(prev ?? EMPTY), ...patch };
  if (next.value === undefined || !(next.value > 0)) delete next.value;
  if (!next.note) delete next.note;
  return next;
}

/** One-tap check-in. Done -> cleared; anything else -> done (goal habits jump to their target). */
export function toggleDone(habit: Pick<Habit, 'goal'>, prev?: Draft): Draft {
  if (prev?.status === 'done') {
    return build(prev, { status: 'none', value: habit.goal ? undefined : prev.value });
  }
  return build(prev, { status: 'done', value: habit.goal ? Math.max(prev?.value ?? 0, habit.goal.target) : prev?.value });
}

/** Set numeric progress. Reaching the goal marks the day done; dropping below clears done. */
export function setValue(habit: Pick<Habit, 'goal'>, value: number, prev?: Draft): Draft {
  const v = Number.isFinite(value) ? Math.max(0, Math.round(value * 100) / 100) : 0;
  const target = habit.goal?.target;
  let status = prev?.status ?? 'none';
  if (target !== undefined) {
    if (v >= target) status = 'done';
    else status = 'none'; // progress replaces a skip, and falling short undoes done
  }
  return build(prev, { value: v, status });
}

export function increment(habit: Pick<Habit, 'goal'>, delta: number, prev?: Draft): Draft {
  return setValue(habit, (prev?.value ?? 0) + delta, prev);
}

export function toggleSkip(prev?: Draft): Draft {
  if (prev?.status === 'skipped') return build(prev, { status: 'none' });
  return build(prev, { status: 'skipped' });
}

export function setNote(note: string, prev?: Draft): Draft {
  return build(prev, { note: note.trim().slice(0, 1000) });
}

export function setStatus(habit: Pick<Habit, 'goal'>, status: Draft['status'], prev?: Draft): Draft {
  if (status === 'done') return prev?.status === 'done' ? build(prev, {}) : toggleDone(habit, prev);
  if (status === 'skipped') return prev?.status === 'skipped' ? build(prev, {}) : toggleSkip(prev);
  return build(prev, { status: 'none', value: habit.goal ? prev?.value : undefined });
}
