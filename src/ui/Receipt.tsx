// The signature element: a thermal-paper receipt with a zigzag tear and a line-by-line print.
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { money } from './format';
import { DownloadIcon } from './icons';
import type { ReceiptModel } from './receiptModel';
import { renderReceiptPng } from './receiptPng';
import { downloadBlob } from './exporters';

const PRINT_MS = 700;

/**
 * On screen the receipt shows this many subscriptions, then one "+N more" line that opens the rest. Total, savings,
 * barcode and the Save button then fit in a laptop window without a scroller of their own. The saved image keeps
 * every line.
 */
export const RECEIPT_LINES_SHOWN = 8;

export function Receipt({
  model,
  hideNames = false,
  decorative = false,
  maxLines,
  expanded = false,
  onToggleExpanded,
}: {
  model: ReceiptModel;
  hideNames?: boolean;
  decorative?: boolean;
  /** Collapse the list to this many lines (with a control to show the rest). Leave out to show every line. */
  maxLines?: number;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}) {
  // A single hidden line would cost as much room as the "+1 more" row that replaces it, so only collapse 2 or more.
  const collapsible = !decorative && maxLines !== undefined && model.lines.length > maxLines + 1;
  const collapsed = collapsible && !expanded;
  const shown = collapsed ? model.lines.slice(0, maxLines) : model.lines;
  const hiddenLines = collapsed ? model.lines.slice(maxLines) : [];
  const hiddenYear = hiddenLines.reduce((sum, l) => sum + l.amount, 0);

  // Every printed line gets a stagger delay; the whole receipt prints in about PRINT_MS.
  let n = 0;
  const lineCount = shown.length + 14;
  const step = Math.min(40, PRINT_MS / lineCount);
  const d = (): CSSProperties => ({ '--d': `${Math.round(n++ * step)}ms` }) as CSSProperties;

  return (
    <div className={`receipt-wrap${decorative ? ' is-decorative' : ''}`}>
      <div className="receipt__slot" aria-hidden="true" />
      <div
        className="receipt"
        {...(decorative
          ? { 'aria-hidden': true }
          : { role: 'group', 'aria-label': 'Subscription tax receipt' })}
      >
        <div className="receipt__in">
          <p className="r-line r-title" style={d()}>
            SUBSCRIPTION TAX
          </p>
          <p className="r-line r-range" style={d()}>
            {model.range}
          </p>
          <div className="r-line r-rule" style={d()} aria-hidden="true" />

          <ul className="r-list">
            {shown.map((l, i) => (
              <li key={`${i}-${l.hiddenLabel}`} className="r-line r-row" style={d()}>
                <span className="r-name">{hideNames ? l.hiddenLabel : l.label}</span>
                <span className="r-lead" aria-hidden="true" />
                <span className="r-amt">{money(l.amount, 'always')}/yr</span>
              </li>
            ))}
            {collapsed && (
              <li className="r-line r-more" style={d()}>
                <button type="button" className="r-more__btn" aria-expanded="false" onClick={onToggleExpanded}>
                  <span className="r-name">
                    +{hiddenLines.length} more, show all {model.lines.length}
                  </span>
                  <span className="r-lead" aria-hidden="true" />
                  <span className="r-amt">{money(hiddenYear, 'always')}/yr</span>
                </button>
              </li>
            )}
            {collapsible && expanded && (
              <li className="r-line r-more">
                <button type="button" className="r-more__btn" aria-expanded="true" onClick={onToggleExpanded}>
                  <span className="r-name">Show fewer</span>
                </button>
              </li>
            )}
          </ul>

          <div className="r-line r-rule" style={d()} aria-hidden="true" />
          <p className="r-line r-row r-total" style={d()}>
            <span>TOTAL / YEAR</span>
            <span className="r-amt">{money(model.totalYear, 'always')}</span>
          </p>
          <p className="r-line r-row r-month" style={d()}>
            <span>PER MONTH</span>
            <span className="r-amt">{money(model.perMonth, 'always')}</span>
          </p>
          <div className="r-line r-rule" style={d()} aria-hidden="true" />

          {model.groups.map((g) => (
            <p key={g.key} className="r-line r-row r-group" style={d()}>
              <span className="r-glabel">
                <i className="r-dot" data-group={g.key} aria-hidden="true" />
                {g.label}
              </span>
              <span className="r-amt">{money(g.amount, 'always')}/yr</span>
            </p>
          ))}
          {model.claudeCostYear > 0 && (
            <p className="r-line r-row r-group r-less" style={d()}>
              <span className="r-glabel">LESS CLAUDE PRO</span>
              <span className="r-amt">-{money(model.claudeCostYear, 'always')}/yr</span>
            </p>
          )}
          <div className="r-line r-rule r-rule--double" style={d()} aria-hidden="true" />

          <p className="r-line r-keep-label" style={d()}>
            YOU COULD KEEP
          </p>
          <p className="r-line r-keep" style={d()}>
            {money(model.keepYear, 'never')}
            <span>/yr</span>
          </p>
          <p className="r-line r-hours" style={d()}>
            for about {Math.round(model.hours * 10) / 10} hours of building
          </p>

          <svg
            className="r-line r-barcode"
            style={d()}
            viewBox={`0 0 ${model.barUnits} 24`}
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            {model.bars.map((b, i) => (
              <rect
                key={i}
                x={b.x}
                y={0}
                width={b.w}
                height={24}
                style={{ fill: `var(--v-${b.verdict})` }}
              />
            ))}
          </svg>
          <p className="r-line r-thanks" style={d()}>
            KEEP THE CHANGE.
          </p>
        </div>
      </div>
    </div>
  );
}

export function ReceiptPanel({
  model,
  expanded,
  onToggleExpanded,
}: {
  model: ReceiptModel;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const [hideNames, setHideNames] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const save = async (): Promise<void> => {
    setBusy(true);
    setMessage('');
    try {
      const blob = await renderReceiptPng(model, { hideNames });
      downloadBlob(hideNames ? 'subscription-tax-receipt-private.png' : 'subscription-tax-receipt.png', blob);
      setMessage('Saved. Check your downloads.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save the image.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="receipt-panel">
      <Receipt
        model={model}
        hideNames={hideNames}
        maxLines={RECEIPT_LINES_SHOWN}
        expanded={expanded}
        onToggleExpanded={onToggleExpanded}
      />
      <div className="receipt-actions">
        <button type="button" className="btn btn--primary btn--block" onClick={save} disabled={busy}>
          <DownloadIcon size={17} />
          {busy ? 'Drawing the receipt...' : 'Save receipt as image'}
        </button>
        <label className="check">
          <input type="checkbox" checked={hideNames} onChange={(e) => setHideNames(e.target.checked)} />
          <span>Hide merchant names</span>
        </label>
        <p className="receipt-actions__msg" role="status" aria-live="polite">
          {message}
        </p>
      </div>
    </div>
  );
}
