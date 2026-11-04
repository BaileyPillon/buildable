import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { UploadIcon } from './icons';

export type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; message: string }
  /** `reload`: the failure is the page's own (a script chunk that would not load), so offer a reload, not "try again". */
  | { kind: 'error'; message: string; reload?: boolean };

const ACCEPT = '.csv,.tsv,.txt,.ofx,.qfx,.qbo,text/csv,text/plain';

export function Dropzone({
  status,
  onFiles,
  onSample,
  pageDragging = false,
}: {
  status: Status;
  onFiles: (files: File[]) => void;
  onSample: () => void;
  /** A file is being dragged over the page, outside this box: show the box as the target. */
  pageDragging?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const busy = status.kind === 'loading';

  const stop = (e: DragEvent): void => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      className={`dropzone${dragging || (pageDragging && !busy) ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}`}
      onDragEnter={(e) => {
        stop(e);
        if (!busy) setDragging(true);
      }}
      onDragOver={(e) => {
        stop(e);
        if (!busy) setDragging(true);
      }}
      onDragLeave={(e) => {
        stop(e);
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={(e) => {
        stop(e);
        setDragging(false);
        if (busy) return;
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) onFiles(files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        tabIndex={-1}
        data-testid="file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
      <div className="dropzone__icon" aria-hidden="true">
        <UploadIcon size={22} />
      </div>
      <p className="dropzone__text">
        Drop CSV, OFX or QFX statements here, or{' '}
        <button
          type="button"
          className="linklike"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          choose files
        </button>
        . Several months and several cards work best.
      </p>
      <div className="dropzone__actions">
        <button type="button" className="btn btn--secondary" disabled={busy} onClick={onSample}>
          Try a sample statement
        </button>
      </div>
      <div className="dropzone__status" role="status" aria-live="polite">
        {status.kind === 'loading' && (
          <p className="dropzone__loading">
            <span className="spinner" aria-hidden="true" />
            {status.message}
          </p>
        )}
      </div>
      {status.kind === 'error' && (
        <div className="dropzone__error" role="alert">
          <p>{status.message}</p>
          {status.reload && (
            <button type="button" className="btn btn--secondary btn--small" onClick={() => window.location.reload()}>
              Reload the page
            </button>
          )}
        </div>
      )}
    </div>
  );
}
