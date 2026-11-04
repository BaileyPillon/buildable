import { useMemo } from 'react';
import { useStore } from '../lib/store';
import { predictNextSleep } from '../lib/predictor';
import { MIN, formatClock, formatDuration, formatAge } from '../lib/time';
import { Icon, useNow } from './ui';

const fmtRange = (min: number, max: number) => `${formatDuration(min * MIN)} to ${formatDuration(max * MIN)}`;

export function Predictor({ onEditWindows }: { onEditWindows: () => void }) {
  const store = useStore();
  const now = useNow(15_000);
  const child = store.child;
  const sleeps = useMemo(() => store.childEvents.filter((e) => e.type === 'sleep'), [store.childEvents]);
  const p = useMemo(
    () => (child ? predictNextSleep({ sleeps, birthdate: child.birthdate, bands: child.wakeBands, now }) : null),
    [sleeps, child, now],
  );
  if (!child || !p) return null;

  const learnedNote = p.learned
    ? `Learned from ${p.learned.n} wake windows in the last 10 days (typical ${formatDuration(p.learned.median * MIN)}), blended ${Math.round(p.weight * 100)}% with the age range.`
    : 'Using the age-based range until there are at least 3 wake windows in the last 10 days.';

  let headline = '';
  let sub = '';
  let chip: { text: string; cls: string } | null = null;
  if (p.status === 'asleep') {
    headline = `Asleep since ${formatClock(p.asleepSince!)}`;
    sub = p.expectedWake ? `Naps usually run about ${formatDuration(p.expectedWake - p.asleepSince!)}, so expect waking around ${formatClock(p.expectedWake)}.` : 'The next window is predicted once they wake.';
    chip = { text: formatDuration(now - p.asleepSince!), cls: 'sleep' };
  } else if (p.status === 'awake') {
    const ws = p.windowStart!;
    const we = p.windowEnd!;
    headline = `${p.bedtime ? 'Bedtime' : 'Next sleep'} window ${formatClock(ws)} to ${formatClock(we)}`;
    sub = `Awake since ${formatClock(p.wakeAt!)} (${formatDuration(now - p.wakeAt!)}).`;
    chip =
      p.timing === 'early'
        ? { text: `in ${formatDuration(ws - now)}`, cls: 'early' }
        : p.timing === 'now'
          ? { text: 'now', cls: 'now' }
          : { text: `${formatDuration(now - we)} over`, cls: 'late' };
  } else {
    headline = 'Log a sleep to see the next window';
    sub = `Age-based wake window for ${formatAge(child.birthdate, now)}: ${fmtRange(p.range.min, p.range.max)}.`;
  }

  // visual: age range (light) and learned/blended range (strong) from wake-up, with a "now" marker
  const showBar = p.status === 'awake';
  const span = Math.max(p.prior.max, p.range.max, p.wakeAt ? (now - p.wakeAt) / MIN : 0) * 1.1;
  const pct = (m: number) => `${Math.min(100, Math.max(0, (m / span) * 100))}%`;

  return (
    <section className="card predictor" aria-label="Nap predictor">
      <div className="card-head">
        <Icon name="sleep" size={20} />
        <h2>Nap predictor</h2>
        {chip && <span className={`pill ${chip.cls}`}>{chip.text}</span>}
      </div>
      <p className="big">{headline}</p>
      <p className="muted">{sub}</p>
      {showBar && (
        <div className="wbar" role="img" aria-label={`Age range ${fmtRange(p.prior.min, p.prior.max)}, predicted ${fmtRange(p.range.min, p.range.max)}`}>
          <span className="prior" style={{ left: pct(p.prior.min), width: `calc(${pct(p.prior.max)} - ${pct(p.prior.min)})` }} />
          <span className="pred" style={{ left: pct(p.range.min), width: `calc(${pct(p.range.max)} - ${pct(p.range.min)})` }} />
          <span className="nowmark" style={{ left: pct((now - p.wakeAt!) / MIN) }} />
        </div>
      )}
      <p className="muted small">
        Age band ({formatAge(child.birthdate, now)}): {fmtRange(p.prior.min, p.prior.max)}. Predicted: {fmtRange(p.range.min, p.range.max)}. {learnedNote}{' '}
        <button className="link" onClick={onEditWindows}>
          Edit wake windows
        </button>
      </p>
    </section>
  );
}
