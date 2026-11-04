export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Start of the day `n` calendar days after `dayStart` (DST safe). */
export function addDays(dayStart: number, n: number): number {
  const d = new Date(dayStart);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}

const pad = (n: number) => String(n).padStart(2, '0');

/** value for <input type="datetime-local"> */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  return Number.isNaN(t) ? null : t;
}

export function toDateInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDateInput(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatDayLabel(dayStart: number, now = Date.now()): string {
  const today = startOfDay(now);
  if (dayStart === today) return 'Today';
  if (dayStart === addDays(today, -1)) return 'Yesterday';
  return new Date(dayStart).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatDateLong(ms: number): string {
  return new Date(ms).toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

/** 5400000 -> "1h 30m"; under a minute -> "<1m" */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / MIN));
  if (total === 0) return ms > 0 ? '<1m' : '0m';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** running timer face: m:ss or h:mm:ss */
export function formatTimer(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

export function formatAge(birthdate: string, now = Date.now()): string {
  const b = parseDateInput(birthdate);
  if (b == null) return '';
  const weeks = Math.max(0, Math.floor((now - b) / (7 * DAY)));
  if (weeks < 12) return `${weeks} wk${weeks === 1 ? '' : 's'}`;
  const bd = new Date(b);
  const nd = new Date(now);
  let months = (nd.getFullYear() - bd.getFullYear()) * 12 + nd.getMonth() - bd.getMonth();
  if (nd.getDate() < bd.getDate()) months -= 1;
  if (months < 24) return `${Math.max(0, months)} mo`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${years} yr ${rem} mo` : `${years} yr`;
}

export function ageInWeeks(birthdate: string, now = Date.now()): number {
  const b = parseDateInput(birthdate);
  if (b == null) return 0;
  return Math.max(0, (now - b) / (7 * DAY));
}
