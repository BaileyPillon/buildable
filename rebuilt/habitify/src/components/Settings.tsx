import { useEffect, useRef, useState } from 'react';
import type { ThemePref } from '../types';
import { buildExportFile, downloadText, entriesToCSV, habitsToCSV } from '../lib/exportImport';
import { promptInstall, useCanInstall } from '../lib/install';
import { notificationSupport, requestNotifications, showNotification } from '../lib/reminders';
import { resetAll, snapshot, updateSettings, useAppState } from '../lib/store';
import { applyTheme } from '../lib/theme';
import { todayKey } from '../lib/dates';
import { Confirm } from './Confirm';
import { HabitifyImport, ImportDialog, prepareImport, type Prepared } from './ImportDialogs';
import { Icon, announce, plural } from './ui';

export function Settings() {
  const state = useAppState();
  const canInstall = useCanInstall();
  const [support, setSupport] = useState(notificationSupport);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [message, setMessage] = useState('');
  const [resetting, setResetting] = useState(false);
  const [storage, setStorage] = useState<{ persisted: boolean | null; usage?: number }>({ persisted: null });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const persisted = (await navigator.storage?.persisted?.()) ?? null;
        const est = await navigator.storage?.estimate?.();
        setStorage({ persisted, usage: est?.usage });
      } catch {
        /* storage API not available */
      }
    })();
  }, []);

  const setTheme = (t: ThemePref) => {
    updateSettings({ theme: t });
    applyTheme(t);
  };

  const exportJson = () => {
    const file = buildExportFile(snapshot());
    downloadText(`habit-tracker-${todayKey()}.json`, 'application/json', JSON.stringify(file, null, 2));
    setMessage('Exported JSON backup.');
  };
  const exportCsv = () => {
    const s = snapshot();
    downloadText(`habits-${todayKey()}.csv`, 'text/csv;charset=utf-8', habitsToCSV(s.habits));
    setTimeout(() => downloadText(`check-ins-${todayKey()}.csv`, 'text/csv;charset=utf-8', entriesToCSV(s.habits, s.entries)), 300);
    setMessage('Exported two CSV files: habits and check-ins.');
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setMessage('');
    setPrepared(await prepareImport([...files]));
    if (fileRef.current) fileRef.current.value = '';
  };

  const requestPersist = async () => {
    try {
      const ok = await navigator.storage?.persist?.();
      setStorage((s) => ({ ...s, persisted: !!ok }));
      setMessage(ok ? 'Storage will not be cleared automatically.' : 'The browser declined. Your data is still saved, but may be cleared if the device runs low on space.');
    } catch {
      setMessage('This browser does not support persistent storage requests.');
    }
  };

  const reminderHabits = state.habits.filter((h) => h.reminder?.enabled && !h.archived);

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Everything is stored in this browser (IndexedDB). There is no account and no server.</p>
        </div>
      </header>

      {message && <p className="notice" role="status">{message}</p>}

      <section className="card" aria-labelledby="set-look">
        <h2 id="set-look">Appearance</h2>
        <div className="field">
          <span id="theme-l" className="label">Theme</span>
          <div className="seg" role="group" aria-labelledby="theme-l">
            {(['system', 'light', 'dark'] as ThemePref[]).map((t) => (
              <button key={t} aria-pressed={state.settings.theme === t} onClick={() => setTheme(t)}>
                {t === 'system' ? 'Match device' : t === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span id="ws-l" className="label">Week starts on</span>
          <div className="seg" role="group" aria-labelledby="ws-l">
            <button aria-pressed={state.settings.weekStart === 1} onClick={() => updateSettings({ weekStart: 1 })}>Monday</button>
            <button aria-pressed={state.settings.weekStart === 0} onClick={() => updateSettings({ weekStart: 0 })}>Sunday</button>
          </div>
          <p className="hint">Affects weekly goals, weekly streaks and the review.</p>
        </div>
        {canInstall && (
          <div className="field">
            <button className="btn" onClick={() => void promptInstall()}>Install app on this device</button>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="set-notif">
        <h2 id="set-notif">Reminders</h2>
        <p className={support.kind === 'unsupported' || support.kind === 'denied' ? 'warn' : ''} role="status">{support.message}</p>
        <div className="actions start">
          {support.kind === 'default' && (
            <button
              className="btn primary"
              onClick={async () => {
                await requestNotifications();
                setSupport(notificationSupport());
              }}
            >
              Allow notifications
            </button>
          )}
          {support.kind === 'granted' && (
            <button
              className="btn"
              onClick={async () => {
                const ok = await showNotification('Habit Tracker', 'Notifications are working.', 'test');
                announce(ok ? 'Test notification sent' : 'Could not show a notification');
              }}
            >
              Send a test notification
            </button>
          )}
        </div>
        <p className="muted">
          {reminderHabits.length === 0
            ? 'No habit has a reminder yet. Set one when you add or edit a habit.'
            : `${plural(reminderHabits.length, 'habit')} with a reminder: ${reminderHabits.map((h) => `${h.name} at ${h.reminder!.time}`).join(', ')}.`}
        </p>
      </section>

      <section className="card" aria-labelledby="set-data">
        <h2 id="set-data">Your data</h2>
        <p className="muted">{plural(state.habits.length, 'habit')} and {plural(Object.values(state.entries).reduce((n, m) => n + Object.keys(m).length, 0), 'check-in')}{storage.usage !== undefined ? ` · about ${Math.max(1, Math.round(storage.usage / 1024))} KB used` : ''}.</p>

        <h3>Export</h3>
        <div className="actions start">
          <button className="btn" onClick={exportJson}><Icon name="archive" size={18} /> JSON backup</button>
          <button className="btn" onClick={exportCsv}><Icon name="list" size={18} /> CSV (habits and check-ins)</button>
        </div>
        <p className="hint">JSON holds everything and is the best backup. The CSV export is two files that open in any spreadsheet and can be imported back here.</p>

        <h3>Import</h3>
        <div className="field">
          <label htmlFor="import-file">Choose a JSON or CSV file (select both CSV files together to restore habits and check-ins)</label>
          <input id="import-file" ref={fileRef} type="file" multiple accept=".json,.csv,application/json,text/csv" onChange={(e) => void onFiles(e.target.files)} />
        </div>
        <p className="hint">
          Coming from Habitify? In Habitify open Settings, then Import / Export, and export the CSV. Choose that file here; you will be asked to confirm its columns before anything is imported.
        </p>

        <h3>Storage</h3>
        <p className="muted">
          {storage.persisted === true && 'This browser has promised not to clear your data automatically.'}
          {storage.persisted === false && 'Browsers may clear site data when the device is low on space.'}
          {storage.persisted === null && 'Persistent storage status is not available in this browser.'}
        </p>
        {storage.persisted === false && <button className="btn" onClick={() => void requestPersist()}>Ask the browser to keep my data</button>}
      </section>

      <section className="card danger-zone" aria-labelledby="set-danger">
        <h2 id="set-danger">Danger zone</h2>
        <button className="btn danger" onClick={() => setResetting(true)}><Icon name="trash" size={18} /> Delete all data</button>
      </section>

      {prepared?.type === 'error' && (
        <p className="error" role="alert">{prepared.message}</p>
      )}
      {prepared?.type === 'app' && (
        <ImportDialog
          data={prepared.data}
          notes={prepared.notes}
          onClose={(m) => {
            setPrepared(null);
            if (m) setMessage(m);
          }}
        />
      )}
      {prepared?.type === 'habitify' && (
        <HabitifyImport
          text={prepared.text}
          filename={prepared.filename}
          onClose={(m) => {
            setPrepared(null);
            if (m) setMessage(m);
          }}
        />
      )}
      {resetting && (
        <Confirm
          title="Delete all data?"
          body="This permanently deletes every habit, check-in and note on this device. Export a JSON backup first if you might want them back."
          confirmLabel="Delete everything"
          onConfirm={() => void resetAll().then(() => setMessage('All data deleted.'))}
          onClose={() => setResetting(false)}
        />
      )}
    </div>
  );
}
