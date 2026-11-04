import type { ThemePref } from '../types';

const KEY = 'habits.theme';

/** Theme is mirrored to localStorage so it can be applied before the database loads (no flash). */
export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* ignore */
  }
}

export function applyStoredTheme() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') document.documentElement.setAttribute('data-theme', v);
  } catch {
    /* ignore */
  }
}
