import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Context, Device, Merchant, Verdict } from '../types';
import type { CardActions, CardSnapshot } from './AssessmentCard';
import { Footer, Header } from './Chrome';
import type { ContextActions } from './ContextControls';
import { loadContext, resetPerStatement, saveContext } from './context';
import { findRecurring, loadKb, parseFiles, statementRange } from './data';
import type { Status } from './Dropzone';
import { longMonthYear } from './format';
import { Landing } from './Landing';
import { CATALOG_LOAD_FAILED, noTransactionsMessage } from './messages';
import { Results } from './Results';
import type { Loaded } from './Results';
import { useFileDrop } from './useFileDrop';
import { useTheme } from './useTheme';

const SAMPLE_URL = '/sample-statement.csv';
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const EXTENSIONS = ['csv', 'tsv', 'txt', 'ofx', 'qfx', 'qbo'];
const FALLBACK_PRICES_MONTH = '2026-11';

type InputFile = { name: string; text: string };

class UserFacingError extends Error {
  constructor(
    message: string,
    /** The failure is the page's own (a script chunk that would not load), so offer a reload. */
    readonly reload = false,
  ) {
    super(message);
  }
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

/** Let React paint the "reading" state before the synchronous engine work starts. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 30);
  });
}

export function App() {
  const { theme, toggle } = useTheme();
  const [kb, setKb] = useState<Merchant[]>([]);
  const kbRef = useRef<Merchant[] | null>(null);
  const [ctx, setCtx] = useState<Context>(loadContext);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  // Knowledge base: needed for the pipeline and for the "prices checked" month in the footer.
  useEffect(() => {
    let alive = true;
    loadKb()
      .then((m) => {
        kbRef.current = m;
        if (alive) setKb(m);
      })
      .catch(() => {
        /* the pipeline retries and reports the failure */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    saveContext(ctx);
  }, [ctx]);

  const pricesChecked = useMemo(() => {
    const months = kb.map((m) => m.pricesCheckedAt).filter(Boolean).sort();
    return longMonthYear(months[months.length - 1] ?? FALLBACK_PRICES_MONTH);
  }, [kb]);

  const runPipeline = useCallback(async (files: InputFile[]): Promise<void> => {
    setStatus({ kind: 'loading', message: 'Reading your statement...' });
    try {
      await nextFrame();
      let kbNow = kbRef.current;
      if (!kbNow) {
        try {
          kbNow = await loadKb();
        } catch {
          // The catalog is a separate JS chunk. After a redeploy an open tab still points at the old file name,
          // and offline it cannot be fetched at all. Say so, instead of blaming the user's CSV.
          throw new UserFacingError(CATALOG_LOAD_FAILED, true);
        }
      }
      kbRef.current = kbNow;
      setKb(kbNow);
      const { txns, warnings } = await parseFiles(files);
      if (txns.length === 0) {
        throw new UserFacingError(noTransactionsMessage(warnings, files.length));
      }
      setStatus({ kind: 'loading', message: 'Looking for recurring charges...' });
      await nextFrame();
      const series = findRecurring(txns, kbNow);
      setCtx((c) => resetPerStatement(c));
      setLoaded({ fileNames: files.map((f) => f.name), warnings, txnCount: txns.length, series, range: statementRange(txns) });
      setStatus({ kind: 'idle' });
    } catch (err) {
      if (err instanceof UserFacingError) {
        setStatus({ kind: 'error', message: err.message, ...(err.reload ? { reload: true } : {}) });
      } else {
        setStatus({
          kind: 'error',
          message: 'Something went wrong reading that statement. Check that it is a CSV, OFX or QFX export and try again.',
        });
      }
    }
  }, []);

  const onFiles = useCallback(
    async (picked: File[]): Promise<void> => {
      const good: File[] = [];
      const rejected: string[] = [];
      for (const f of picked) {
        if (!EXTENSIONS.includes(extOf(f.name))) rejected.push(`${f.name} (not a CSV, OFX or QFX file)`);
        else if (f.size > MAX_FILE_BYTES) rejected.push(`${f.name} (over 25 MB)`);
        else good.push(f);
      }
      if (good.length === 0) {
        setStatus({
          kind: 'error',
          message: `We can read CSV, OFX and QFX files. Skipped: ${rejected.join(', ')}. PDF statements are not supported; look for a download or export option in online banking.`,
        });
        return;
      }
      setStatus({ kind: 'loading', message: 'Reading your statement...' });
      try {
        const files: InputFile[] = await Promise.all(good.map(async (f) => ({ name: f.name, text: await f.text() })));
        await runPipeline(files);
      } catch {
        setStatus({ kind: 'error', message: 'That file could not be read by the browser. Try exporting it again.' });
      }
    },
    [runPipeline],
  );

  const onSample = useCallback(async (): Promise<void> => {
    setStatus({ kind: 'loading', message: 'Fetching the sample statement...' });
    try {
      const res = await fetch(SAMPLE_URL, { cache: 'no-store' });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || type.includes('text/html')) throw new Error('missing');
      const text = await res.text();
      if (!text.trim() || text.trimStart().startsWith('<')) throw new Error('missing');
      await runPipeline([{ name: 'sample-statement.csv', text }]);
    } catch {
      setStatus({
        kind: 'error',
        message: 'The sample statement could not be loaded right now. You can still drop your own CSV above.',
      });
    }
  }, [runPipeline]);

  const startOver = useCallback((): void => {
    setLoaded(null);
    setStatus({ kind: 'idle' });
    setCtx((c) => resetPerStatement(c));
    window.scrollTo({ top: 0 });
    requestAnimationFrame(() => document.getElementById('hero-title')?.focus({ preventScroll: true }));
  }, []);

  const contextActions = useMemo<ContextActions>(
    () => ({
      setClaudePlan: (claudePlan) => setCtx((c) => ({ ...c, claudePlan })),
      toggleDevice: (device: Device) =>
        setCtx((c) => ({
          ...c,
          devices: c.devices.includes(device) ? c.devices.filter((d) => d !== device) : [...c.devices, device],
        })),
      setHourly: (hourlyValue) => setCtx((c) => ({ ...c, hourlyValue })),
    }),
    [],
  );

  const cardActions = useMemo<CardActions>(
    () => ({
      setVerdict: (key: string, verdict: Verdict | null) =>
        setCtx((c) => {
          const next = { ...c.verdictOverrides };
          if (verdict) next[key] = verdict;
          else delete next[key];
          return { ...c, verdictOverrides: next };
        }),
      setUnused: (key: string, on: boolean) =>
        setCtx((c) => ({
          ...c,
          unused: on ? (c.unused.includes(key) ? c.unused : [...c.unused, key]) : c.unused.filter((k) => k !== key),
        })),
      restore: (key: string, snap: CardSnapshot) =>
        setCtx((c) => {
          const verdictOverrides = { ...c.verdictOverrides };
          if (snap.verdict) verdictOverrides[key] = snap.verdict;
          else delete verdictOverrides[key];
          const merchantOverrides = { ...c.merchantOverrides };
          if (snap.merchant) merchantOverrides[key] = snap.merchant;
          else delete merchantOverrides[key];
          const unused = c.unused.filter((k) => k !== key);
          if (snap.unused) unused.push(key);
          return { ...c, unused, verdictOverrides, merchantOverrides };
        }),
      pickMerchant: (key: string, merchantId: string | null) =>
        setCtx((c) => {
          const next = { ...c.merchantOverrides };
          if (merchantId) next[key] = merchantId;
          else delete next[key];
          // A new app means the old verdict choice no longer applies.
          const overrides = { ...c.verdictOverrides };
          delete overrides[key];
          return { ...c, merchantOverrides: next, verdictOverrides: overrides };
        }),
    }),
    [],
  );

  // Files dropped anywhere on the landing page are read; anywhere else they are ignored. Either way the browser
  // must not open them in this tab and leave the app.
  const pageDragging = useFileDrop(loaded || status.kind === 'loading' ? null : onFiles);

  const view = loaded ? 'results' : 'landing';

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header view={view} theme={theme} onToggleTheme={toggle} />
      <main id="main">
        {loaded ? (
          <Results
            loaded={loaded}
            kb={kb}
            ctx={ctx}
            contextActions={contextActions}
            cardActions={cardActions}
            onStartOver={startOver}
          />
        ) : (
          <Landing status={status} onFiles={onFiles} onSample={onSample} pageDragging={pageDragging} />
        )}
      </main>
      <Footer pricesChecked={pricesChecked} />
    </>
  );
}

