import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import type { ThemeMode, WakeBand } from '../lib/types';
import { DEFAULT_BANDS, bandFor, bandLabel, validateBands } from '../lib/predictor';
import { ageInWeeks, formatAge } from '../lib/time';
import { eventsToCsv, downloadText, makeBackup, mergeData, parseBackup, type ParsedBackup } from '../lib/dataio';
import { ImportWizard } from './ImportWizard';
import { useToast } from './ui';

export interface InstallPrompt {
  prompt(): Promise<void>;
}

function ChildEditor({ id }: { id: string }) {
  const store = useStore();
  const c = store.children.find((x) => x.id === id)!;
  const [name, setName] = useState(c.name);
  const [bd, setBd] = useState(c.birthdate);
  const dirty = name.trim() !== c.name || bd !== c.birthdate;
  return (
    <div className="child-row">
      <div className="row2">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Birth date
          <input type="date" value={bd} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBd(e.target.value)} />
        </label>
      </div>
      <div className="actions">
        <span className="muted small">{formatAge(c.birthdate)} old</span>
        <span className="grow" />
        {dirty && (
          <button className="primary" disabled={!name.trim() || !bd} onClick={() => store.updateChild(id, { name: name.trim(), birthdate: bd })}>
            Save
          </button>
        )}
        <button
          className="danger"
          onClick={() => {
            if (window.confirm(`Delete ${c.name} and all of their entries? Export a backup first if unsure.`)) store.deleteChild(id);
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function AddChild() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [bd, setBd] = useState('');
  if (!open) return <button onClick={() => setOpen(true)}>Add a child</button>;
  return (
    <div className="child-row">
      <div className="row2">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Birth date
          <input type="date" value={bd} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBd(e.target.value)} />
        </label>
      </div>
      <div className="actions">
        <button onClick={() => setOpen(false)}>Cancel</button>
        <button
          className="primary"
          disabled={!name.trim() || !bd}
          onClick={() => {
            store.addChild(name, bd);
            setOpen(false);
            setName('');
            setBd('');
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

export function WakeWindows() {
  const store = useStore();
  const toast = useToast();
  const child = store.child;
  const [draft, setDraft] = useState<WakeBand[]>(() => child?.wakeBands ?? DEFAULT_BANDS);
  useEffect(() => setDraft(child?.wakeBands ?? DEFAULT_BANDS), [child?.id, child?.wakeBands]);
  if (!child) return null;
  const err = validateBands(draft);
  const custom = !!child.wakeBands;
  const currentBand = bandFor(draft, ageInWeeks(child.birthdate));
  const edit = (i: number, k: 'minMin' | 'maxMin', v: string) => setDraft((d) => d.map((b, j) => (j === i ? { ...b, [k]: v === '' ? NaN : Math.round(Number(v)) } : b)));
  const changed = JSON.stringify(draft) !== JSON.stringify(child.wakeBands ?? DEFAULT_BANDS);
  return (
    <div id="wake-windows">
      <p className="muted small">
        Minutes awake between sleeps by age. The nap predictor starts from the band for {child.name}'s age and narrows it using the last 10 days of logged sleep. {custom ? 'You have customised these.' : 'These are the defaults.'}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Age</th>
              <th>Min</th>
              <th>Max</th>
            </tr>
          </thead>
          <tbody>
            {draft.map((b, i) => (
              <tr key={b.fromWeeks} className={b === currentBand ? 'current' : ''}>
                <td>
                  {bandLabel(b)} {b === currentBand && <span className="pill now">now</span>}
                </td>
                <td>
                  <input className="num" type="number" min={10} max={720} value={Number.isNaN(b.minMin) ? '' : b.minMin} onChange={(e) => edit(i, 'minMin', e.target.value)} aria-label={`${bandLabel(b)} minimum minutes`} />
                </td>
                <td>
                  <input className="num" type="number" min={10} max={720} value={Number.isNaN(b.maxMin) ? '' : b.maxMin} onChange={(e) => edit(i, 'maxMin', e.target.value)} aria-label={`${bandLabel(b)} maximum minutes`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {err && <p className="error">{err}</p>}
      <div className="actions">
        <button
          onClick={() => {
            store.updateChild(child.id, { wakeBands: undefined });
            setDraft(DEFAULT_BANDS);
            toast('Wake windows reset to defaults');
          }}
          disabled={!custom && !changed}
        >
          Reset to defaults
        </button>
        <span className="grow" />
        <button
          className="primary"
          disabled={!!err || !changed}
          onClick={() => {
            store.updateChild(child.id, { wakeBands: draft });
            toast('Wake windows saved');
          }}
        >
          Save windows
        </button>
      </div>
    </div>
  );
}

export function SettingsView({ install }: { install: InstallPrompt | null }) {
  const store = useStore();
  const toast = useToast();
  const [wizard, setWizard] = useState(false);
  const [pending, setPending] = useState<Extract<ParsedBackup, { ok: true }> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const stamp = new Date().toISOString().slice(0, 10);

  const onJson = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    const r = parseBackup(await f.text());
    if (!r.ok) setErr(r.error);
    else setPending(r);
  };

  return (
    <div className="stack">
      <section className="card">
        <h2>Children</h2>
        {store.children.map((c) => (
          <ChildEditor key={c.id + c.name + c.birthdate} id={c.id} />
        ))}
        <AddChild />
      </section>

      <section className="card">
        <h2>Wake windows</h2>
        <WakeWindows />
      </section>

      <section className="card">
        <h2>Display</h2>
        <div className="row2">
          <label>
            Night mode
            <select value={store.settings.themeMode} onChange={(e) => store.setSettings({ themeMode: e.target.value as ThemeMode })}>
              <option value="auto">Automatic (7 pm to 7 am)</option>
              <option value="night">Always on (dim red)</option>
              <option value="day">Always off</option>
            </select>
          </label>
          <label>
            Amounts
            <select value={store.settings.units} onChange={(e) => store.setSettings({ units: e.target.value as 'ml' | 'oz' })}>
              <option value="ml">Milliliters (ml)</option>
              <option value="oz">Ounces (oz)</option>
            </select>
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Your data</h2>
        <p className="muted small">
          Everything is stored on this device in your browser (IndexedDB). There is no account and no server.{' '}
          {store.persistent ? '' : 'Storage is unavailable in this browser session, so data will be lost when you close the tab.'}
        </p>
        <div className="actions wrap">
          <button onClick={() => downloadText(`nestlog-backup-${stamp}.json`, JSON.stringify(makeBackup(store.children, store.events, store.settings), null, 2), 'application/json')}>Export JSON backup</button>
          <button onClick={() => downloadText(`nestlog-entries-${stamp}.csv`, eventsToCsv(store.events, store.children), 'text/csv')}>Export CSV</button>
        </div>
        <div className="actions wrap">
          <label className="file-btn">
            Import JSON backup
            <input type="file" accept="application/json,.json" onChange={(e) => { onJson(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <button onClick={() => setWizard(true)} disabled={store.children.length === 0}>
            Import CSV (including Huckleberry)
          </button>
        </div>
        {err && <p className="error">{err}</p>}
        {pending && (
          <div className="notice">
            <p>
              Backup contains {pending.children.length} children and {pending.events.length} entries{pending.skipped ? ` (${pending.skipped} unreadable entries skipped)` : ''}.
            </p>
            <div className="actions wrap">
              <button
                className="primary"
                onClick={() => {
                  const m = mergeData({ children: store.children, events: store.events }, pending);
                  store.importMerged(m.children, m.events);
                  if (!store.settings.selectedChildId && m.children[0]) store.selectChild(m.children[0].id);
                  toast(`Merged: ${m.addedEvents} added, ${m.updatedEvents} updated`);
                  setPending(null);
                }}
              >
                Merge into current data
              </button>
              <button
                className="danger"
                onClick={async () => {
                  if (!window.confirm('Replace ALL current data with this backup?')) return;
                  await store.replaceAll({ children: pending.children, events: pending.events, settings: { ...pending.settings, selectedChildId: pending.settings.selectedChildId ?? pending.children[0]?.id ?? null } });
                  toast('Backup restored');
                  setPending(null);
                }}
              >
                Replace everything
              </button>
              <button onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>App</h2>
        <p className="muted small">Works offline once loaded. {install ? 'You can also install it to your home screen.' : 'Use your browser menu (Add to Home Screen / Install) to install it.'}</p>
        <div className="actions wrap">
          {install && <button className="primary" onClick={() => install.prompt()}>Install app</button>}
        </div>
        <p className="muted small">Wake windows are general guidance, not medical advice. Talk to your pediatrician about your baby's sleep.</p>
      </section>
      {wizard && <ImportWizard onClose={() => setWizard(false)} />}
    </div>
  );
}
