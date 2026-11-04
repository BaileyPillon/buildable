// Small formatting helpers. No dependencies, no locale surprises (en-US, USD).
import type { Cadence } from '../types';

export type CentsMode = 'auto' | 'always' | 'never';

export function money(n: number, cents: CentsMode = 'auto'): string {
  const abs = Math.abs(n);
  const isWhole = Math.abs(abs - Math.round(abs)) < 0.005;
  const digits = cents === 'always' ? 2 : cents === 'never' ? 0 : isWhole ? 0 : 2;
  const body = abs.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${n < 0 ? '-' : ''}$${body}`;
}

export function hoursLabel(h: number): string {
  if (h <= 0) return '0 hr';
  if (h < 1) return `${trim(h)} hr`;
  return `${trim(h)} hr`;
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parts(iso: string): { y: number; m: number; d: number } {
  const [y = 1970, m = 1, d = 1] = iso.slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

/** "Mar 2025" */
export function monthYear(iso: string): string {
  const { y, m } = parts(iso);
  return `${MONTHS[m - 1] ?? '???'} ${y}`;
}

/** "Mar 9, 2026" */
export function fullDate(iso: string): string {
  const { y, m, d } = parts(iso);
  return `${MONTHS[m - 1] ?? '???'} ${d}, ${y}`;
}

/** "Sep 2025 – Oct 2026" */
export function rangeLabel(start: string, end: string): string {
  return `${monthYear(start)} – ${monthYear(end)}`;
}

/** Number of calendar months touched by the range, inclusive. */
export function monthsSpan(start: string, end: string): number {
  const a = parts(start);
  const b = parts(end);
  return Math.max(1, (b.y - a.y) * 12 + (b.m - a.m) + 1);
}

/** "2026-11" -> "November 2026" */
export function longMonthYear(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return ym;
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

export const PERIODS_PER_YEAR: Record<Cadence, number> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
};

const CADENCE_SHORT: Record<Cadence, string> = {
  weekly: '/wk',
  biweekly: ' every 2 wks',
  monthly: '/mo',
  quarterly: '/qtr',
  semiannual: ' every 6 mo',
  annual: '/yr',
};

const CADENCE_WORD: Record<Cadence, string> = {
  weekly: 'weekly',
  biweekly: 'every two weeks',
  monthly: 'monthly',
  quarterly: 'quarterly',
  semiannual: 'every six months',
  annual: 'yearly',
};

/** "$17.99/mo" */
export function perCadence(amount: number, cadence: Cadence): string {
  return `${money(amount, 'always')}${CADENCE_SHORT[cadence]}`;
}

export function cadenceWord(cadence: Cadence): string {
  return CADENCE_WORD[cadence];
}

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'item'
  );
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
