// "We ran this prompt": the evidence that a REBUILD prompt produces a working app. Shown on the REBUILD card of the
// four services whose prompt was actually run. It reports partial and missing items as plainly as working ones.
import type { Proof, ProofItem } from './data';
import { buildLogUrl } from './config';
import { ArrowUpRightIcon, CheckIcon, WarningIcon } from './icons';
import { STATUS_LABEL, modelName, scoreDetail, scoreHeadline, tally } from './proofs';

function StatusMark({ status }: { status: ProofItem['status'] }) {
  // the word is always there; the icon and colour only back it up
  return (
    <span className={`proof__status proof__status--${status}`}>
      {status === 'works' ? <CheckIcon size={13} /> : <WarningIcon size={13} />}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ProofPanel({ proof }: { proof: Proof }) {
  const t = tally(proof.checklist);
  const pct = (n: number): string => `${t.total ? (n / t.total) * 100 : 0}%`;

  return (
    <section className="proof" aria-label={`We ran this prompt: ${proof.appName}`}>
      <p className="proof__kicker">We ran this prompt</p>
      <p className="proof__line">
        Built by {modelName(proof)} from this exact prompt in one session. The result is{' '}
        <strong>{proof.appName}</strong>, scored by an independent tester.
      </p>

      <p className="proof__score">
        <strong>{scoreHeadline(proof)}</strong>
        <span>{scoreDetail(proof)}</span>
      </p>
      <div className="proof__bar" aria-hidden="true">
        <i className="proof__seg proof__seg--works" style={{ width: pct(t.works) }} />
        <i className="proof__seg proof__seg--partial" style={{ width: pct(t.partial) }} />
        <i className="proof__seg proof__seg--missing" style={{ width: pct(t.missing) }} />
      </div>

      <p className="proof__summary">{proof.summary}</p>

      <details className="proof__details">
        <summary>See the checklist ({t.total} requirements)</summary>
        <ul className="proof__list">
          {proof.checklist.map((c) => (
            <li key={c.item} className="proof__item">
              <StatusMark status={c.status} />
              <p className="proof__item-name">{c.item}</p>
              <p className="proof__item-note">{c.note}</p>
            </li>
          ))}
        </ul>
      </details>

      {proof.bugs.length > 0 && (
        <details className="proof__details">
          <summary>See the known problems ({proof.bugs.length})</summary>
          <ul className="proof__bugs">
            {proof.bugs.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="proof__links">
        <a className="btn btn--secondary btn--small" href={proof.path}>
          Open the app <ArrowUpRightIcon size={14} />
        </a>
        <a
          className="textlink"
          href={buildLogUrl(proof.merchantId)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Build log on GitHub <ArrowUpRightIcon size={14} />
        </a>
      </div>
    </section>
  );
}
