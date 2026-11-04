// The expanded half of a card: the plan that matches the verdict, plus alternatives and sources.
import type { ReactNode } from 'react';
import type { Assessment, Context } from '../types';
import { hostOf, safeUrl, sourceLinks } from './config';
import { buildKit, buildKitFilename } from './exporters';
import { longMonthYear, money } from './format';
import { CheckIcon } from './icons';
import { PromptBlock } from './PromptBlock';
import { ProofPanel } from './ProofPanel';
import { proofFor } from './proofs';
import { DEVICE_LABEL } from './verdicts';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ExternalLink({ href, children }: { href: string | undefined; children: ReactNode }) {
  const safe = safeUrl(href);
  if (!safe) return <>{children}</>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function PlanDetail({ item, ctx }: { item: Assessment; ctx: Context }) {
  const m = item.merchant;
  if (!m) return null;
  const p = m.plans;
  const kit = buildKit(item, ctx);
  const kitProp = kit ? { filename: buildKitFilename(item), content: kit } : null;
  const proof = item.verdict === 'rebuild' ? proofFor(m.id) : null;

  return (
    <div className="plan">
      {item.verdict === 'absorb' && p.absorb && (
        <>
          <dl className="facts">
            <Fact label="What Claude does">{p.absorb.claudeDoes}</Fact>
            <Fact label="How">{p.absorb.howTo}</Fact>
            <Fact label="Limits">{p.absorb.limits}</Fact>
          </dl>
          <PromptBlock label="Prompt for Claude" text={p.absorb.prompt} kit={kitProp} />
        </>
      )}

      {item.verdict === 'rebuild' && p.rebuild && (
        <>
          <dl className="facts">
            <Fact label="What you build">{p.rebuild.whatYouBuild}</Fact>
            <Fact label="Runs on">{p.rebuild.runsOn}</Fact>
            <Fact label="Time and cost">
              About {p.rebuild.hours} hours to build.{' '}
              {p.rebuild.ongoingCostYear > 0
                ? `Runs for ${money(p.rebuild.ongoingCostYear)} a year.`
                : 'Runs for free.'}
            </Fact>
            <Fact label="You lose">{p.rebuild.youLose}</Fact>
          </dl>
          <PromptBlock label="Prompt for Claude Code" text={p.rebuild.prompt} kit={kitProp} />
          {proof && <ProofPanel proof={proof} />}
        </>
      )}

      {item.verdict === 'selfhost' && p.selfhost && (
        <>
          <dl className="facts">
            <Fact label="Software">
              <ul className="chips">
                {p.selfhost.software.map((s) => (
                  <li key={s} className="chip chip--static">
                    {s}
                  </li>
                ))}
              </ul>
            </Fact>
            <Fact label="Runs on">
              <ul className="chips">
                {p.selfhost.hardware.map((h) => {
                  const have = ctx.devices.includes(h);
                  return (
                    <li key={h} className={`chip chip--static${have ? ' is-have' : ''}`}>
                      {have && <CheckIcon size={13} />}
                      {DEVICE_LABEL[h]}
                      {have && <span className="sr-only"> (you have this)</span>}
                    </li>
                  );
                })}
              </ul>
            </Fact>
            <Fact label="Time and cost">
              About {p.selfhost.hours} hours to set up. Power is roughly {money(p.selfhost.powerCostYear)} a year.
            </Fact>
            <Fact label="You lose">{p.selfhost.youLose}</Fact>
          </dl>
          <PromptBlock label="Prompt for Claude Code" text={p.selfhost.prompt} kit={kitProp} />
        </>
      )}

      {item.verdict === 'haggle' && p.haggle && (
        <>
          <dl className="facts">
            <Fact label="Your leverage">{p.haggle.leverage}</Fact>
            <Fact label="What to expect">
              {p.haggle.expectedDiscountPct[0]} to {p.haggle.expectedDiscountPct[1]} percent off, so roughly{' '}
              {money((item.series.annualCost * p.haggle.expectedDiscountPct[0]) / 100, 'never')} to{' '}
              {money((item.series.annualCost * p.haggle.expectedDiscountPct[1]) / 100, 'never')} a year.
            </Fact>
            <Fact label="Best time">{p.haggle.bestTime}</Fact>
          </dl>
          <PromptBlock label="Script" text={p.haggle.script} />
        </>
      )}

      {item.verdict === 'rotate' && p.rotate && (
        <dl className="facts">
          <Fact label="The pattern">{p.rotate.pattern}</Fact>
          <Fact label="Months off">
            About {p.rotate.monthsOffPerYear} months a year, so you pay for {12 - p.rotate.monthsOffPerYear}.
          </Fact>
        </dl>
      )}

      {item.verdict === 'cancel' && (
        <dl className="facts">
          <Fact label="Steps">{p.cancel.howTo}</Fact>
          {safeUrl(p.cancel.url) && (
            <Fact label="Where">
              <ExternalLink href={p.cancel.url}>{hostOf(p.cancel.url ?? '')}</ExternalLink>
            </Fact>
          )}
          {p.cancel.gotchas && <Fact label="Watch out">{p.cancel.gotchas}</Fact>}
        </dl>
      )}

      {item.verdict === 'keep' && (
        <dl className="facts">
          {/* the card already says this in its reason line; repeat it only when the two differ */}
          {m.why !== item.reason && <Fact label="Why keep it">{m.why}</Fact>}
          <Fact label="If you change your mind">{p.cancel.howTo}</Fact>
        </dl>
      )}

      {m.alternatives && m.alternatives.length > 0 && (
        <div className="plan__block">
          <h4 className="plan__h">Free or cheaper swaps</h4>
          <ul className="plan__list">
            {m.alternatives.map((a) => (
              <li key={a.name}>
                <ExternalLink href={a.url}>{a.name}</ExternalLink>
                <span className="plan__note">{a.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {m.sources.length > 0 && (
        <p className="plan__sources">
          Sources:{' '}
          {sourceLinks(m.sources).map((s, i) => (
            <span key={s.url}>
              {i > 0 && ', '}
              <ExternalLink href={s.url}>{s.label}</ExternalLink>
            </span>
          ))}
          . Prices checked {longMonthYear(m.pricesCheckedAt)}.
        </p>
      )}
    </div>
  );
}
