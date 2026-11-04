import { useEffect, useRef, useState } from 'react';
import { Today } from './components/Today';
import { HabitsPage } from './components/HabitsPage';
import { HabitDetail } from './components/HabitDetail';
import { Review } from './components/Review';
import { Settings } from './components/Settings';
import { Icon, LiveRegion, go, useHashRoute, useToday } from './components/ui';
import { dueReminders, loadFired, notificationSupport, saveFired, showNotification } from './lib/reminders';
import { dismissError, entriesOf, useAppState } from './lib/store';
import { applyTheme } from './lib/theme';

const NAV = [
  { path: '/today', label: 'Today', icon: 'today' },
  { path: '/habits', label: 'Habits', icon: 'list' },
  { path: '/review', label: 'Review', icon: 'chart' },
  { path: '/settings', label: 'Settings', icon: 'gear' },
];

const TITLES: Record<string, string> = { today: 'Today', habits: 'Habits', review: 'Review', settings: 'Settings', habit: 'Habit' };

export default function App() {
  const state = useAppState();
  const route = useHashRoute();
  const today = useToday();
  const main = useRef<HTMLElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [dismissTick, setDismissTick] = useState(0);
  const section = route.parts[0] ?? 'today';

  useEffect(() => {
    applyTheme(state.settings.theme);
  }, [state.settings.theme]);

  // move focus to the page on navigation, and keep the title meaningful
  useEffect(() => {
    document.title = `${TITLES[section] ?? 'Habit Tracker'} · Habit Tracker`;
    main.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [route.path, section]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    const on = () => setNow(new Date());
    document.addEventListener('visibilitychange', on);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', on);
    };
  }, []);

  /* Reminders: in-app banner always; system notification too when permitted. */
  const dismissed = loadFired(today, 'dismissed');
  const due = state.ready
    ? dueReminders(state.habits, (id) => entriesOf(state, id), now, today, state.settings.weekStart, dismissed)
    : [];
  void dismissTick;

  useEffect(() => {
    if (!state.ready || notificationSupport().kind !== 'granted') return;
    const notified = loadFired(today, 'notified');
    const fresh = dueReminders(state.habits, (id) => entriesOf(state, id), now, today, state.settings.weekStart, notified, 120);
    if (fresh.length === 0) return;
    for (const r of fresh) notified.add(r.habit.id);
    saveFired(today, 'notified', notified);
    for (const r of fresh) void showNotification(`${r.habit.emoji ? r.habit.emoji + ' ' : ''}${r.habit.name}`, `Reminder for ${r.time}: not done yet today.`, `habit-${r.habit.id}`);
  }, [now, state, today]);

  const dismiss = (id: string) => {
    const d = loadFired(today, 'dismissed');
    d.add(id);
    saveFired(today, 'dismissed', d);
    setDismissTick((n) => n + 1);
  };

  let page;
  switch (section) {
    case 'habits':
      page = <HabitsPage />;
      break;
    case 'habit':
      page = <HabitDetail id={route.parts[1] ?? ''} today={today} />;
      break;
    case 'review':
      page = <Review today={today} />;
      break;
    case 'settings':
      page = <Settings />;
      break;
    default:
      page = <Today today={today} />;
  }

  return (
    <div className="shell">
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); main.current?.focus(); }}>Skip to content</a>
      <nav className="nav" aria-label="Main">
        <div className="brand" aria-hidden="true">
          <Icon name="check" size={22} /> <span>Habits</span>
        </div>
        <ul>
          {NAV.map((n) => {
            const active = section === n.path.slice(1) || (n.path === '/habits' && section === 'habit');
            return (
              <li key={n.path}>
                <a href={`#${n.path}`} aria-current={active ? 'page' : undefined} className={active ? 'active' : ''}>
                  <Icon name={n.icon} />
                  <span>{n.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <main id="main" ref={main} tabIndex={-1}>
        {state.error && (
          <div className="banner error" role="alert">
            <span>{state.error} Your changes may not be saved until this is fixed; export a backup from Settings if you can.</span>
            <button className="btn small" onClick={dismissError}>Dismiss</button>
          </div>
        )}
        {due.length > 0 && section !== 'settings' && (
          <section className="banner" aria-label="Reminders">
            <ul>
              {due.map((r) => (
                <li key={r.habit.id}>
                  <span>
                    <strong>{r.habit.emoji} {r.habit.name}</strong> is not done yet (reminder {r.time}).
                  </span>
                  <span className="banner-actions">
                    <button className="btn small" onClick={() => go('/today')}>Open Today</button>
                    <button className="btn small" onClick={() => dismiss(r.habit.id)} aria-label={`Dismiss reminder for ${r.habit.name}`}>Dismiss</button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {state.ready ? page : <p className="muted" role="status">Loading…</p>}
      </main>
      <LiveRegion />
    </div>
  );
}
