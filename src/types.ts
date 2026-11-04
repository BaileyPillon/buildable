export type Txn = {
  date: string;            // YYYY-MM-DD
  description: string;     // raw descriptor as exported
  amount: number;          // POSITIVE = money out (a charge). Negative = money in (refund, payment, deposit)
  source?: string;         // file name
};

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual';

export type RecurringSeries = {
  key: string;                       // stable id: merchant id if KB-matched, else normalized key + amount cluster
  displayName: string;
  descriptors: string[];             // distinct raw descriptors seen, max 5
  cadence: Cadence;
  charges: { date: string; amount: number }[];   // ascending by date
  currentAmount: number;             // most recent charge
  annualCost: number;                // currentAmount * periods per year
  firstSeen: string;
  lastSeen: string;
  active: boolean;                   // lastSeen >= statementEnd - 1.5 * cadence days
  priceChanges: { date: string; from: number; to: number }[];
  confidence: number;                // 0..1
  merchantId: string | null;         // KB match, if any
  candidates?: string[];             // merchant ids, for ambiguous bundles (APPLE.COM/BILL, GOOGLE *)
};

export type Verdict = 'absorb' | 'rebuild' | 'selfhost' | 'haggle' | 'rotate' | 'cancel' | 'keep';

export type Category =
  | 'ai' | 'productivity' | 'health-family' | 'storage-security-home'
  | 'streaming-media' | 'telecom-utilities-finance' | 'software-learning' | 'shopping-news-social';

export type Device =
  | 'old-laptop' | 'spare-pc' | 'raspberry-pi' | 'nas' | 'old-android' | 'old-iphone' | 'old-ipad' | 'kindle';

export type Merchant = {
  id: string;                        // kebab-case, unique
  name: string;                      // "Netflix"
  category: Category;
  url: string;                       // official site
  match: {
    patterns: string[];              // case-insensitive RegExp sources, tested against the NORMALIZED descriptor
    examples: string[];              // 2-4 realistic raw statement descriptors (used for collision tests)
    billedVia?: 'direct' | 'apple' | 'google' | 'paypal' | 'amazon';
    priceHints?: { amount: number; cadence: Cadence; plan: string }[];   // US prices, used for APPLE.COM/BILL disambiguation
  };
  typicalMonthly: number | null;     // USD, most common US plan
  pricesCheckedAt: string;           // 'YYYY-MM'
  verdict: Verdict;                  // primary recommendation
  also?: Verdict[];                  // secondary options worth showing
  why: string;                       // <= 220 chars, plain reasoning for the primary verdict
  alternatives?: { name: string; url: string; note: string }[];  // free or cheaper swaps
  plans: {
    absorb?: { claudeDoes: string; howTo: string; limits: string; prompt: string };
    rebuild?: { whatYouBuild: string; hours: number; runsOn: string; ongoingCostYear: number; youLose: string; prompt: string };
    selfhost?: { software: string[]; hardware: Device[]; hours: number; powerCostYear: number; youLose: string; prompt: string };
    haggle?: { leverage: string; script: string; expectedDiscountPct: [number, number]; bestTime: string };
    rotate?: { pattern: string; monthsOffPerYear: number };
    cancel: { howTo: string; url?: string; gotchas?: string };   // ALWAYS present
  };
  sources: string[];                 // URLs backing prices, cancel steps, feature claims
};

export type Context = {
  claudePlan: 'none' | 'pro' | 'max';
  devices: Device[];
  unused: string[];                  // series keys the user flagged "barely use this"
  hourlyValue: number;               // $/hour the user values their time; default 25
  verdictOverrides: Record<string, Verdict>;   // series key -> verdict chosen by user
  merchantOverrides: Record<string, string>;   // series key -> merchant id (picked from candidates)
};

export type Assessment = {
  series: RecurringSeries;
  merchant: Merchant | null;
  verdict: Verdict;
  savingsYear: number;               // first-year USD saved if the user follows the verdict
  hours: number;                     // effort, hours (0 for keep/cancel, ~0.5 for haggle, plan hours otherwise)
  roiPerHour: number | null;         // savingsYear / hours, null if hours == 0
  blocked?: string;                  // e.g. "Needs an old laptop, Raspberry Pi or NAS"
  reason: string;                    // one sentence shown on the card
};

export type Summary = {
  statementStart: string; statementEnd: string;
  totalYear: number;                 // all ACTIVE recurring series
  byVerdict: Record<Verdict, { count: number; costYear: number; savingsYear: number }>;
  savingsYear: number;               // sum of unblocked savings
  buildHours: number;                // hours for absorb + rebuild + selfhost items
  claudeCostYear: number;            // added cost if claudePlan === 'none' and any absorb verdicts are counted (Pro, annual)
  netSavingsYear: number;            // savingsYear - claudeCostYear
};
