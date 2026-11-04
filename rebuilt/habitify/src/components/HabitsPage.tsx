import { useState } from 'react';
import type { Habit } from '../types';
import { TIME_LABELS } from '../types';
import { describeGoal, describeSchedule } from '../lib/schedule';
import { activeHabits, archiveHabit, archivedHabits, deleteHabit, entriesOf, moveHabit, reorderHabits, useAppState } from '../lib/store';
import { Confirm } from './Confirm';
import { HabitForm } from './HabitForm';
import { Icon, announce, go, plural } from './ui';

export function HabitsPage() {
  const state = useAppState();
  const active = activeHabits(state);
  const archived = archivedHabits(state);
  const [editing, setEditing] = useState<Habit | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Habit | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const move = (h: Habit, delta: -1 | 1) => {
    const i = active.findIndex((x) => x.id === h.id);
    const j = i + delta;
    if (j < 0 || j >= active.length) return;
    moveHabit(h.id, delta);
    announce(`${h.name} moved to position ${j + 1} of ${active.length}`);
    setTimeout(() => {
      document.querySelector<HTMLButtonElement>(`[data-move="${h.id}-${delta < 0 ? 'up' : 'down'}"]:not(:disabled)`)?.focus();
      if (!document.activeElement || document.activeElement === document.body) {
        document.querySelector<HTMLButtonElement>(`[data-move="${h.id}-${delta < 0 ? 'down' : 'up'}"]`)?.focus();
      }
    }, 30);
  };

  const drop = (target: Habit) => {
    if (!dragId || dragId === target.id) return;
    const ids = active.map((h) => h.id).filter((id) => id !== dragId);
    const at = ids.indexOf(target.id);
    const from = active.findIndex((h) => h.id === dragId);
    const to = active.findIndex((h) => h.id === target.id);
    ids.splice(from < to ? at + 1 : at, 0, dragId);
    reorderHabits(ids);
    announce(`Moved to position ${ids.indexOf(dragId) + 1} of ${ids.length}`);
  };

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Habits</h1>
          <p className="muted">Reorder with the arrows or by dragging. Order is used on the Today screen.</p>
        </div>
        <button className="btn primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={18} /> New habit
        </button>
      </header>

      {active.length === 0 && <p className="card empty">No active habits yet.</p>}

      <ul className="manage-list" aria-label="Active habits">
        {active.map((h, i) => (
          <li
            key={h.id}
            className={`manage-row ${dragId === h.id ? 'dragging' : ''} ${overId === h.id && dragId !== h.id ? 'drop-target' : ''}`}
            style={{ '--c': h.color } as React.CSSProperties}
            draggable
            onDragStart={(e) => {
              setDragId(h.id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', h.id);
            }}
            onDragOver={(e) => {
              if (dragId) {
                e.preventDefault();
                setOverId(h.id);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop(h);
              setDragId(null);
              setOverId(null);
            }}
            onDragEnd={() => {
              setDragId(null);
              setOverId(null);
            }}
          >
            <span className="grip" aria-hidden="true"><Icon name="grip" /></span>
            <span className="dot" aria-hidden="true">{h.emoji}</span>
            <div className="row-main">
              <button className="row-name" onClick={() => go(`/habit/${h.id}`)}>{h.name}</button>
              <div className="row-sub">
                {describeSchedule(h.schedule)}
                {h.goal ? ` · ${describeGoal(h)}` : ''} · {TIME_LABELS[h.timeOfDay]}
                {h.reminder?.enabled ? ` · reminder ${h.reminder.time}` : ''}
              </div>
            </div>
            <div className="row-actions">
              <button className="icon-btn" data-move={`${h.id}-up`} disabled={i === 0} aria-label={`Move ${h.name} up`} onClick={() => move(h, -1)}>
                <Icon name="up" />
              </button>
              <button className="icon-btn" data-move={`${h.id}-down`} disabled={i === active.length - 1} aria-label={`Move ${h.name} down`} onClick={() => move(h, 1)}>
                <Icon name="down" />
              </button>
              <button className="icon-btn" aria-label={`Edit ${h.name}`} onClick={() => setEditing(h)}>
                <Icon name="edit" />
              </button>
              <button
                className="icon-btn"
                aria-label={`Archive ${h.name}`}
                onClick={() => {
                  archiveHabit(h.id, true);
                  announce(`${h.name} archived`);
                }}
              >
                <Icon name="archive" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {archived.length > 0 && (
        <section aria-labelledby="archived-h" className="group">
          <h2 id="archived-h" className="group-title">Archived ({archived.length})</h2>
          <p className="muted">Archived habits keep their history but are hidden from Today and reviews.</p>
          <ul className="manage-list">
            {archived.map((h) => (
              <li key={h.id} className="manage-row archived" style={{ '--c': h.color } as React.CSSProperties}>
                <span className="dot" aria-hidden="true">{h.emoji}</span>
                <div className="row-main">
                  <button className="row-name" onClick={() => go(`/habit/${h.id}`)}>{h.name}</button>
                  <div className="row-sub">{plural(Object.values(entriesOf(state, h.id)).filter((e) => e.status === 'done').length, 'check-in')}</div>
                </div>
                <div className="row-actions">
                  <button
                    className="btn small"
                    onClick={() => {
                      archiveHabit(h.id, false);
                      announce(`${h.name} restored`);
                    }}
                  >
                    <Icon name="restore" size={16} /> Restore
                  </button>
                  <button className="icon-btn" aria-label={`Delete ${h.name} permanently`} onClick={() => setDeleting(h)}>
                    <Icon name="trash" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editing && <HabitForm habit={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <Confirm
          title={`Delete ${deleting.name}?`}
          body="This permanently deletes the habit and all of its check-ins and notes from this device. Export a backup first if you might want them."
          confirmLabel="Delete forever"
          onConfirm={() => deleteHabit(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
