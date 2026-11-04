import { useId } from 'react';
import type { Assessment, Context, Merchant, Verdict } from '../types';
import { useCardUi } from './cardUi';
import { cardName, priceHike } from './derive';
import { verdictOptions } from './exporters';
import { cadenceWord, hoursLabel, money, monthYear, perCadence } from './format';
import { ChevronIcon, WarningIcon } from './icons';
import { PlanDetail } from './PlanDetail';
import { VerdictPill } from './VerdictPill';
import { VERDICT_LABEL, isBuild } from './verdicts';

/** What the user had chosen for one series before a change, so "Undo" can put it back. */
export type CardSnapshot = { unused: boolean; verdict: Verdict | null; merchant: string | null };

export type CardActions = {
  setVerdict: (key: string, verdict: Verdict | null) => void;
  setUnused: (key: string, on: boolean) => void;
  pickMerchant: (key: string, merchantId: string | null) => void;
  restore: (key: string, snapshot: CardSnapshot) => void;
};

export function PriceHikeBadge({ item }: { item: Assessment }) {
  const hike = priceHike(item);
  if (!hike) return null;
  return (
    <span className="badge badge--hike" title="The price went up while you were not looking">
      <WarningIcon size={13} />
      +{money(hike.amount, 'always')} since {monthYear(hike.since)}
    </span>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>
        {value}
        {sub && <span className="stat__sub">{sub}</span>}
      </dd>
    </div>
  );
}

function hintFor(m: Merchant, amount: number): string | null {
  return m.match.priceHints?.find((h) => Math.abs(h.amount - amount) <= 0.02)?.plan ?? null;
}

/** Store-billed charge: which app is it? Stays on the card after a pick so the choice can be seen and changed. */
function CandidatePicker({
  item,
  kb,
  actions,
}: {
  item: Assessment;
  kb: Merchant[];
  actions: CardActions;
}) {
  const id = useId();
  const candidates = (item.series.candidates ?? [])
    .map((cid) => kb.find((m) => m.id === cid))
    .filter((m): m is Merchant => Boolean(m));
  if (candidates.length === 0) return null;
  const chosen = item.merchant?.id ?? null;
  const store = /^Google Play/.test(item.series.displayName) ? 'Google Play' : 'the App Store';
  return (
    <div className="picker" role="group" aria-labelledby={id}>
      <p className="picker__label" id={id}>
        {item.merchant
          ? `Billed through ${store}. Not ${item.merchant.name}? Pick another, or choose it again to clear it.`
          : 'Billed through a store, so the statement does not say which app. Which one is it?'}
      </p>
      <ul className="chips">
        {candidates.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              className="chip"
              data-focus-id={`pick:${m.id}`}
              aria-pressed={chosen === m.id}
              onClick={() => actions.pickMerchant(item.series.key, chosen === m.id ? null : m.id)}
            >
              {m.name}
              {hintFor(m, item.series.currentAmount) && (
                <span className="chip__sub">{hintFor(m, item.series.currentAmount)}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AssessmentCard({
  item,
  ctx,
  kb,
  actions,
  rank,
}: {
  item: Assessment;
  ctx: Context;
  kb: Merchant[];
  actions: CardActions;
  rank?: number;
}) {
  const ui = useCardUi();
  const panelId = useId();
  const s = item.series;
  const m = item.merchant;
  const open = ui.isOpen(s.key);
  const unused = ctx.unused.includes(s.key);
  const options = verdictOptions(item);
  const build = isBuild(item.verdict);
  const hourly = ctx.hourlyValue;
  const roi = item.roiPerHour;
  const hasPlan = Boolean(m);
  // A store-billed charge nobody has identified yet. Its verdict is a placeholder, so it must not wear one.
  const unidentified = !m && Boolean(s.candidates && s.candidates.length > 0);
  const showPill = !unidentified || unused;
  const name = cardName(item);
  const planLabel = open ? 'Hide the plan' : item.verdict === 'keep' ? 'How to cancel later' : 'Show the plan';

  return (
    <article
      className={`card${item.blocked ? ' is-blocked' : ''}${open ? ' is-open' : ''}`}
      data-verdict={item.verdict}
      data-card-key={s.key}
      aria-label={`${name}: ${unidentified && !unused ? 'not identified yet' : VERDICT_LABEL[item.verdict]}`}
    >
      <div className="card__main">
        {rank !== undefined && (
          <span className="card__rank" aria-hidden="true">
            {String(rank).padStart(2, '0')}
          </span>
        )}
        <div className="card__title">
          <div className="card__tags">
            {showPill ? <VerdictPill verdict={item.verdict} /> : <span className="pill pill--plain">UNIDENTIFIED</span>}
            {unused && <span className="badge">You barely use it</span>}
            <PriceHikeBadge item={item} />
          </div>
          <h3 className="card__name" tabIndex={-1} data-focus-id="title">
            {name}
          </h3>
          <p className="card__meta">
            {s.cadence === 'annual' ? (
              <span>{money(s.annualCost, 'always')}/yr, billed once a year</span>
            ) : (
              <>
                <span>{perCadence(s.currentAmount, s.cadence)}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {money(s.annualCost, 'always')}/yr
                  <span className="sr-only">, billed {cadenceWord(s.cadence)}</span>
                </span>
              </>
            )}
          </p>
        </div>

        {item.verdict !== 'keep' && (
          <dl className="card__stats">
            <Stat label="Saves" value={`${money(item.savingsYear, 'never')}/yr`} />
            <Stat label="Effort" value={hoursLabel(item.hours)} />
            {roi !== null && item.hours > 0 && build && (
              <Stat
                label="Per hour"
                value={`${money(roi, 'never')}/hr`}
                sub={roi >= hourly ? 'above your rate' : 'below your rate'}
              />
            )}
          </dl>
        )}
      </div>

      {(m || !s.candidates || s.candidates.length === 0) && <p className="card__reason">{item.reason}</p>}

      {item.blocked && (
        <p className="notice" role="note">
          <WarningIcon size={15} />
          <span>
            <strong>Blocked.</strong> {item.blocked}. Switch on a device under &ldquo;What&rsquo;s in your
            drawer?&rdquo; to count the savings.
          </span>
        </p>
      )}

      {s.candidates && s.candidates.length > 0 && <CandidatePicker item={item} kb={kb} actions={actions} />}

      {(hasPlan || unidentified) && (
        <div className="card__foot">
          {hasPlan && options.length > 1 && (
            <div className="card__options" role="group" aria-label="Other ways to handle it">
              <span className="card__options-label">Handle it by</span>
              <ul className="chips">
                {options.map((v) => (
                  <li key={v}>
                    <button
                      type="button"
                      className="chip chip--verdict"
                      data-verdict={v}
                      data-focus-id={`verdict:${v}`}
                      aria-pressed={!unused && item.verdict === v}
                      onClick={() => {
                        if (unused) actions.setUnused(s.key, false);
                        actions.setVerdict(s.key, v === m?.verdict ? null : v);
                      }}
                    >
                      {VERDICT_LABEL[v]}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label className="check check--inline">
            <input
              type="checkbox"
              data-focus-id="unused"
              checked={unused}
              onChange={(e) => actions.setUnused(s.key, e.target.checked)}
            />
            <span>I barely use this</span>
          </label>
          {hasPlan && (
            <button
              type="button"
              className="disclose"
              data-focus-id="disclose"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => ui.setOpen(s.key, !open)}
            >
              {planLabel}
              <ChevronIcon size={16} />
            </button>
          )}
        </div>
      )}

      {hasPlan && (
        <div id={panelId} className="card__panel" hidden={!open}>
          {open && <PlanDetail item={item} ctx={ctx} />}
        </div>
      )}
    </article>
  );
}

/** Compact row for charges the catalog does not know. */
export function UnrecognizedRow({
  item,
  ctx,
  actions,
}: {
  item: Assessment;
  ctx: Context;
  actions: CardActions;
}) {
  const s = item.series;
  const unused = ctx.unused.includes(s.key);
  return (
    <li className="urow" data-card-key={s.key}>
      <div className="urow__main">
        <p className="urow__desc">{s.descriptors[0] ?? s.displayName}</p>
        <p className="urow__meta">
          {perCadence(s.currentAmount, s.cadence)} · {money(s.annualCost, 'always')}/yr · seen {s.charges.length}{' '}
          {s.charges.length === 1 ? 'time' : 'times'}
        </p>
      </div>
      {unused && <VerdictPill verdict="cancel" />}
      <label className="check check--inline">
        <input
          type="checkbox"
          data-focus-id="unused"
          checked={unused}
          onChange={(e) => actions.setUnused(s.key, e.target.checked)}
        />
        <span>I barely use this</span>
      </label>
    </li>
  );
}
