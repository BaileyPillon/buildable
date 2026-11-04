// Pure helpers for the "We ran this prompt" evidence. No React in here.
import { PROOFS } from './data';
import type { Proof, ProofItem } from './data';

export function proofFor(merchantId: string | undefined | null): Proof | null {
  if (!merchantId) return null;
  return PROOFS.find((p) => p.merchantId === merchantId) ?? null;
}

/** Counts come from the checklist itself, so the headline can never disagree with the list under it. */
export function tally(items: ProofItem[]): { works: number; partial: number; missing: number; total: number } {
  const t = { works: 0, partial: 0, missing: 0, total: items.length };
  for (const i of items) t[i.status]++;
  return t;
}

/** "11 of 12 requirements work" */
export function scoreHeadline(p: Proof): string {
  const t = tally(p.checklist);
  return `${t.works} of ${t.total} requirements work`;
}

/** "1 partly works, 0 missing". Partial results are counted apart from the headline, never rounded up into it. */
export function scoreDetail(p: Proof): string {
  const t = tally(p.checklist);
  return `${t.partial} partly ${t.partial === 1 ? 'works' : 'work'}, ${t.missing} missing`;
}

/** "Claude Sonnet 5.5 (agent, one session)" -> "Claude Sonnet 5.5" */
export function modelName(p: Proof): string {
  return p.model.replace(/\s*\(.*\)\s*$/, '').trim() || p.model;
}

export const STATUS_LABEL: Record<ProofItem['status'], string> = {
  works: 'Works',
  partial: 'Partly works',
  missing: 'Missing',
};
