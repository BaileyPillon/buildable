import { useId, useState } from 'react';
import type { Context, Device } from '../types';
import { money } from './format';
import { CheckIcon } from './icons';
import { DEVICES } from './verdicts';

export type ContextActions = {
  setClaudePlan: (plan: Context['claudePlan']) => void;
  toggleDevice: (device: Device) => void;
  setHourly: (value: number) => void;
};

const PLANS: { id: Context['claudePlan']; label: string }[] = [
  { id: 'none', label: 'No' },
  { id: 'pro', label: 'Pro' },
  { id: 'max', label: 'Max' },
];

export function ContextControls({
  ctx,
  actions,
  claudeCostYear,
}: {
  ctx: Context;
  actions: ContextActions;
  claudeCostYear: number;
}) {
  const uid = useId();
  const [hourlyText, setHourlyText] = useState(String(ctx.hourlyValue));

  return (
    <section className="context" aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`} className="kicker">
        Tune it to your life
      </h2>

      <div className="context__row">
        <fieldset className="field">
          <legend className="field__label">Do you pay for Claude?</legend>
          <div className="seg">
            {PLANS.map((p) => (
              <label key={p.id} className="seg__opt">
                <input
                  type="radio"
                  name={`${uid}-plan`}
                  value={p.id}
                  checked={ctx.claudePlan === p.id}
                  onChange={() => actions.setClaudePlan(p.id)}
                />
                <span>{p.label}</span>
              </label>
            ))}
          </div>
          {ctx.claudePlan === 'none' && claudeCostYear > 0 && (
            <p className="field__hint">
              ABSORB needs a Claude plan. {money(claudeCostYear, 'never')} a year for Pro is netted out of your
              savings.
            </p>
          )}
        </fieldset>

        <div className="field">
          <label className="field__label" htmlFor={`${uid}-hourly`}>
            Your time is worth
          </label>
          <div className="money-input">
            <span aria-hidden="true">$</span>
            <input
              id={`${uid}-hourly`}
              type="number"
              inputMode="decimal"
              min={0}
              max={10000}
              step={1}
              value={hourlyText}
              onChange={(e) => {
                setHourlyText(e.target.value);
                const n = Number(e.target.value);
                if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= 0) actions.setHourly(Math.min(n, 10000));
              }}
              onBlur={() => setHourlyText(String(ctx.hourlyValue))}
              aria-describedby={`${uid}-hourly-hint`}
            />
            <span aria-hidden="true">/hr</span>
          </div>
          <p className="field__hint" id={`${uid}-hourly-hint`}>
            Builds that pay less than this per hour are marked below your rate.
          </p>
        </div>
      </div>

      <fieldset className="field">
        <legend className="field__label">What&rsquo;s in your drawer?</legend>
        <ul className="chips">
          {DEVICES.map((d) => {
            const on = ctx.devices.includes(d.id);
            return (
              <li key={d.id}>
                <button
                  type="button"
                  className="chip"
                  aria-pressed={on}
                  onClick={() => actions.toggleDevice(d.id)}
                >
                  {on && <CheckIcon size={14} />}
                  {d.label}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="field__hint">Old gear can run the open-source version of a paid app. Switch on what you own.</p>
      </fieldset>
    </section>
  );
}
