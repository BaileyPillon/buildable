// THE seam between the UI and the data layer. Nothing else in src/ui imports from ../engine or ../kb;
// everything goes through this file.
//
// The real engine (src/engine) and the merged knowledge base (src/kb/merchants.json, built from
// src/kb/categories by `npm run merge-kb`). The KB is ~700 KB of JSON, so it loads as its own chunk: the
// landing page paints first and App fetches the KB right after mount.
import type { Merchant } from '../types';
import proofsJson from '../kb/proofs.json';

export { parseFiles, findRecurring, assess, statementRange, normalizeDescriptor, DEFAULT_CONTEXT } from '../engine';

/** One proof app: a REBUILD prompt that Claude actually ran, and an independent tester's score. */
export type ProofStatus = 'works' | 'partial' | 'missing';
export type ProofItem = { item: string; status: ProofStatus; note: string };
export type Proof = {
  merchantId: string;
  merchantName: string;
  appName: string;
  /** e.g. "Claude Sonnet 5.5 (agent, one session)" */
  model: string;
  builtAt: string;
  score: { works: number; partial: number; missing: number };
  summary: string;
  checklist: ProofItem[];
  bugs: string[];
  /** Same-origin path of the built app, e.g. "/rebuilt/huckleberry/" */
  path: string;
};

/** Small (about 30 KB), so it ships with the main chunk: the landing page lists it without waiting. */
export const PROOFS: Proof[] = proofsJson as unknown as Proof[];

let kbPromise: Promise<Merchant[]> | null = null;

export function loadKb(): Promise<Merchant[]> {
  if (!kbPromise) {
    kbPromise = import('../kb').then((m) => m.MERCHANTS);
    // a failed chunk load must not stick: the next call retries
    kbPromise.catch(() => {
      kbPromise = null;
    });
  }
  return kbPromise;
}
