import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { EventType } from '../lib/types';

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    const vis = () => setNow(Date.now());
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [intervalMs]);
  return now;
}

const PATHS: Record<string, ReactNode> = {
  sleep: <path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.8 6.8 0 0 0 9.7 9.7z" />,
  breast: <path d="M12 20.5s-7.5-4.6-9-9.6A5 5 0 0 1 12 6.3a5 5 0 0 1 9 4.6c-1.500 5-9 9.600-9 9.600z" />,
  bottle: (
    <>
      <path d="M10 2.500h4v2.500h-4z" />
      <path d="M9 5h6l1 3v11.500a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V8z" />
      <path d="M8.500 12h2.500M8.500 15.500h2.500" />
    </>
  ),
  diaper: <path d="M3 6.500h18v4.500a9 9 0 0 1-6 8.500L12 17l-3 2.500A9 9 0 0 1 3 11z" />,
  pump: <path d="M12 2.800s6 6 6 10.200a6 6 0 0 1-12 0C6 8.800 12 2.800 12 2.800z" />,
  today: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.500 2" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  share: (
    <>
      <path d="M12 3v12M7.500 7.500 12 3l4.500 4.500" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.400 15a1.700 1.700 0 0 0 .3 1.800l.1.1a2 2 0 1 1-2.800 2.800l-.1-.1a1.700 1.700 0 0 0-1.800-.3 1.700 1.700 0 0 0-1 1.500V21a2 2 0 1 1-4 0v-.1a1.700 1.700 0 0 0-1.100-1.500 1.700 1.700 0 0 0-1.800.3l-.1.1a2 2 0 1 1-2.800-2.800l.1-.1a1.700 1.700 0 0 0 .3-1.800 1.700 1.700 0 0 0-1.500-1H3a2 2 0 1 1 0-4h.1a1.700 1.700 0 0 0 1.500-1.100 1.700 1.700 0 0 0-.3-1.800l-.1-.1a2 2 0 1 1 2.800-2.800l.1.1a1.700 1.700 0 0 0 1.800.3H9a1.700 1.700 0 0 0 1-1.500V3a2 2 0 1 1 4 0v.1a1.700 1.700 0 0 0 1 1.500 1.700 1.700 0 0 0 1.800-.3l.1-.1a2 2 0 1 1 2.800 2.800l-.1.1a1.700 1.700 0 0 0-.3 1.800V9a1.700 1.700 0 0 0 1.500 1H21a2 2 0 1 1 0 4h-.1a1.700 1.700 0 0 0-1.500 1z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  chevL: <path d="M15 5l-7 7 7 7" />,
  chevR: <path d="M9 5l7 7-7 7" />,
  moon: <path d="M20.500 13.200A8.500 8.500 0 1 1 10.800 3.500a6.800 6.800 0 0 0 9.700 9.700z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.900 4.900l1.400 1.400M17.700 17.700l1.400 1.400M2 12h2M20 12h2M4.900 19.100l1.400-1.400M17.700 6.300l1.400-1.400" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  play: <path d="M8 5.500v13l11-6.500z" />,
};

export function Icon({ name, size = 22 }: { name: keyof typeof PATHS | EventType | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name] ?? null}
    </svg>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

interface ToastItem {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}
const ToastCtx = createContext<(text: string, action?: ToastItem['action']) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const push = useCallback((text: string, action?: ToastItem['action']) => {
    const id = next.current++;
    setItems((l) => [...l.slice(-2), { id, text, action }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), action ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div className="toast" key={t.id}>
            <span>{t.text}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run();
                  setItems((l) => l.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const TYPE_LABEL: Record<EventType, string> = { sleep: 'Sleep', feed: 'Feed', diaper: 'Diaper', pump: 'Pumping' };
