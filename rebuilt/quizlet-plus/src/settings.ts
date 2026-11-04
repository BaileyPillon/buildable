import { loadSettings, saveSettings } from './db';
import { DEFAULT_SETTINGS, type Settings } from './types';
import { makeParams, type FsrsParams } from './fsrs';

let current: Settings = { ...DEFAULT_SETTINGS };

export function getSettings(): Settings {
  return current;
}

export async function initSettings(): Promise<Settings> {
  current = await loadSettings();
  applyTheme(current.theme);
  return current;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  current = { ...current, ...patch };
  await saveSettings(current);
  applyTheme(current.theme);
  return current;
}

export function fsrsParams(): FsrsParams {
  return makeParams({ requestRetention: current.requestRetention });
}

const THEME_KEY = 'fp-theme';

/** Theme is mirrored in localStorage so it can be applied before the database opens. */
export function applyStoredTheme(): void {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch {
    /* storage blocked: follow the system theme */
  }
}

export function applyTheme(theme: Settings['theme']): void {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    if (theme === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
  const dark = effectiveDark();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#14161f' : '#4f46e5');
}

export function effectiveDark(): boolean {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export async function toggleTheme(): Promise<void> {
  await updateSettings({ theme: effectiveDark() ? 'light' : 'dark' });
}
