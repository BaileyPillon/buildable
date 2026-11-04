// Links the page points at. Plain navigation links: they cannot carry statement data.
export const REPO_URL = 'https://github.com/BaileyPillon/buildable';

/** Where a proof app's build log lives in the repository. */
export function buildLogUrl(merchantId: string): string {
  return `${REPO_URL}/blob/main/rebuilt/${merchantId}/BUILDLOG.md`;
}

export const VIDEO_URL = 'https://youtu.be/KDyPHt4lW60';
export const VIDEO_TITLE = '31 Life-Changing Ways to Use Claude in 2027';
export const VIDEO_AUTHOR = 'Nick Saraev';

export function videoAt(seconds: number): string {
  return `${VIDEO_URL}?t=${seconds}`;
}

/** Only http(s) links are rendered as links. */
export function safeUrl(u: string | undefined): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

export function hostOf(u: string): string {
  try {
    return new URL(u).host.replace(/^www\./, '');
  } catch {
    return u;
  }
}

/** The last readable piece of a URL's path, for telling two links on the same host apart. */
function lastSegment(u: string): string {
  try {
    const parts = new URL(u).pathname.split('/').filter(Boolean);
    const last = decodeURIComponent(parts[parts.length - 1] ?? '');
    return last.length > 28 ? `${last.slice(0, 27)}…` : last;
  } catch {
    return '';
  }
}

/**
 * Link text for a list of source URLs. A host that appears once is shown as just the host. A host that appears
 * several times gets the end of the path as well, so "help.openai.com, help.openai.com" becomes two links a person
 * can tell apart. Identical URLs and identical labels are listed once.
 */
export function sourceLinks(urls: string[]): { url: string; label: string }[] {
  const unique = urls.filter((u, i) => urls.indexOf(u) === i);
  const perHost = new Map<string, number>();
  for (const u of unique) perHost.set(hostOf(u), (perHost.get(hostOf(u)) ?? 0) + 1);
  const out: { url: string; label: string }[] = [];
  for (const u of unique) {
    const host = hostOf(u);
    const tail = (perHost.get(host) ?? 0) > 1 ? lastSegment(u) : '';
    const label = tail ? `${host}/${tail}` : host;
    if (!out.some((o) => o.label === label)) out.push({ url: u, label });
  }
  return out;
}
