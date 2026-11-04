// Persistence for the user's Context, and nothing else. Only the three preference fields are
// stored. Per-subscription choices (unused, verdictOverrides, merchantOverrides) are keyed by
// series, which are derived from the statement, so they live in memory only.
import type { Context, Device } from '../types';
import { DEFAULT_CONTEXT } from './data';
import { DEVICES } from './verdicts';

const KEY = 'buildable:context:v1';

type Stored = Pick<Context, 'claudePlan' | 'devices' | 'hourlyValue'>;

export function freshContext(): Context {
  return {
    ...DEFAULT_CONTEXT,
    devices: [...DEFAULT_CONTEXT.devices],
    unused: [],
    verdictOverrides: {},
    merchantOverrides: {},
  };
}

export function loadContext(): Context {
  const base = freshContext();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    const known = new Set<string>(DEVICES.map((d) => d.id));
    if (parsed.claudePlan === 'none' || parsed.claudePlan === 'pro' || parsed.claudePlan === 'max') {
      base.claudePlan = parsed.claudePlan;
    }
    if (Array.isArray(parsed.devices)) {
      base.devices = parsed.devices.filter((d): d is Device => typeof d === 'string' && known.has(d));
    }
    if (typeof parsed.hourlyValue === 'number' && Number.isFinite(parsed.hourlyValue) && parsed.hourlyValue >= 0) {
      base.hourlyValue = Math.min(parsed.hourlyValue, 10_000);
    }
  } catch {
    // storage blocked or corrupt: fall back to defaults
  }
  return base;
}

export function saveContext(ctx: Context): void {
  try {
    const stored: Stored = {
      claudePlan: ctx.claudePlan,
      devices: ctx.devices,
      hourlyValue: ctx.hourlyValue,
    };
    window.localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // private mode or quota: the page still works, it just forgets
  }
}

/** Carry the preferences into a new statement; drop everything keyed by the old one. */
export function resetPerStatement(ctx: Context): Context {
  return { ...ctx, unused: [], verdictOverrides: {}, merchantOverrides: {} };
}
