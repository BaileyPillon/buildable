import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { todayKey } from '../lib/dates';

/* ------------------------------------------------------------------ icons */

const PATHS: Record<string, string> = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  skip: 'M5 5l8 7-8 7V5zm10 0v14',
  note: 'M6 3h9l4 4v14H6V3zm9 0v4h4M9 12h7M9 16h7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  up: 'M5 15l7-7 7 7',
  down: 'M5 9l7 7 7-7',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  archive: 'M3 5h18v4H3V5zm2 4v10h14V9M10 13h4',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  flame: 'M12 3c1 4 5 5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z',
  today: 'M4 5h16v15H4V5zm0 5h16M8 3v4M16 3v4',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zm7-3l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6 8.5 4 8l-1 3 2 1v2l-2 1 1 3 2-.5L7.5 19l-.5 2 3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3-2-1v-2z',
  close: 'M6 6l12 12M18 6L6 18',
  restore: 'M4 12a8 8 0 108-8M4 4v5h5',
};

export function Icon({ name, size = 20 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

/* ------------------------------------------------------------------ modal */

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      d.showModal();
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
    return () => {
      if (d?.open) d.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? 'modal wide' : 'modal'}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-inner">
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/* ----------------------------------------------------------- live regions */

let announcer: ((msg: string) => void) | null = null;

export function announce(msg: string) {
  announcer?.(msg);
}

export function LiveRegion() {
  const [msg, setMsg] = useState('');
  useEffect(() => {
    announcer = (m) => {
      setMsg('');
      setTimeout(() => setMsg(m), 20);
    };
    return () => {
      announcer = null;
    };
  }, []);
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {msg}
    </div>
  );
}

/* ------------------------------------------------------------------ hooks */

/** Today's date key; rolls over at midnight and when the tab becomes visible again. */
export function useToday(): string {
  const [today, setToday] = useState(() => todayKey());
  useEffect(() => {
    const tick = () => setToday((prev) => {
      const t = todayKey();
      return t === prev ? prev : t;
    });
    const id = setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, []);
  return today;
}

export function useHashRoute(): { path: string; parts: string[] } {
  const read = () => {
    const raw = window.location.hash.replace(/^#/, '') || '/today';
    const path = raw.startsWith('/') ? raw : '/' + raw;
    return { path, parts: path.split('/').filter(Boolean) };
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const go = (path: string) => {
  window.location.hash = path;
};

export function ProgressBar({ value, label, color }: { value: number; label: string; color?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={color ? ({ '--c': color } as React.CSSProperties) : undefined}>
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export const pct = (r: number | null) => (r === null ? '–' : `${Math.round(r * 100)}%`);

export function plural(n: number, one: string, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`;
}
