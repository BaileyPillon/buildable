// Shortening a raw statement descriptor before it leaves the page (the "Ask Claude" prompt and the exported plan).
//
// The engine's own normalizer already strips processor prefixes, phone numbers, card fragments, dates, long digit
// runs, reference ids and trailing state codes (it needs that to match merchants). This adds the few things it
// leaves behind. It cannot find a person's name, so callers must say so and let the user read what is copied.
import { normalizeDescriptor } from './data';

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// anything that still looks like a phone number or an id: a run of digits and separators, at least 7 characters
const DIGIT_RUN = /\+?\(?\d[\d()\-. ]{5,}\d/g;
const DIGITS_4 = /\d{4,}/g;
const REF_WORDS = /\b(?:REF|REFERENCE|CONF|CONFIRMATION|AUTH|ACCT|ACCOUNT|ID)\b/g;
const MAX_LEN = 48;

export const NO_DESCRIPTOR = '(unreadable descriptor)';

export function scrubDescriptor(raw: string): string {
  let s = normalizeDescriptor(raw.replace(EMAIL, ' '));
  s = s.replace(DIGIT_RUN, ' ').replace(DIGITS_4, ' ').replace(REF_WORDS, ' ');
  s = s
    .replace(/\s+/g, ' ')
    .replace(/^[\s*#.,:;\-_/]+|[\s*#.,:;\-_/]+$/g, '')
    .trim();
  if (!s) return NO_DESCRIPTOR;
  if (s.length > MAX_LEN) {
    const cut = s.slice(0, MAX_LEN);
    const space = cut.lastIndexOf(' ');
    s = (space > 12 ? cut.slice(0, space) : cut).trim();
  }
  return s;
}

/** The distinct scrubbed forms of a series' raw descriptors (several raw strings often shorten to the same one). */
export function scrubbedDescriptors(descriptors: string[], max = 2): string[] {
  const out: string[] = [];
  for (const d of descriptors) {
    const s = scrubDescriptor(d);
    if (!out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
