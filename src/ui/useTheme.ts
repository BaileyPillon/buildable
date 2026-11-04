import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'buildable:theme';

function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function readStored(): Theme | null {
  try {
    // sessionStorage on purpose: the brief reserves localStorage for the Context.
    const v = window.sessionStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

/** Follows the system until the person flips the toggle; then holds their choice for the session. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [choice, setChoice] = useState<Theme | null>(readStored);
  const [system, setSystem] = useState<Theme>(systemTheme);

  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const onChange = (): void => setSystem(mq?.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq?.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (choice) root.setAttribute('data-theme', choice);
    else root.removeAttribute('data-theme');
  }, [choice]);

  const theme = choice ?? system;
  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setChoice(next);
    try {
      window.sessionStorage.setItem(KEY, next);
    } catch {
      // ignore
    }
  }, [theme]);

  return { theme, toggle };
}
