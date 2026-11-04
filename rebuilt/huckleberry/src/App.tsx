import { useCallback, useEffect, useState } from 'react';
import { StoreProvider, useStore } from './lib/store';
import { formatAge } from './lib/time';
import { Icon, ToastProvider, useNow } from './components/ui';
import { Timers } from './components/Timers';
import { Predictor } from './components/Predictor';
import { Timeline } from './components/Timeline';
import { SummaryView } from './components/SummaryView';
import { ShareView } from './components/ShareView';
import { SettingsView, type InstallPrompt } from './components/SettingsView';
import type { ThemeMode } from './lib/types';

type Tab = 'today' | 'summary' | 'share' | 'settings';

export function isNightNow(mode: ThemeMode, ms: number): boolean {
  if (mode === 'night') return true;
  if (mode === 'day') return false;
  const h = new Date(ms).getHours();
  return h >= 19 || h < 7;
}

function ThemeController() {
  const { settings } = useStore();
  const now = useNow(60_000);
  const night = isNightNow(settings.themeMode, now);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', night ? 'night' : 'day');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', night ? '#120000' : '#f6f1ea');
    try {
      localStorage.setItem('nestlog-theme', settings.themeMode);
    } catch {
      /* storage may be blocked; the theme still applies for this session */
    }
  }, [night, settings.themeMode]);
  return null;
}

function Onboarding() {
  const store = useStore();
  const [name, setName] = useState('');
  const [bd, setBd] = useState('');
  return (
    <main className="onboard">
      <div className="card">
        <h1>Welcome to Nestlog</h1>
        <p className="muted">Track sleep, feeds, diapers and pumping. Everything stays on this device and works offline.</p>
        <label>
          Baby's name
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label>
          Birth date
          <input type="date" value={bd} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBd(e.target.value)} />
        </label>
        <p className="muted small">The birth date sets the age-based wake windows for the nap predictor.</p>
        <button className="primary wide" disabled={!name.trim() || !bd} onClick={() => store.addChild(name, bd)}>
          Start tracking
        </button>
      </div>
    </main>
  );
}

function Shell({ install }: { install: InstallPrompt | null }) {
  const store = useStore();
  const [tab, setTab] = useState<Tab>('today');
  const now = useNow(60_000);

  const goWindows = useCallback(() => {
    setTab('settings');
    setTimeout(() => document.getElementById('wake-windows')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }, []);

  if (!store.ready) return <div className="loading">Loading...</div>;
  if (!store.child) return <Onboarding />;

  const night = isNightNow(store.settings.themeMode, now);
  const cycle = () => store.setSettings({ themeMode: night ? 'day' : 'night' });

  return (
    <div className="app">
      <header className="top">
        <div className="who">
          {store.children.length > 1 ? (
            <select aria-label="Child" value={store.child.id} onChange={(e) => store.selectChild(e.target.value)}>
              {store.children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <strong>{store.child.name}</strong>
          )}
          <span className="muted small">{formatAge(store.child.birthdate, now)}</span>
        </div>
        <button className="icon-btn" onClick={cycle} aria-label={night ? 'Switch to day mode' : 'Switch to dim red night mode'} title="Night mode">
          <Icon name={night ? 'sun' : 'moon'} />
        </button>
      </header>

      {store.error && (
        <div className="banner error" role="alert">
          {store.error} <button onClick={store.clearError}>Dismiss</button>
        </div>
      )}
      {!store.persistent && (
        <div className="banner" role="status">
          This browser blocked local storage, so entries will be lost when you close the tab.
        </div>
      )}

      <main className="content">
        {tab === 'today' && (
          <div className="stack">
            <Timers />
            <Predictor onEditWindows={goWindows} />
            <Timeline />
          </div>
        )}
        {tab === 'summary' && <SummaryView />}
        {tab === 'share' && <ShareView />}
        {tab === 'settings' && <SettingsView install={install} />}
      </main>

      <nav className="tabs" aria-label="Sections">
        {(
          [
            ['today', 'Today', 'today'],
            ['summary', 'Summary', 'chart'],
            ['share', 'Share', 'share'],
            ['settings', 'Settings', 'gear'],
          ] as [Tab, string, string][]
        ).map(([k, label, icon]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}>
            <Icon name={icon} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export function App() {
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      const ev = e as Event & { prompt(): Promise<void> };
      setInstall({
        prompt: async () => {
          await ev.prompt();
          setInstall(null);
        },
      });
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  return (
    <ToastProvider>
      <StoreProvider>
        <ThemeController />
        <Shell install={install} />
      </StoreProvider>
    </ToastProvider>
  );
}
