import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Context, Merchant, RecurringSeries } from '../types';
import type { CardActions, CardSnapshot } from './AssessmentCard';
import { CardUiContext } from './cardUi';
import type { CardUi } from './cardUi';
import { ContextControls } from './ContextControls';
import type { ContextActions } from './ContextControls';
import { assess } from './data';
import { cardName, derive, locationOf } from './derive';
import { downloadText, planMarkdown } from './exporters';
import { money, monthsSpan, plural, rangeLabel } from './format';
import { ChevronIcon, CloseIcon, DownloadIcon, WarningIcon } from './icons';
import { ReceiptPanel } from './Receipt';
import { buildReceiptModel } from './receiptModel';
import { AlreadyGone, BuildQueue, EverythingElse, Unrecognized } from './Sections';

export type Loaded = {
  fileNames: string[];
  warnings: string[];
  txnCount: number;
  series: RecurringSeries[];
  /** First and last transaction date of the statement, for the receipt header and the "active" cutoff. */
  range: { start: string; end: string };
};

/** A change to one card that put it somewhere else on the page. */
type Moved = { id: number; key: string; name: string; to: string; snapshot: CardSnapshot };
/** What the user just did to a card, noted before the change and settled once the page has re-rendered. */
type Gesture = { key: string; from: string | null; focusId: string | null; keyboard: boolean; snapshot: CardSnapshot };

const TOAST_MS = 12000;

function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}

function findCard(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-card-key="${cssEscape(key)}"]`);
}

/** "ChatGPT Plus moved to Everything else, under Keep." with Show it, Undo and Dismiss. */
function MoveNotice({
  moved,
  onShow,
  onUndo,
  onDismiss,
}: {
  moved: Moved | null;
  onShow: () => void;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!moved || paused) return;
    const t = window.setTimeout(onDismiss, TOAST_MS);
    return () => window.clearTimeout(t);
  }, [moved, paused, onDismiss]);

  return (
    <div className="toast-region">
      {/* the live region is always in the page, so the message is announced when it changes */}
      <p className="sr-only" role="status" aria-live="polite">
        {moved ? `${moved.name} moved to ${moved.to}.` : ''}
      </p>
      {moved && (
        <div
          key={moved.id}
          className="toast"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <p className="toast__text">
            <strong>{moved.name}</strong> moved to {moved.to}.
          </p>
          <div className="toast__actions">
            <button type="button" className="btn btn--small btn--ghost" onClick={onShow}>
              Show it
            </button>
            <button type="button" className="btn btn--small btn--ghost" onClick={onUndo}>
              Undo
            </button>
            <button type="button" className="icon-btn icon-btn--small" onClick={onDismiss} aria-label="Dismiss">
              <CloseIcon size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Results({
  loaded,
  kb,
  ctx,
  contextActions,
  cardActions,
  onStartOver,
}: {
  loaded: Loaded;
  kb: Merchant[];
  ctx: Context;
  contextActions: ContextActions;
  cardActions: CardActions;
  onStartOver: () => void;
}) {
  const { items, summary } = useMemo(
    () => assess(loaded.series, kb, ctx, { statementStart: loaded.range.start, statementEnd: loaded.range.end }),
    [loaded.series, loaded.range, kb, ctx],
  );
  const d = useMemo(() => derive(items, summary), [items, summary]);
  const model = useMemo(
    () => buildReceiptModel(d, summary.statementStart, summary.statementEnd),
    [d, summary.statementStart, summary.statementEnd],
  );
  const t = d.totals;

  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, []);

  const [warnOpen, setWarnOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);

  // The receipt column stays in view while the cards scroll, but only when the window is tall enough to show all of it.
  // A sticky column taller than the window would hide its own total and Save button, so it scrolls with the page then.
  const leftRef = useRef<HTMLElement>(null);
  const [fits, setFits] = useState(false);
  useEffect(() => {
    const el = leftRef.current;
    if (!el) return;
    const check = (): void => setFits(el.offsetHeight + 40 <= window.innerHeight);
    check();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check);
    ro?.observe(el);
    window.addEventListener('resize', check);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', check);
    };
  }, [receiptOpen, d.active.length]);
  const hasAnything = d.active.length > 0 || d.inactive.length > 0;

  // ---- which plans are expanded: kept here, by series, so a card that moves keeps its state ----
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() => {
    // the first card in the queue starts open, once; cards that later slide into its place stay closed
    const first = d.queue[0];
    return first ? { [first.series.key]: true } : {};
  });
  const cardUi = useMemo<CardUi>(
    () => ({
      isOpen: (key) => openMap[key] === true,
      setOpen: (key, open) => setOpenMap((m) => ({ ...m, [key]: open })),
    }),
    [openMap],
  );

  // ---- a change that moves a card: remember where it was, then say where it went ----
  const gesture = useRef<Gesture | null>(null);
  const movedSeq = useRef(0);
  const [moved, setMoved] = useState<Moved | null>(null);

  const tracked = useMemo<CardActions>(() => {
    const begin = (key: string): void => {
      const el = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const inCard = !!el && !!el.closest(`[data-card-key="${cssEscape(key)}"]`);
      gesture.current = {
        key,
        from: locationOf(d, key)?.id ?? null,
        focusId: inCard ? (el.dataset.focusId ?? null) : null,
        keyboard: inCard && el.matches(':focus-visible'),
        snapshot: {
          unused: ctx.unused.includes(key),
          verdict: ctx.verdictOverrides[key] ?? null,
          merchant: ctx.merchantOverrides[key] ?? null,
        },
      };
    };
    return {
      setVerdict: (key, verdict) => {
        begin(key);
        cardActions.setVerdict(key, verdict);
      },
      setUnused: (key, on) => {
        begin(key);
        cardActions.setUnused(key, on);
      },
      pickMerchant: (key, merchantId) => {
        begin(key);
        cardActions.pickMerchant(key, merchantId);
      },
      restore: (key, snapshot) => {
        gesture.current = null;
        cardActions.restore(key, snapshot);
      },
    };
  }, [cardActions, d, ctx]);

  useEffect(() => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    // A card that moved is a new element, so focus fell to the page. Put it back on the control the user used.
    if (g.focusId) {
      const target = findCard(g.key)?.querySelector<HTMLElement>(`[data-focus-id="${cssEscape(g.focusId)}"]`);
      if (target && document.activeElement !== target) {
        target.focus({ preventScroll: !g.keyboard });
        // someone using the keyboard must be able to see where they are; a pointer user stays where they were
        if (g.keyboard) target.scrollIntoView({ block: 'center' });
      }
    }
    const to = locationOf(d, g.key);
    const item = d.active.find((i) => i.series.key === g.key);
    if (to && item && g.from !== to.id) {
      setMoved({ id: ++movedSeq.current, key: g.key, name: cardName(item), to: to.label, snapshot: g.snapshot });
    }
  }, [d]);

  const dismissMoved = useCallback(() => setMoved(null), []);
  const showMoved = useCallback(() => {
    if (!moved) return;
    const card = findCard(moved.key);
    if (!card) return;
    card.scrollIntoView({ block: 'center' });
    card.querySelector<HTMLElement>('[data-focus-id="title"]')?.focus({ preventScroll: true });
  }, [moved]);
  const undoMoved = useCallback(() => {
    if (!moved) return;
    tracked.restore(moved.key, moved.snapshot);
    setMoved(null);
  }, [moved, tracked]);

  const exportPlan = (): void => {
    const md = planMarkdown({
      derived: d,
      ctx,
      start: summary.statementStart,
      end: summary.statementEnd,
      fileCount: loaded.fileNames.length,
    });
    downloadText('my-buildable-plan.md', md);
  };

  // Section numbers follow what is actually on the page.
  let num = 0;
  const nQueue = ++num;
  const nElse = d.groups.length + d.needsPick.length > 0 ? ++num : 0;
  const nUnrec = d.unrecognized.length > 0 ? ++num : 0;
  const nGone = d.inactive.length > 0 ? ++num : 0;

  const announce = `${plural(t.activeCount, 'subscription')}, ${money(t.totalYear, 'never')} a year. You could keep ${money(t.keepYear, 'never')} a year.`;
  const months = monthsSpan(summary.statementStart, summary.statementEnd);
  const blockedCount = d.queue.filter((i) => i.blocked).length;

  return (
    <CardUiContext.Provider value={cardUi}>
      <div className="results">
        <div className="wrap">
          {/* The heading comes first in the page (it takes focus when results appear, so Tab then reaches the bar's
              buttons), and CSS puts the bar above it on screen. */}
          <div className="results-top">
            <header className="results-head">
              <p className="eyebrow">Your subscription tax</p>
              <h1 ref={headingRef} tabIndex={-1} className="results-head__title">
                {hasAnything && d.active.length > 0 ? (
                  <>
                    You could keep <em>{money(t.keepYear, 'never')}</em> a year.
                  </>
                ) : (
                  <>No recurring charges found.</>
                )}
              </h1>
              {d.active.length > 0 && (
                <p className="results-head__sub">
                  {plural(t.activeCount, 'recurring charge')} add up to {money(t.totalYear, 'never')} a year.
                  {t.buildHours > 0 && (
                    <>
                      {' '}
                      Following every verdict means about {Math.round(t.buildHours * 10) / 10} hours of building
                      {blockedCount > 0 && <> (not counting {blockedCount} blocked)</>}.
                    </>
                  )}
                  {t.claudeCostYear > 0 && <> That is after {money(t.claudeCostYear, 'never')} a year for Claude Pro.</>}
                </p>
              )}
              <p className="sr-only" role="status" aria-live="polite">
                {announce}
              </p>
            </header>

            <div className="bar">
              <p className="bar__facts">
                <span className="bar__range">{rangeLabel(summary.statementStart, summary.statementEnd)}</span>
                <span className="bar__sep" aria-hidden="true">·</span>
                <span>{plural(months, 'month')}</span>
                <span className="bar__sep" aria-hidden="true">·</span>
                <span title={loaded.fileNames.join(', ')}>{plural(loaded.fileNames.length, 'file')}</span>
                <span className="bar__sep" aria-hidden="true">·</span>
                <span>{loaded.txnCount.toLocaleString('en-US')} transactions</span>
                {loaded.warnings.length > 0 && (
                  <>
                    <span className="bar__sep" aria-hidden="true">·</span>
                    <button
                      type="button"
                      className="bar__warn"
                      aria-expanded={warnOpen}
                      aria-controls="warnings"
                      onClick={() => setWarnOpen((o) => !o)}
                    >
                      <WarningIcon size={14} />
                      {plural(loaded.warnings.length, 'warning')}
                      <ChevronIcon size={14} />
                    </button>
                  </>
                )}
              </p>
              <div className="bar__actions">
                <button type="button" className="btn btn--secondary btn--small" onClick={exportPlan} disabled={!hasAnything}>
                  <DownloadIcon size={15} />
                  Export my plan
                </button>
                <button type="button" className="btn btn--ghost btn--small" onClick={onStartOver}>
                  Start over
                </button>
              </div>
            </div>
            <div id="warnings" className="warnings" hidden={!warnOpen}>
              <ul>
                {loaded.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          </div>

          {!hasAnything ? (
            <div className="empty-state">
              <p>
                We did not find charges that repeat in this statement. A subscription shows up after at least
                three billing periods, so try adding more months or another card.
              </p>
              <button type="button" className="btn btn--primary" onClick={onStartOver}>
                Try other files
              </button>
            </div>
          ) : (
            <div className="results-grid">
              <aside ref={leftRef} className={`results-left${fits && !receiptOpen ? ' is-sticky' : ''}`} aria-label="Receipt">
                <ReceiptPanel model={model} expanded={receiptOpen} onToggleExpanded={() => setReceiptOpen((o) => !o)} />
              </aside>
              <div className="results-right">
                <ContextControls ctx={ctx} actions={contextActions} claudeCostYear={t.claudeCostYear} />
                <BuildQueue
                  items={d.queue}
                  num={nQueue}
                  savings={d.queue.filter((i) => !i.blocked).reduce((n, i) => n + i.savingsYear, 0)}
                  hours={t.buildHours}
                  ctx={ctx}
                  kb={kb}
                  actions={tracked}
                />
                <EverythingElse
                  groups={d.groups}
                  needsPick={d.needsPick}
                  num={nElse}
                  ctx={ctx}
                  kb={kb}
                  actions={tracked}
                />
                <Unrecognized items={d.unrecognized} num={nUnrec} ctx={ctx} actions={tracked} />
                <AlreadyGone items={d.inactive} num={nGone} />
              </div>
            </div>
          )}
        </div>
      </div>
      <MoveNotice moved={moved} onShow={showMoved} onUndo={undoMoved} onDismiss={dismissMoved} />
    </CardUiContext.Provider>
  );
}
