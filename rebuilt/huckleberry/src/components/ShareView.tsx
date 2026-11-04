import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { addDays, parseDateInput, startOfDay, toDateInput } from '../lib/time';
import { buildShareModel, buildShareText, canvasToPng, drawSharePng } from '../lib/share';
import { downloadBlob, downloadText } from '../lib/dataio';
import { Icon, useToast } from './ui';

type Preset = 'today' | 'yesterday' | 'week' | 'custom';

export function ShareView() {
  const store = useStore();
  const toast = useToast();
  const [preset, setPreset] = useState<Preset>('week');
  const [customFrom, setCustomFrom] = useState(() => toDateInput(addDays(startOfDay(Date.now()), -13)));
  const [customTo, setCustomTo] = useState(() => toDateInput(startOfDay(Date.now())));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [now] = useState(() => Date.now());

  const range = useMemo(() => {
    const today = startOfDay(now);
    if (preset === 'today') return { first: today, count: 1 };
    if (preset === 'yesterday') return { first: addDays(today, -1), count: 1 };
    if (preset === 'week') return { first: addDays(today, -6), count: 7 };
    const f = parseDateInput(customFrom) ?? today;
    const t = parseDateInput(customTo) ?? today;
    const count = Math.round((startOfDay(t) - startOfDay(f)) / 86_400_000) + 1;
    return { first: f, count: Math.min(31, Math.max(1, count)) };
  }, [preset, customFrom, customTo, now]);

  const model = useMemo(
    () => (store.child ? buildShareModel(store.child, store.events, range.first, range.count, store.settings.units, now) : null),
    [store.child, store.events, range, store.settings.units, now],
  );
  const text = useMemo(() => (model ? buildShareText(model) : ''), [model]);

  useEffect(() => {
    if (model && canvasRef.current) {
      try {
        drawSharePng(canvasRef.current, model);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not draw the image');
      }
    }
  }, [model, toast]);

  if (!store.child || !model) return null;
  const base = `${store.child.name.replace(/[^\w-]+/g, '_')}-${toDateInput(range.first)}${range.count > 1 ? '_' + range.count + 'd' : ''}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Summary copied');
    } catch {
      const ta = document.getElementById('share-text') as HTMLTextAreaElement | null;
      ta?.select();
      toast('Select the text and copy it manually');
    }
  };
  const png = async () => {
    if (!canvasRef.current) return;
    downloadBlob(`${base}.png`, await canvasToPng(canvasRef.current));
  };
  const nativeShare = async () => {
    if (!canvasRef.current) return;
    try {
      const blob = await canvasToPng(canvasRef.current);
      const file = new File([blob], `${base}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: `${model.childName} summary`, text });
      else await navigator.share({ title: `${model.childName} summary`, text });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('Sharing is not available here; use Copy or Download');
    }
  };

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <Icon name="share" size={20} />
          <h2>Share a summary</h2>
        </div>
        <p className="muted small">For a pediatrician visit or a caregiver. Nothing leaves this device unless you send it.</p>
        <div className="seg" role="group" aria-label="Range">
          {(
            [
              ['today', 'Today'],
              ['yesterday', 'Yesterday'],
              ['week', 'Last 7 days'],
              ['custom', 'Custom'],
            ] as [Preset, string][]
          ).map(([k, l]) => (
            <button key={k} className={preset === k ? 'on' : ''} onClick={() => setPreset(k)}>
              {l}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="row2">
            <label>
              From
              <input type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} />
            </label>
          </div>
        )}
        <div className="actions wrap">
          <button className="primary" onClick={png}>
            Download PNG
          </button>
          <button onClick={copy}>Copy text</button>
          <button onClick={() => downloadText(`${base}.txt`, text, 'text/plain')}>Download text</button>
          {typeof navigator.share === 'function' && <button onClick={nativeShare}>Share...</button>}
        </div>
      </div>
      <div className="card">
        <h3>Image preview</h3>
        <canvas ref={canvasRef} className="share-canvas" aria-label="Summary image preview" />
      </div>
      <div className="card">
        <h3>Text</h3>
        <textarea id="share-text" className="share-text" readOnly value={text} rows={Math.min(22, text.split('\n').length + 1)} />
      </div>
    </div>
  );
}
