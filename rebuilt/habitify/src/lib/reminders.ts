import type { DateKey, EntryMap, Habit } from '../types';
import { minutesOfDay, parseTime } from './dates';
import { isScheduledOn } from './schedule';
import { weekProgress } from './streaks';

export type NotifySupport =
  | { kind: 'unsupported'; message: string }
  | { kind: 'default' | 'granted' | 'denied'; message: string };

export function notificationSupport(): NotifySupport {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return {
      kind: 'unsupported',
      message:
        "This browser doesn't support the Notifications API (on iPhone and iPad it only works after you add the app to the Home Screen). Reminders will appear as banners inside the app while it is open.",
    };
  }
  const p = Notification.permission;
  if (p === 'granted') {
    return {
      kind: 'granted',
      message:
        'Notifications are on. Reminders fire at the set time while the app is open or running in the background; browsers cannot wake a fully closed app without a push server.',
    };
  }
  if (p === 'denied') {
    return {
      kind: 'denied',
      message: 'Notifications are blocked for this site. Allow them in your browser settings; until then reminders appear as banners inside the app.',
    };
  }
  return { kind: 'default', message: 'Allow notifications to get a system alert at reminder time. Without them, reminders appear as banners inside the app.' };
}

export async function requestNotifications(): Promise<void> {
  if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
}

export interface DueReminder {
  habit: Habit;
  time: string;
}

/**
 * Habits whose reminder time has passed today (within `windowMinutes`, or any time earlier today when null),
 * that are still open today, and have not already been announced today.
 */
export function dueReminders(
  habits: Habit[],
  entriesFor: (habitId: string) => EntryMap,
  now: Date,
  today: DateKey,
  weekStart: 0 | 1,
  alreadyFired: ReadonlySet<string>,
  windowMinutes: number | null = null,
): DueReminder[] {
  const nowMin = minutesOfDay(now);
  const out: DueReminder[] = [];
  for (const h of habits) {
    if (h.archived || !h.reminder?.enabled || alreadyFired.has(h.id)) continue;
    const t = parseTime(h.reminder.time);
    if (t === null || t > nowMin || (windowMinutes !== null && nowMin - t > windowMinutes)) continue;
    if (h.createdAt > today || !isScheduledOn(h.schedule, today)) continue;
    const entries = entriesFor(h.id);
    const st = entries[today]?.status;
    if (st === 'done' || st === 'skipped') continue;
    if (h.schedule.type === 'weekly') {
      const wp = weekProgress(h, entries, today, today, weekStart);
      if (wp.done >= wp.target) continue;
    }
    out.push({ habit: h, time: h.reminder.time });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

export async function showNotification(title: string, body: string, tag: string): Promise<boolean> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) {
      await reg.showNotification(title, { body, tag, icon: './icons/icon-192.png', badge: './icons/icon-192.png' });
      return true;
    }
    new Notification(title, { body, tag, icon: './icons/icon-192.png' });
    return true;
  } catch {
    return false;
  }
}

/* "already fired today" bookkeeping is a per-device convenience, so localStorage is fine. */
const FIRED_KEY = 'habits.fired';

export type FiredKind = 'notified' | 'dismissed';

export function loadFired(today: DateKey, kind: FiredKind): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(FIRED_KEY + '.' + kind) ?? 'null') as { date: string; ids: string[] } | null;
    if (raw && raw.date === today && Array.isArray(raw.ids)) return new Set(raw.ids);
  } catch {
    /* ignore */
  }
  return new Set();
}

export function saveFired(today: DateKey, kind: FiredKind, ids: Set<string>) {
  try {
    localStorage.setItem(FIRED_KEY + '.' + kind, JSON.stringify({ date: today, ids: [...ids] }));
  } catch {
    /* ignore */
  }
}
