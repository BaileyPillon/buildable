import type { Verdict } from '../types';
import { VERDICT_LABEL } from './verdicts';

/** Tinted pill with the verdict word, so color is never the only signal. */
export function VerdictPill({ verdict, className = '' }: { verdict: Verdict; className?: string }) {
  return (
    <span className={`pill ${className}`.trim()} data-verdict={verdict}>
      {VERDICT_LABEL[verdict]}
    </span>
  );
}
