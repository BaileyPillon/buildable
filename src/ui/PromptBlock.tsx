import { useEffect, useRef, useState } from 'react';
import { copyText, downloadText } from './exporters';
import { CheckIcon, CopyIcon, DownloadIcon } from './icons';

type CopyState = 'idle' | 'copied' | 'failed';

export function CopyButton({
  text,
  label = 'Copy',
  doneLabel = 'Copied',
  className = '',
  small = true,
  onCopied,
}: {
  text: string;
  label?: string;
  doneLabel?: string;
  className?: string;
  small?: boolean;
  onCopied?: () => void;
}) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onClick = async (): Promise<void> => {
    const ok = await copyText(text);
    setState(ok ? 'copied' : 'failed');
    if (ok) onCopied?.();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2200);
  };

  return (
    <>
      <button type="button" className={`btn${small ? ' btn--small' : ''} ${className}`.trim()} onClick={onClick}>
        {state === 'copied' ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
        {state === 'copied' ? doneLabel : state === 'failed' ? 'Copy failed' : label}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === 'copied' ? 'Copied to clipboard' : state === 'failed' ? 'Could not copy. Select the text and copy it by hand.' : ''}
      </span>
    </>
  );
}

/** A mono block with Copy and, optionally, "Download build kit". */
export function PromptBlock({
  label,
  text,
  kit,
}: {
  label: string;
  text: string;
  kit?: { filename: string; content: string } | null;
}) {
  return (
    <div className="prompt">
      <div className="prompt__bar">
        <span className="prompt__label">{label}</span>
        <div className="prompt__actions">
          <CopyButton text={text} className="btn--ghost" />
          {kit && (
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={() => downloadText(kit.filename, kit.content)}
            >
              <DownloadIcon size={15} />
              Download build kit
            </button>
          )}
        </div>
      </div>
      <pre className="prompt__text" tabIndex={0} role="region" aria-label={label}>
        <code>{text}</code>
      </pre>
    </div>
  );
}
