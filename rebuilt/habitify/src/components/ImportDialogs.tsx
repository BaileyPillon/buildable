import { useMemo, useState } from 'react';
import type { Habit, Schedule } from '../types';
import { parseCSVRecords } from '../lib/csv';
import {
  detectKind, parseEntriesCSV, parseHabitsCSV, parseJsonImport, type AppData,
} from '../lib/exportImport';
import {
  HABITIFY_FIELDS, buildHabitifyImport, defaultStatusAction, detectDateOrder, distinctStatuses, guessMapping, parseHabitifyRows,
  parseLooseDate, summarizeHabits, type DateOrder, type HabitSelection, type HabitifyMapping, type StatusAction,
} from '../lib/habitify';
import { importData, snapshot } from '../lib/store';
import { formatDate } from '../lib/dates';
import { Modal, announce, plural } from './ui';

/* ------------------------------------------------------------------ file reading */

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

export type Prepared =
  | { type: 'app'; data: AppData; notes: string[] }
  | { type: 'habitify'; text: string; filename: string }
  | { type: 'error'; message: string };

/** Classify and parse the files the user picked. Pure aside from reading the file contents. */
export async function prepareImport(files: File[]): Promise<Prepared> {
  const texts: { name: string; text: string }[] = [];
  for (const f of files) {
    if (f.size > MAX_IMPORT_BYTES) return { type: 'error', message: `${f.name} is larger than 25 MB.` };
    texts.push({ name: f.name, text: await f.text() });
  }
  const habitify = texts.find((t) => detectKind(t.text, t.name) === 'habitify-csv');
  if (habitify) return { type: 'habitify', text: habitify.text, filename: habitify.name };

  const notes: string[] = [];
  let habits: Habit[] = [];
  let entries: AppData['entries'] = [];
  let settings: AppData['settings'];
  const entryCsvs: string[] = [];
  for (const t of texts) {
    const kind = detectKind(t.text, t.name);
    if (kind === 'json') {
      const r = parseJsonImport(t.text);
      if (!r.ok) return { type: 'error', message: `${t.name}: ${r.error}` };
      habits = habits.concat(r.value.habits);
      entries = entries.concat(r.value.entries);
      settings = r.value.settings;
    } else if (kind === 'habits-csv') {
      const r = parseHabitsCSV(t.text);
      if (!r.ok) return { type: 'error', message: `${t.name}: ${r.error}` };
      habits = habits.concat(r.value);
    } else if (kind === 'entries-csv') {
      entryCsvs.push(t.text);
    } else {
      return { type: 'error', message: `${t.name}: not a recognised file. Use a JSON or CSV file exported from this app, or a Habitify CSV export.` };
    }
  }
  const current = snapshot().habits;
  for (const text of entryCsvs) {
    const r = parseEntriesCSV(text, [...habits, ...current], Math.max(-1, ...current.map((h) => h.order), ...habits.map((h) => h.order)) + 1);
    if (!r.ok) return { type: 'error', message: r.error };
    habits = habits.concat(r.value.newHabits);
    entries = entries.concat(r.value.entries);
    if (r.value.skippedRows) notes.push(`${plural(r.value.skippedRows, 'row')} could not be read and will be skipped.`);
    if (r.value.newHabits.length) notes.push(`${plural(r.value.newHabits.length, 'new habit')} will be created from names in the check-ins file.`);
  }
  if (habits.length === 0 && entries.length === 0) return { type: 'error', message: 'Nothing to import was found in that file.' };
  return { type: 'app', data: { habits, entries, settings }, notes };
}

/* ------------------------------------------------------------------ generic dialog */

export function ImportDialog({ data, notes, onClose }: { data: AppData; notes: string[]; onClose: (message?: string) => void }) {
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = snapshot();
  const known = new Set(current.habits.map((h) => h.id));
  const overlap = data.habits.filter((h) => known.has(h.id)).length;

  const run = async () => {
    setBusy(true);
    try {
      await importData(data, mode);
      const msg = `Imported ${plural(data.habits.length, 'habit')} and ${plural(data.entries.length, 'check-in')} (${mode === 'replace' ? 'replaced existing data' : 'merged'}).`;
      announce(msg);
      onClose(msg);
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  };

  return (
    <Modal title="Import data" onClose={() => onClose()}>
      <p>
        This file contains <strong>{plural(data.habits.length, 'habit')}</strong> and <strong>{plural(data.entries.length, 'check-in')}</strong>.
      </p>
      {notes.length > 0 && <ul className="hint-list">{notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      <fieldset className="field">
        <legend>How should it be added?</legend>
        <label className="check-line">
          <input type="radio" name="imode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
          Merge with what I have{overlap ? ` (${plural(overlap, 'habit')} already exist and will be updated)` : ''}
        </label>
        <label className="check-line">
          <input type="radio" name="imode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
          Replace everything (deletes your {plural(current.habits.length, 'current habit')})
        </label>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button className="btn" onClick={() => onClose()}>Cancel</button>
        <button className={`btn ${mode === 'replace' ? 'danger' : 'primary'}`} disabled={busy} onClick={run}>
          {mode === 'replace' ? 'Replace and import' : 'Import'}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Habitify dialog */

type ScheduleChoice = 'daily' | 'weekdays' | `w${1 | 2 | 3 | 4 | 5 | 6 | 7}`;

const toChoice = (s: Schedule): ScheduleChoice =>
  s.type === 'weekly' ? (`w${s.times}` as ScheduleChoice) : s.type === 'weekdays' ? 'weekdays' : 'daily';
const fromChoice = (c: ScheduleChoice): Schedule =>
  c === 'daily' ? { type: 'daily' } : c === 'weekdays' ? { type: 'weekdays', days: [1, 2, 3, 4, 5] } : { type: 'weekly', times: Number(c.slice(1)) };

const ORDER_LABEL: Record<DateOrder, string> = { ymd: 'Year-month-day (2026-10-27)', mdy: 'Month/day/year (10/27/2026)', dmy: 'Day/month/year (27/10/2026)' };

export function HabitifyImport({ text, filename, onClose }: { text: string; filename: string; onClose: (message?: string) => void }) {
  const { headers, records } = useMemo(() => parseCSVRecords(text), [text]);
  const [mapping, setMapping] = useState<HabitifyMapping>(() => guessMapping(headers));
  const detected = useMemo(() => detectDateOrder(records.slice(0, 500).map((r) => r[mapping.date] ?? '')), [records, mapping.date]);
  const [orderChoice, setOrderChoice] = useState<DateOrder | null>(null);
  const dateOrder: DateOrder = orderChoice ?? (detected === 'ambiguous' ? 'mdy' : detected);
  const statusValues = useMemo(() => (mapping.status ? distinctStatuses(records, mapping.status) : []), [records, mapping.status]);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, StatusAction>>({});
  const statusMap = useMemo(() => Object.fromEntries(statusValues.map((s) => [s, statusOverrides[s] ?? defaultStatusAction(s)])), [statusValues, statusOverrides]);
  const [overrides, setOverrides] = useState<Record<string, Partial<HabitSelection> & { schedule?: Schedule }>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const missing = HABITIFY_FIELDS.filter((f) => f.required && !mapping[f.key]);
  const parsed = useMemo(
    () => (missing.length ? { rows: [], badDates: 0, missingNames: 0 } : parseHabitifyRows(records, { mapping, dateOrder, statusMap })),
    [records, mapping, dateOrder, statusMap, missing.length],
  );
  const existing = snapshot().habits;
  const previews = useMemo(() => summarizeHabits(parsed.rows, existing), [parsed.rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const selections: Record<string, HabitSelection> = {};
  for (const p of previews) {
    const o = overrides[p.groupKey] ?? {};
    selections[p.groupKey] = { include: o.include ?? true, schedule: o.schedule ?? p.suggested, goalTarget: o.goalTarget !== undefined ? o.goalTarget : p.goalTarget };
  }
  const chosen = previews.filter((p) => selections[p.groupKey]!.include);
  const chosenKeys = new Set(chosen.map((p) => p.groupKey));
  const checkinCount = parsed.rows.filter((r) => chosenKeys.has(r.groupKey) && r.action !== 'ignore').length;
  const sampleDates = records.slice(0, 4).map((r) => ({ raw: r[mapping.date] ?? '', parsed: parseLooseDate(r[mapping.date] ?? '', dateOrder) }));
  const setOverride = (key: string, patch: Partial<HabitSelection>) => setOverrides((o) => ({ ...o, [key]: { ...o[key], ...patch } }));

  const run = async () => {
    setBusy(true);
    try {
      const plan = buildHabitifyImport(parsed.rows, previews, selections, existing);
      await importData({ habits: plan.newHabits, entries: plan.entries }, 'merge');
      const msg = `Imported ${plural(plan.newHabits.length, 'new habit')} and ${plural(plan.entries.length, 'check-in')} from Habitify.`;
      announce(msg);
      onClose(msg);
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  };

  return (
    <Modal title="Import from Habitify" onClose={() => onClose()} wide>
      <p className="muted">
        File: {filename} · {plural(records.length, 'row')}. Habitify&apos;s CSV export normally has the columns{' '}
        <code>Habit, Date, Total log, Unit, Status, Habit ID</code>. Check the matches below and confirm before anything is imported. Nothing leaves this device.
      </p>

      <section aria-labelledby="hi-cols">
        <h3 id="hi-cols">1. Columns</h3>
        <table className="map-table">
          <thead>
            <tr><th scope="col">Field</th><th scope="col">Column in your file</th><th scope="col">First rows</th></tr>
          </thead>
          <tbody>
            {HABITIFY_FIELDS.map((f) => (
              <tr key={f.key}>
                <th scope="row">
                  <label htmlFor={`map-${f.key}`}>{f.label}{f.required ? ' *' : ''}</label>
                  <div className="row-sub">Habitify: {f.expected}</div>
                </th>
                <td>
                  <select id={`map-${f.key}`} value={mapping[f.key]} onChange={(e) => { setMapping({ ...mapping, [f.key]: e.target.value }); setConfirmed(false); }}>
                    <option value="">{f.required ? 'Choose a column…' : '(not in file)'}</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </td>
                <td className="samples">{mapping[f.key] ? records.slice(0, 3).map((r) => r[mapping[f.key]] || '·').join(' | ') : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {missing.length > 0 && <p className="error" role="alert">Choose a column for: {missing.map((m) => m.label).join(', ')}.</p>}
      </section>

      {missing.length === 0 && (
        <>
          <section aria-labelledby="hi-date">
            <h3 id="hi-date">2. Date format</h3>
            <div className="field">
              <label htmlFor="hi-order">Dates are written as</label>
              <select id="hi-order" value={dateOrder} onChange={(e) => { setOrderChoice(e.target.value as DateOrder); setConfirmed(false); }}>
                {(Object.keys(ORDER_LABEL) as DateOrder[]).map((o) => <option key={o} value={o}>{ORDER_LABEL[o]}</option>)}
              </select>
            </div>
            <p className="hint">
              {sampleDates.map((s, i) => (
                <span key={i} className="sample">{s.raw || '(empty)'} → {s.parsed ? formatDate(s.parsed, { month: 'short', day: 'numeric', year: 'numeric' }) : 'not a date'}</span>
              ))}
            </p>
            {detected === 'ambiguous' && orderChoice === null && (
              <p className="warn" role="status">Day and month could be swapped in this file. Check the sample above, and change the format if it looks wrong.</p>
            )}
            {(parsed.badDates > 0 || parsed.missingNames > 0) && (
              <p className="warn" role="status">
                {parsed.badDates > 0 && `${plural(parsed.badDates, 'row')} have a date that could not be read. `}
                {parsed.missingNames > 0 && `${plural(parsed.missingNames, 'row')} have no habit name. `}
                They will be skipped.
              </p>
            )}
          </section>

          <section aria-labelledby="hi-status">
            <h3 id="hi-status">3. Status values</h3>
            <p className="hint">A habit with no check-in on a scheduled day counts as missed, so &quot;Failed&quot; rows are not stored.</p>
            <table className="map-table">
              <tbody>
                {statusValues.map((s) => (
                  <tr key={s || '(empty)'}>
                    <th scope="row"><label htmlFor={`st-${s}`}>{s || '(empty)'}</label></th>
                    <td>
                      <select id={`st-${s}`} value={statusMap[s]} onChange={(e) => { setStatusOverrides({ ...statusOverrides, [s]: e.target.value as StatusAction }); setConfirmed(false); }}>
                        <option value="done">Done</option>
                        <option value="skipped">Skipped</option>
                        <option value="ignore">Missed (do not import)</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section aria-labelledby="hi-habits">
            <h3 id="hi-habits">4. Habits</h3>
            <p className="hint">Habitify&apos;s CSV does not include schedules. Pick how each habit repeats; sparse histories with no failures get a weekly suggestion.</p>
            <ul className="import-habits">
              {previews.map((p) => {
                const sel = selections[p.groupKey]!;
                return (
                  <li key={p.groupKey}>
                    <label className="check-line">
                      <input type="checkbox" checked={sel.include} onChange={(e) => setOverride(p.groupKey, { include: e.target.checked })} />
                      <strong>{p.name}</strong>
                    </label>
                    <div className="row-sub">
                      {plural(p.done, 'completed day')}, {p.skipped} skipped, {p.ignored} missed · {formatDate(p.first, { month: 'short', day: 'numeric', year: 'numeric' })} to {formatDate(p.last, { month: 'short', day: 'numeric', year: 'numeric' })}
                      {p.matchedHabitId ? ' · already in this app: check-ins will be merged into it' : ''}
                    </div>
                    {sel.include && !p.matchedHabitId && (
                      <div className="row-wrap">
                        <label htmlFor={`sch-${p.groupKey}`}>Repeats</label>
                        <select id={`sch-${p.groupKey}`} value={toChoice(sel.schedule)} onChange={(e) => setOverride(p.groupKey, { schedule: fromChoice(e.target.value as ScheduleChoice) })}>
                          <option value="daily">Every day</option>
                          <option value="weekdays">Monday to Friday</option>
                          {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={`w${n}`}>{n}× per week</option>)}
                        </select>
                        {p.unit && (
                          <>
                            <label htmlFor={`goal-${p.groupKey}`}>Daily goal ({p.unit})</label>
                            <input
                              id={`goal-${p.groupKey}`}
                              className="short"
                              inputMode="decimal"
                              value={sel.goalTarget ?? ''}
                              placeholder="none"
                              onChange={(e) => {
                                const n = Number(e.target.value.replace(',', '.'));
                                setOverride(p.groupKey, { goalTarget: e.target.value.trim() === '' || !(n > 0) ? undefined : n });
                              }}
                            />
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="hi-go">
            <h3 id="hi-go">5. Confirm</h3>
            <label className="check-line">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              The columns, date format and statuses above match my Habitify file.
            </label>
            <p className="muted">
              Ready to import {plural(checkinCount, 'check-in')} for {plural(chosen.length, 'habit')}. Existing data is kept; re-importing the same file does not create duplicates.
            </p>
          </section>
        </>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button className="btn" onClick={() => onClose()}>Cancel</button>
        <button className="btn primary" disabled={busy || !confirmed || missing.length > 0 || chosen.length === 0} onClick={run}>
          Import
        </button>
      </div>
    </Modal>
  );
}

