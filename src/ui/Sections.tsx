import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Assessment, Context, Merchant } from '../types';
import { AssessmentCard, UnrecognizedRow } from './AssessmentCard';
import type { CardActions } from './AssessmentCard';
import type { Group } from './derive';
import { askClaudePrompt } from './exporters';
import { fullDate, hoursLabel, money, perCadence, plural } from './format';
import { ArrowUpRightIcon } from './icons';
import { CopyButton } from './PromptBlock';
import { VerdictPill } from './VerdictPill';
import { VERDICT_DEFINITION } from './verdicts';

function Section({
  id,
  num,
  title,
  meta,
  note,
  children,
}: {
  id: string;
  num: number;
  title: string;
  meta?: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section" aria-labelledby={id}>
      <header className="section__head">
        <p className="kicker" aria-hidden="true">
          {String(num).padStart(2, '0')}
        </p>
        <div className="section__titles">
          <h2 id={id} className="section__title">
            {title}
          </h2>
          {meta && <p className="section__meta">{meta}</p>}
        </div>
        {note && <p className="section__note">{note}</p>}
      </header>
      {children}
    </section>
  );
}

type Shared = { ctx: Context; kb: Merchant[]; actions: CardActions };

export function BuildQueue({
  items,
  num,
  savings,
  hours,
  ...shared
}: Shared & { items: Assessment[]; num: number; savings: number; hours: number }) {
  // Savings and hours leave blocked items out (they need a device the user has not ticked), so say how many there are.
  const blocked = items.filter((i) => i.blocked).length;
  return (
    <Section
      id="sec-queue"
      num={num}
      title="Build queue"
      meta={`${plural(items.length, 'item')}${blocked > 0 ? ` (${blocked} blocked)` : ''} · saves ${money(savings, 'never')}/yr · about ${hoursLabel(Math.round(hours * 10) / 10)}`}
      note={
        blocked > 0
          ? 'Ranked by dollars saved per hour of building. Blocked items are not in the savings or the hours. Copy a prompt into Claude Code and go.'
          : 'Ranked by dollars saved per hour of building. Copy a prompt into Claude Code and go.'
      }
    >
      {items.length === 0 ? (
        <p className="empty">Nothing here replaces a subscription on this list yet. Try adding a device above.</p>
      ) : (
        <ol className="stack" aria-label="Build queue">
          {items.map((it, i) => (
            <li key={it.series.key}>
              <AssessmentCard item={it} rank={i + 1} {...shared} />
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function GroupHeading({ verdict, count, text }: { verdict: Assessment['verdict']; count: number; text: string }) {
  return (
    <div className="group__head">
      <VerdictPill verdict={verdict} />
      <span className="group__count">{plural(count, 'subscription')}</span>
      <span className="group__text">{text}</span>
    </div>
  );
}

export function EverythingElse({
  groups,
  needsPick,
  num,
  ...shared
}: Shared & { groups: Group[]; needsPick: Assessment[]; num: number }) {
  if (groups.length === 0 && needsPick.length === 0) return null;
  return (
    <Section id="sec-else" num={num} title="Everything else" note="The rest, sorted by what to do about each one.">
      {needsPick.length > 0 && (
        <div className="group">
          <div className="group__head">
            <span className="pill pill--plain">PICK THE APP</span>
            <span className="group__count">{plural(needsPick.length, 'charge')}</span>
            <span className="group__text">Store-billed. Tell us which app each one is.</span>
          </div>
          <ul className="stack">
            {needsPick.map((it) => (
              <li key={it.series.key}>
                <AssessmentCard item={it} {...shared} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.verdict} className="group">
          <GroupHeading
            verdict={g.verdict}
            count={g.items.length}
            text={
              g.savingsYear > 0
                ? `Saves ${money(g.savingsYear, 'never')}/yr. ${VERDICT_DEFINITION[g.verdict]}`
                : VERDICT_DEFINITION[g.verdict]
            }
          />
          <ul className="stack">
            {g.items.map((it) => (
              <li key={it.series.key}>
                <AssessmentCard item={it} {...shared} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Section>
  );
}

export function Unrecognized({
  items,
  num,
  ctx,
  actions,
}: {
  items: Assessment[];
  num: number;
  ctx: Context;
  actions: CardActions;
}) {
  const generated = useMemo(() => askClaudePrompt(items), [items]);
  // The user can edit the prompt before copying it. An edit belongs to the prompt it was made on: when the list of
  // charges changes, the generated text wins again.
  const [edit, setEdit] = useState<{ base: string; text: string } | null>(null);
  const textId = useId();
  if (items.length === 0) return null;
  const edited = edit !== null && edit.base === generated;
  const text = edited ? edit.text : generated;
  return (
    <Section
      id="sec-unrec"
      num={num}
      title="Unrecognized"
      meta={plural(items.length, 'charge')}
      note="These repeat, but they are not in our catalog yet."
    >
      <ul className="urows">
        {items.map((it) => (
          <UnrecognizedRow key={it.series.key} item={it} ctx={ctx} actions={actions} />
        ))}
      </ul>
      <div className="ask">
        <div className="ask__actions">
          <CopyButton
            text={text}
            small={false}
            label="Ask Claude about these"
            doneLabel="Copied. Paste it into Claude"
            className="btn--primary"
          />
          <a className="textlink" href="https://claude.ai/new" target="_blank" rel="noopener noreferrer">
            Open Claude <ArrowUpRightIcon size={14} />
          </a>
        </div>
        <p className="ask__note">
          Copies a prompt with shortened merchant descriptors, amounts and how often they bill. Phone numbers, card
          digits and reference ids are taken out, but a name can slip through, so read it below and delete anything
          personal before you paste. Nothing is sent from this page.
        </p>
        <details className="ask__preview" open>
          <summary>Read and edit what gets copied</summary>
          <label className="sr-only" htmlFor={textId}>
            Prompt that will be copied. You can edit it.
          </label>
          <textarea
            id={textId}
            className="ask__text"
            value={text}
            spellCheck={false}
            rows={Math.min(18, text.split('\n').length + 1)}
            onChange={(e) => setEdit({ base: generated, text: e.target.value })}
          />
          {edited && (
            <button type="button" className="linklike ask__reset" onClick={() => setEdit(null)}>
              Undo my edits
            </button>
          )}
        </details>
      </div>
    </Section>
  );
}

export function AlreadyGone({ items, num }: { items: Assessment[]; num: number }) {
  if (items.length === 0) return null;
  return (
    <Section
      id="sec-gone"
      num={num}
      title="Already gone"
      meta={plural(items.length, 'service')}
      note="Stopped billing during this statement. Not counted in any total."
    >
      <ul className="gone">
        {items.map((it) => (
          <li key={it.series.key} className="gone__row">
            <span className="gone__name">{it.series.displayName}</span>
            <span className="gone__meta">
              last charged {fullDate(it.series.lastSeen)} · was {perCadence(it.series.currentAmount, it.series.cadence)}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
