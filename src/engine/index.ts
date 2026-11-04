// Public engine API (see SPEC.md "Engine public API"). Pure functions: no DOM, no network.
import type { Context, Txn } from '../types';
import { findRecurring } from './recurring';
import { assess } from './assess';
import { parseFiles } from './parse';

export { parseFiles, findRecurring, assess };
export { buildQueue, netOfTime, blockedMessage, CLAUDE_PRO_MONTHLY } from './assess';
export { normalizeDescriptor, merchantKey } from './normalize';
export { MAX_FILE_CHARS, MAX_TOTAL_CHARS, MAX_ROWS } from './parse';
export type { AssessOptions } from './assess';

export const DEFAULT_CONTEXT: Context = {
  claudePlan: 'pro',
  devices: [],
  unused: [],
  hourlyValue: 25,
  verdictOverrides: {},
  merchantOverrides: {},
};

/** First and last transaction date (YYYY-MM-DD), for the "statement range" line. Empty strings if no rows. */
export function statementRange(txns: Txn[]): { start: string; end: string } {
  let start = '';
  let end = '';
  for (const t of txns) {
    if (!start || t.date < start) start = t.date;
    if (!end || t.date > end) end = t.date;
  }
  return { start, end };
}
