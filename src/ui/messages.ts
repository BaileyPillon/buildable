// User-facing sentences built from engine output. Pure, so they can be tested without a DOM.

/** Engine warnings are fragments ("empty.csv: the file is empty"). Make one a sentence. */
export function asSentence(text: string): string {
  const t = text.trim().replace(/[.\s]+$/, '');
  return t ? `${t}.` : '';
}

/** Shown when the files parse but hold no transactions. */
export function noTransactionsMessage(warnings: string[], fileCount: number): string {
  const what = fileCount === 1 ? 'that file' : 'those files';
  const shown = warnings.map(asSentence).filter(Boolean);
  // a long list of warnings is noise here; the full list is on the results page when there is one
  const why = shown.length ? ` ${shown.slice(0, 2).join(' ')}` : '';
  return `We could not find any transactions in ${what}.${why} Try a CSV, OFX or QFX export from your bank.`;
}

/** Shown when the lazily loaded service catalog (a separate JS chunk) cannot be fetched. */
export const CATALOG_LOAD_FAILED =
  'The service catalog could not be loaded. This usually means you are offline, or the site was updated while this page was open. Reload the page and try again.';
