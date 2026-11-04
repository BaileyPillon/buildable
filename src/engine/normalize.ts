// Descriptor normalization (SPEC.md "Normalization").
//
// Goal: turn a raw statement descriptor into a short, stable, uppercase string that KB patterns can
// match, and from which a merchant grouping key can be derived. Pure string work, no DOM.
//
// Things deliberately KEPT recognisable: APPLE.COM/BILL, ITUNES.COM/BILL, "GOOGLE *NAME", AMAZON PRIME,
// AMZN DIGITAL, AUDIBLE, "OPENAI *CHATGPT SUBSCR". The spacing around "*" is left exactly as exported.

const US_STATES = new Set(
  'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR'.split(
    ' ',
  ),
);
const COUNTRIES = new Set(
  'US USA GB UK GBR IE IRL NL DE FR ES SE DK FI AU NZ LU CH AT BE PT PL'.split(' '),
);

/** Leading tokens that are bank boilerplate, not part of the merchant name. */
const JUNK_LEADING = new Set([
  'DEBIT', 'POS', 'VISA', '-VISA', 'RECURRING', 'CARD', 'ONLINE', 'WEB', 'PURCHASE', 'ELECTRONIC',
  'WITHDRAWAL', 'AUTHORIZED', 'PMT', 'PYMT', 'CHECKCARD', 'APLPAY', 'ACH', 'TO', 'PAYMENT', 'WWW',
]);

/** processor / wallet prefixes that hide the real merchant ("SQ *BLUE BOTTLE", "PAYPAL *NETFLIX"). */
const PROCESSOR_PREFIX = /^(?:SQ|TST|PP|PAYPAL|PY|IN|DD|CKO|GG|LS|SQUARE)\s*\*\s*/;
const SP_PREFIX = /^SP\s+(?=\S)/;
const AUTH_PREFIX = /^(?:(?:RECURRING )?(?:PURCHASE |PAYMENT )?AUTHORIZED ON \d{1,2}\/\d{1,2}|CHECK ?CARD \d{4})\s*/;

const APPLE_BILL = /\b(APPLE\.COM|ITUNES\.COM)\/BILL\b/;

// order matters: phones before dates before digit runs
const PHONE_PAREN = /\(\d{3}\)\s*\d{3}[-. ]?\d{4}/g;
const PHONE_FULL = /(?<![A-Z0-9])(?:\+?1[-. ])?\d{3}[-. ]\d{3}[-. ]\d{4}(?!\d)/g;
const PHONE_VANITY = /(?<![A-Z0-9])(?:1[-.])?\d{3}[-.][A-Z]{4,}(?![A-Z])/g;
const PHONE_LOCAL = /(?<![A-Z0-9])\d{3}-\d{4}(?!\d)/g;
const PHONE_INTL = /\+\d{1,3}(?:[ -]?\d{1,4}){2,5}/g;
const DATE_SLASH = /(?<![\d/])\d{1,2}\/\d{1,2}(?:\/\d{2,4})?(?![\d/])/g;
const DATE_ISO = /(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/g;
const DATE_DASH = /(?<![\d-])\d{1,2}-\d{1,2}-\d{2,4}(?![\d-])/g;
const CARD_FRAGMENT = /\bX{2,}\d{0,6}\b|\*{2,}\d*|\bCARD\s*(?:ENDING IN\s*)?\d{3,4}\b|\bENDING IN\s*\d{3,4}\b/g;
const HASH_ID = /#\s*\w*\d\w*/g;
const STAR_REF = /\*(?=[A-Z0-9]{5,}(?:\s|$))(?=(?:[A-Z]*\d){2})[A-Z0-9]+/g;
const LETTER_DIGIT_REF = /\b[A-Z]{1,2}\d{5,}[A-Z0-9]*\b/g;
const MIXED_REF = /\b(?=[A-Z0-9]{6,}\b)(?=(?:[A-Z]*\d){2})(?=(?:\d*[A-Z]){2})[A-Z0-9]+\b/g;
const LONG_DIGITS = /\b\d{4,}\b/g;
// G.CO is what is left of Google Play's "g.co/helppay#" suffix once URL paths are stripped
const NOISE_WORDS = /\b(?:RECURRING|PURCHASE|POS|DEBIT|CARD|ONLINE|WWW|CHECKCARD|PAYMENT TO|PMT TO|G\.CO)\b/g;

function cutAchTail(s: string): string {
  // Chase ACH: "ORIG CO NAME:ACME ORIG ID:123 DESC DATE: CO ENTRY DESCR:..."
  const orig = /ORIG CO NAME:\s*(.+?)(?:\s+ORIG ID:|\s+DESC DATE:|\s+CO ENTRY|$)/.exec(s);
  if (orig && orig[1]) return orig[1];
  // BofA ACH: "COMCAST CABLE COMM DES:CABLE PYMT ID:123 INDN:JANE DOE CO ID:456 WEB"
  const m = /\s(?:DES|INDN|PMT INFO|CO ID|ORIG ID|TRN|TRACE#)\s*:/.exec(s);
  if (m && m.index > 0) return s.slice(0, m.index);
  return s;
}

/**
 * What an ACH line says the payment is for, or '' when the line is not an ACH blob. normalizeDescriptor cuts
 * these blobs down to the originator name, which drops the one field that tells a student-loan payment from a
 * gym fee:
 *   "ORIG CO NAME:NELNET ORIG ID:226... CO ENTRY DESCR:LOAN PMT SEC:WEB TRACE#:..." -> "LOAN PMT"
 *   "COMCAST CABLE COMM DES:CABLE PYMT ID:123 INDN:JANE DOE CO ID:456 WEB"           -> "CABLE PYMT"
 */
export function achPurpose(raw: string): string {
  const upper = raw.toUpperCase();
  const chase = /CO ENTRY DESCR:\s*(.+?)(?:\s+SEC:|\s+TRACE#|$)/.exec(upper);
  if (chase) return chase[1].trim();
  const bofa = /\sDES:\s*(.+?)(?:\s+ID:|\s+INDN:|$)/.exec(upper);
  return bofa ? bofa[1].trim() : '';
}

function stripLeading(s: string): string {
  let prev: string;
  do {
    prev = s;
    s = s.replace(AUTH_PREFIX, '');
    s = s.replace(PROCESSOR_PREFIX, '');
    s = s.replace(SP_PREFIX, '');
    // leading boilerplate tokens and bare number/date tokens
    const sp = s.indexOf(' ');
    if (sp > 0) {
      const tok = s.slice(0, sp);
      if (JUNK_LEADING.has(tok) || /^(?:\d{4}|\d{1,2}\/\d{1,2})$/.test(tok)) s = s.slice(sp + 1);
    }
    s = s.trimStart();
  } while (s !== prev);
  return s;
}

function stripTrailingCodes(s: string): string {
  let toks = s.split(' ');
  while (toks.length > 1) {
    const last = toks[toks.length - 1];
    if (US_STATES.has(last) || COUNTRIES.has(last)) toks.pop();
    else break;
  }
  return toks.join(' ');
}

/**
 * Normalize a raw descriptor. Always returns an uppercase string; never empty unless the input was.
 * Examples (also asserted in normalize.test.ts):
 *   "NETFLIX.COM 866-579-7172 CA"                -> "NETFLIX.COM"
 *   "SQ *BLUE BOTTLE COFFEE SAN FRANCISCO CA"    -> "BLUE BOTTLE COFFEE SAN FRANCISCO"
 *   "GOOGLE *YouTube"                            -> "GOOGLE *YOUTUBE"
 *   "APPLE.COM/BILL 866-712-7753 CA"             -> "APPLE.COM/BILL"
 */
export function normalizeDescriptor(raw: string): string {
  const upper = raw.toUpperCase().replace(/[ \t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!upper) return '';

  const apple = APPLE_BILL.exec(upper);
  if (apple) return `${apple[1]}/BILL`; // everything around it is address / phone noise

  let s = cutAchTail(upper);
  s = s.replace(/HTTPS?:\/\//g, '');
  // URL paths ("NETFLIX.COM/ACCOUNT") are noise; APPLE/ITUNES /BILL was handled above
  s = s.replace(/(\.[A-Z]{2,6})\/\S*/g, '$1');
  s = stripLeading(s);

  s = s
    .replace(PHONE_PAREN, ' ')
    .replace(PHONE_FULL, ' ')
    .replace(PHONE_VANITY, ' ')
    .replace(PHONE_LOCAL, ' ')
    .replace(PHONE_INTL, ' ')
    .replace(DATE_SLASH, ' ')
    .replace(DATE_ISO, ' ')
    .replace(DATE_DASH, ' ')
    .replace(CARD_FRAGMENT, ' ')
    .replace(HASH_ID, ' ')
    .replace(STAR_REF, ' ')
    .replace(LETTER_DIGIT_REF, ' ')
    .replace(MIXED_REF, ' ')
    .replace(LONG_DIGITS, ' ')
    .replace(NOISE_WORDS, ' ');

  s = s.replace(/\s+/g, ' ').replace(/[\s*#.,:;\-_/]+$/, '').trim();
  // a "*" left dangling after a stripped reference id ("AMZN MKTP US*" -> "AMZN MKTP US")
  s = s.replace(/\s*\*$/, '').trim();
  s = stripLeading(s);
  s = stripTrailingCodes(s);
  s = s.replace(/^[\s*#.,:;\-_/]+/, '').trim();
  return s || upper;
}

/** Grouping key: the first `tokens` (default 3) tokens of the normalized descriptor. */
export function merchantKey(normalized: string, tokens = 3): string {
  return normalized.split(' ').slice(0, tokens).join(' ');
}

/** Lower-case kebab slug used inside stable series keys ("IRON FORGE FITNESS" -> "iron-forge-fitness"). */
export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "IRON FORGE FITNESS" -> "Iron Forge Fitness" (display name for unrecognized merchants). */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Which "the app is hidden behind a store" bundle a normalized descriptor belongs to, if any. */
export function bundleOf(normalized: string): 'apple' | 'google' | null {
  if (normalized === 'APPLE.COM/BILL' || normalized === 'ITUNES.COM/BILL') return 'apple';
  if (/^GOOGLE ?\*/.test(normalized)) return 'google';
  return null;
}
