import { useMemo, useState } from 'react';
import { BankHelpDialog } from './BankHelpDialog';
import { PROOFS } from './data';
import { Dropzone } from './Dropzone';
import type { Status } from './Dropzone';
import { ArrowUpRightIcon, LockIcon } from './icons';
import { modelName, scoreDetail, scoreHeadline } from './proofs';
import { Receipt } from './Receipt';
import { sampleReceiptModel } from './receiptModel';
import { VerdictPill } from './VerdictPill';
import { VERDICTS, VERDICT_DEFINITION } from './verdicts';

const STEPS: { title: string; body: string }[] = [
  {
    title: 'Drop a statement',
    body: 'CSV, OFX or QFX from any bank or card. It is read inside this tab. Nothing is uploaded, and the page is locked down so the browser will not let it send your data to a server.',
  },
  {
    title: 'See every recurring charge',
    body: 'Weekly to annual charges are found by pattern, matched against a catalog of common services, and each gets one of seven verdicts.',
  },
  {
    title: 'Build the queue',
    body: 'Replacements are ranked by dollars saved per hour of building. Each comes with a prompt you paste into Claude Code.',
  },
];

export function Landing({
  status,
  onFiles,
  onSample,
  pageDragging = false,
}: {
  status: Status;
  onFiles: (files: File[]) => void;
  onSample: () => void;
  /** A file is being dragged over the page: the dropzone lights up as the target. */
  pageDragging?: boolean;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const sample = useMemo(() => sampleReceiptModel(), []);

  return (
    <div id="top">
      <section className="hero wrap" aria-labelledby="hero-title">
        <div className="hero__copy">
          <p className="eyebrow">Subscription audit · runs in your browser</p>
          <h1 id="hero-title" tabIndex={-1} className="hero__title">
            You're paying <em>rent</em> on software Claude could build you.
          </h1>
          <p className="hero__sub">
            Drop a bank or card statement. Buildable finds every subscription and tells you which to keep,
            haggle, rotate, or replace with something Claude builds you for free.
          </p>

          <Dropzone status={status} onFiles={onFiles} onSample={onSample} pageDragging={pageDragging} />

          <div className="privacy">
            <span className="privacy__icon">
              <LockIcon size={18} />
            </span>
            <div>
              <p className="privacy__text">
                Your statement never leaves this tab. This page&rsquo;s Content-Security-Policy blocks it from
                sending your data to any server through the browser&rsquo;s normal channels, and the page makes no
                requests except to load its own files. View source or watch the network tab to check.
              </p>
              <button type="button" className="linklike" onClick={() => setHelpOpen(true)}>
                How to export a CSV from your bank
              </button>
            </div>
          </div>
        </div>

        <div className="hero__art" aria-hidden="true">
          <div className="hero__tilt">
            <Receipt model={sample} decorative />
          </div>
        </div>
      </section>

      <section id="how" className="how wrap" aria-labelledby="how-title">
        <div className="how__head">
          <p className="kicker">The method</p>
          <h2 id="how-title" className="display">
            How it works
          </h2>
        </div>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="step">
              <span className="step__num" aria-hidden="true">
                {i + 1}
              </span>
              <h3 className="step__title">{s.title}</h3>
              <p className="step__body">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="verdicts wrap" aria-labelledby="verdicts-title">
        <div className="verdicts__head">
          <p className="kicker">The verdicts</p>
          <h2 id="verdicts-title" className="display">
            Seven verdicts
          </h2>
          <p className="verdicts__lede">
            Three only exist now that Claude does: absorb it, rebuild it, or run the open-source version on
            an old device.
          </p>
        </div>
        <ul className="verdict-list">
          {VERDICTS.map((v) => (
            <li key={v} className="verdict-list__item">
              <VerdictPill verdict={v} />
              <p>{VERDICT_DEFINITION[v]}</p>
            </li>
          ))}
        </ul>
      </section>

      {PROOFS.length > 0 && (
        <section id="proof" className="proof-section wrap" aria-labelledby="proof-title">
          <div className="proof-section__head">
            <p className="kicker">The evidence</p>
            <h2 id="proof-title" className="display">
              Proof
            </h2>
            <p className="proof-section__lede">
              We gave {PROOFS.length === 4 ? 'four' : PROOFS.length} REBUILD prompts, word for word, to{' '}
              {modelName(PROOFS[0]!)} and asked for one working app each, in one session. An independent tester then
              checked every requirement. These are the scores, including what only partly worked.
            </p>
          </div>
          <ul className="proof-list">
            {PROOFS.map((p) => (
              <li key={p.merchantId} className="proof-list__item">
                <div className="proof-list__who">
                  <h3 className="proof-list__name">{p.appName}</h3>
                  <p className="proof-list__replaces">Replaces {p.merchantName}</p>
                </div>
                <p className="proof-list__score">
                  <strong>{scoreHeadline(p)}</strong>
                  <span>{scoreDetail(p)}</span>
                </p>
                <a className="textlink" href={p.path}>
                  Open the app <ArrowUpRightIcon size={14} />
                </a>
              </li>
            ))}
          </ul>
          <p className="proof-section__note">
            Each of these services has a REBUILD card in your results. Open it to see the full checklist, the known
            problems and the build log.
          </p>
        </section>
      )}

      <BankHelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
