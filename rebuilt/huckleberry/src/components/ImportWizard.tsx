import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { parseCsv } from '../lib/csv';
import { isNativeCsvHeader, importNativeCsv, uid } from '../lib/dataio';
import { MAPPED_TYPES, buildEvents, distinct, guessMapping, guessType, type Mapping, type MappedType } from '../lib/importer';
import { Modal, useToast } from './ui';
import { formatClock } from '../lib/time';

const NONE = -1;

/**
 * CSV import. Reads the file, shows what it found, and lets the user confirm or change the
 * column mapping before anything is written (the Huckleberry export format could not be
 * inspected while building this, so nothing is assumed silently).
 */
export function ImportWizard({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [file, setFile] = useState<string>('');
  const [rows, setRows] = useState<string[][] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [childId, setChildId] = useState(store.child?.id ?? '');
  const [filter, setFilter] = useState<string>('');

  const header = rows?.[0] ?? [];
  const native = rows ? isNativeCsvHeader(header) : false;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try {
      const text = await f.text();
      const parsed = parseCsv(text);
      if (parsed.length < 2) throw new Error('The file has no data rows.');
      setFile(f.name);
      setRows(parsed);
      setMapping(guessMapping(parsed[0], parsed.slice(1)));
      setFilter('');
    } catch (e) {
      setRows(null);
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    }
  };

  const result = useMemo(() => {
    if (!rows || !childId) return null;
    if (native) {
      const r = importNativeCsv(rows, childId, filter || null);
      const taken = new Map(store.events.map((e) => [e.id, e.childId]));
      // never move another child's entry just because the ids match
      const events = r.events.map((e) => (taken.has(e.id) && taken.get(e.id) !== childId ? { ...e, id: uid() } : e));
      const counts: Record<string, number> = {};
      for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
      return { events, skipped: r.skipped, ignoredTypes: {} as Record<string, number>, counts, names: r.childNames };
    }
    if (!mapping) return null;
    const r = buildEvents(rows, mapping, childId, { childFilter: filter || null });
    return { ...r, names: mapping.child >= 0 ? distinct(rows.slice(1), mapping.child) : [] };
  }, [rows, mapping, childId, native, filter, store.events]);

  const colOptions = (
    <>
      <option value={NONE}>(none)</option>
      {header.map((h, i) => (
        <option key={i} value={i}>
          {h || `Column ${i + 1}`}
        </option>
      ))}
    </>
  );
  const setCol = (k: 'start' | 'end' | 'duration' | 'type' | 'notes' | 'child') => (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!mapping || !rows) return;
    const v = Number(e.target.value);
    const next = { ...mapping, [k]: v };
    if (k === 'type') {
      next.typeMap = {};
      if (v >= 0) for (const val of distinct(rows.slice(1), v)) next.typeMap[val] = guessType(val);
    }
    setMapping(next);
  };

  const doImport = () => {
    if (!result || !childId) return;
    store.importMerged([], result.events);
    toast(`Imported ${result.events.length} entries`);
    onClose();
  };

  const startMissing = !native && mapping && mapping.start === NONE;

  return (
    <Modal title="Import CSV" onClose={onClose}>
      <div className="form">
        <p className="muted small">
          Works with this app's own CSV export and with other trackers, including a Huckleberry CSV export. Nothing is saved until you press Import, and importing the same file twice does not create duplicates.
        </p>
        <label>
          CSV file
          <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {rows && (
          <>
            <p>
              <b>{file}</b>: {rows.length - 1} rows, {header.length} columns{native ? ' (recognised as this app\'s own export)' : ''}.
            </p>
            <div className="table-wrap">
              <table className="mini">
                <thead>
                  <tr>
                    {header.map((h, i) => (
                      <th key={i}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(1, 5).map((r, i) => (
                    <tr key={i}>
                      {header.map((_, j) => (
                        <td key={j}>{r[j]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <label>
              Import into
              <select value={childId} onChange={(e) => setChildId(e.target.value)}>
                {store.children.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            {result && result.names.length > 1 && (
              <label>
                The file has several children. Import rows for
                <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                  <option value="">All rows</option>
                  {result.names.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {!native && mapping && (
              <fieldset>
                <legend>Column mapping (check this before importing)</legend>
                <div className="row2">
                  <label>
                    Start time
                    <select value={mapping.start} onChange={setCol('start')}>
                      {colOptions}
                    </select>
                  </label>
                  <label>
                    End time
                    <select value={mapping.end} onChange={setCol('end')}>
                      {colOptions}
                    </select>
                  </label>
                  <label>
                    Duration
                    <select value={mapping.duration} onChange={setCol('duration')}>
                      {colOptions}
                    </select>
                  </label>
                  <label>
                    Type
                    <select value={mapping.type} onChange={setCol('type')}>
                      {colOptions}
                    </select>
                  </label>
                  <label>
                    Notes
                    <select value={mapping.notes} onChange={setCol('notes')}>
                      {colOptions}
                    </select>
                  </label>
                  <label>
                    Child (optional)
                    <select value={mapping.child} onChange={setCol('child')}>
                      {colOptions}
                    </select>
                  </label>
                </div>
                <div className="check-list">
                  <span className="small muted">Detail columns (side, bottle or breast, amount, diaper contents):</span>
                  {header.map((h, i) => (
                    <label className="check" key={i}>
                      <input
                        type="checkbox"
                        checked={mapping.details.includes(i)}
                        onChange={(e) => setMapping({ ...mapping, details: e.target.checked ? [...mapping.details, i] : mapping.details.filter((x) => x !== i) })}
                      />
                      {h || `Column ${i + 1}`}
                    </label>
                  ))}
                </div>
                {mapping.type >= 0 && (
                  <div className="typemap">
                    <span className="small muted">What each Type value means:</span>
                    {Object.entries(mapping.typeMap).map(([raw, t]) => (
                      <label key={raw} className="inline">
                        <code>{raw}</code>
                        <select value={t} onChange={(e) => setMapping({ ...mapping, typeMap: { ...mapping.typeMap, [raw]: e.target.value as MappedType } })}>
                          {MAPPED_TYPES.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                )}
                <div className="row2">
                  <label>
                    Date order for 01/02/2026
                    <select value={mapping.dateOrder} onChange={(e) => setMapping({ ...mapping, dateOrder: e.target.value as 'mdy' | 'dmy' })}>
                      <option value="mdy">Month first (US)</option>
                      <option value="dmy">Day first</option>
                    </select>
                  </label>
                  <label>
                    Amounts without a unit are
                    <select value={mapping.amountUnit} onChange={(e) => setMapping({ ...mapping, amountUnit: e.target.value as 'ml' | 'oz' })}>
                      <option value="ml">ml</option>
                      <option value="oz">oz</option>
                    </select>
                  </label>
                </div>
              </fieldset>
            )}

            {startMissing && <p className="error">Pick the column that holds the start time.</p>}

            {result && !startMissing && (
              <div className="preview">
                <p>
                  <b>{result.events.length}</b> entries ready
                  {Object.keys(result.counts).length > 0 && <>: {Object.entries(result.counts).map(([k, v]) => `${v} ${k}`).join(', ')}</>}.
                </p>
                {Object.keys(result.ignoredTypes).length > 0 && (
                  <p className="muted small">Skipped types: {Object.entries(result.ignoredTypes).map(([k, v]) => `${k} (${v})`).join(', ')}.</p>
                )}
                {result.skipped.length > 0 && (
                  <p className="muted small">
                    {result.skipped.length} rows could not be read, e.g. line {result.skipped[0].line}: {result.skipped[0].reason}.
                  </p>
                )}
                {result.events.slice(0, 3).map((e) => (
                  <p className="muted small" key={e.id}>
                    {new Date(e.start).toLocaleDateString()} {formatClock(e.start)} {e.type}
                    {e.method ? ` (${e.method})` : ''}
                    {e.diaper ? ` (${e.diaper})` : ''}
                    {e.amountMl ? ` ${e.amountMl} ml` : ''}
                    {e.end != null && e.end > e.start ? ` to ${formatClock(e.end)}` : ''}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
        <div className="actions">
          <span className="grow" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!result || result.events.length === 0 || !!startMissing} onClick={doImport}>
            Import {result ? result.events.length : ''}
          </button>
        </div>
      </div>
    </Modal>
  );
}
