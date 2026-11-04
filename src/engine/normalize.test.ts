import { describe, expect, it } from 'vitest';
import { bundleOf, merchantKey, normalizeDescriptor } from './normalize';

// raw -> normalized pairs. These double as documentation for the KB agents: patterns are tested against
// the right-hand side (and, as a fallback, against the raw uppercase descriptor).
const PAIRS: [string, string][] = [
  ['NETFLIX.COM 866-579-7172 CA', 'NETFLIX.COM'],
  ['OPENAI *CHATGPT SUBSCR', 'OPENAI *CHATGPT SUBSCR'],
  ['APPLE.COM/BILL 866-712-7753 CA', 'APPLE.COM/BILL'],
  ['APPLE.COM/BILL ONE APPLE PARK WAY 866-712-7753 CA US', 'APPLE.COM/BILL'],
  ['COMCAST CABLE COMM 800-COMCAST PA', 'COMCAST CABLE COMM'],
  ['SQ *BLUE BOTTLE COFFEE SAN FRANCISCO CA', 'BLUE BOTTLE COFFEE SAN FRANCISCO'],
  ['GOOGLE *YouTube', 'GOOGLE *YOUTUBE'],
  ['GOOGLE *YouTubePremium g.co/helppay#', 'GOOGLE *YOUTUBEPREMIUM'],
  ['PAYPAL *SPOTIFYUSA 402-935-7733', 'SPOTIFYUSA'],
  ['AMZN MKTP US*2K4XY7ZQ0', 'AMZN MKTP'],
  ['PURCHASE AUTHORIZED ON 01/02 NETFLIX.COM 866-579-7172 CA S465678912345678 CARD 1234', 'NETFLIX.COM'],
  ['CHECKCARD 0302 HLU*HULU 877-824-4858 CA 24692164062000000000000', 'HLU*HULU'],
  ['COMCAST CABLE COMM DES:CABLE PYMT ID:8771234567 INDN:JANE DOE CO ID:1234567890 WEB', 'COMCAST CABLE COMM'],
  ['DEBIT PURCHASE -VISA NETFLIX.COM 866-579-7172 CA', 'NETFLIX.COM'],
  ['WEB AUTHORIZED PMT COMCAST', 'COMCAST'],
  ['TST* TOASTY GRILL 04/12 #2231', 'TOASTY GRILL'],
  ['AUDIBLE*AB1CD2EF3 AMZN.COM/BILL WA', 'AUDIBLE AMZN.COM'],
  ['NYTIMES*NYTIMES.COM 800-698-4637 NY', 'NYTIMES*NYTIMES.COM'],
  ['Recurring Card Purchase 03/02 NETFLIX.COM 866-579-7172 CA Card 4412', 'NETFLIX.COM'],
  ['SPOTIFY P3F8A2B91C STOCKHOLM SE', 'SPOTIFY STOCKHOLM'],
  ['AplPay SQ *IRON FORGE FITNESS BOSTON MA', 'IRON FORGE FITNESS BOSTON'],
  ['ORIG CO NAME:COMCAST CABLE ORIG ID:1234567 DESC DATE: CO ENTRY DESCR:CABLE SEC:PPD', 'COMCAST CABLE'],
];

describe('normalizeDescriptor', () => {
  for (const [raw, want] of PAIRS) {
    it(`${raw} -> ${want}`, () => {
      expect(normalizeDescriptor(raw)).toBe(want);
    });
  }

  it('is idempotent on its own output', () => {
    for (const [, want] of PAIRS) expect(normalizeDescriptor(want)).toBe(want);
  });

  it('never returns empty for a non-empty descriptor', () => {
    expect(normalizeDescriptor('1234 5678')).not.toBe('');
    expect(normalizeDescriptor('   ')).toBe('');
  });

  it('keeps 1PASSWORD and 7-ELEVEN style names intact', () => {
    expect(normalizeDescriptor('1PASSWORD 855-123-4567 CA')).toBe('1PASSWORD');
    expect(normalizeDescriptor('24 HOUR FITNESS 800-432-6348 CA')).toBe('24 HOUR FITNESS');
  });

  it('strips URL paths but keeps the domain', () => {
    expect(normalizeDescriptor('NETFLIX.COM/ACCOUNT/BILLING')).toBe('NETFLIX.COM');
  });

  it('strips phone number shapes', () => {
    expect(normalizeDescriptor('ACME GYM (617) 555-0142 MA')).toBe('ACME GYM');
    expect(normalizeDescriptor('ACME GYM 617.555.0142')).toBe('ACME GYM');
    expect(normalizeDescriptor('ACME GYM +44 20 7946 0958 GB')).toBe('ACME GYM');
  });
});

describe('merchantKey and bundleOf', () => {
  it('keys on the first three tokens', () => {
    expect(merchantKey('IRON FORGE FITNESS BOSTON')).toBe('IRON FORGE FITNESS');
    expect(merchantKey('NETFLIX.COM')).toBe('NETFLIX.COM');
  });
  it('flags Apple and Google bundles', () => {
    expect(bundleOf('APPLE.COM/BILL')).toBe('apple');
    expect(bundleOf('GOOGLE *YOUTUBE')).toBe('google');
    expect(bundleOf('GOOGLE*CALM')).toBe('google');
    expect(bundleOf('NETFLIX.COM')).toBeNull();
  });
});
