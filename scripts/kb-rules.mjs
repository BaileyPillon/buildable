// Shared knowledge-base validation rules for Buildable.
// Used by scripts/validate-kb.mjs and scripts/merge-kb.mjs (and scripts/kb-rules.selftest.mjs).
// The rules mirror SPEC.md "Shared types" (Merchant) and "Knowledge base policy".
// Pure Node, no dependencies.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CATEGORIES_DIR = path.join(ROOT, 'src', 'kb', 'categories');
export const MERGED_FILE = path.join(ROOT, 'src', 'kb', 'merchants.json');

export const CATEGORIES = [
  'ai',
  'productivity',
  'health-family',
  'storage-security-home',
  'streaming-media',
  'telecom-utilities-finance',
  'software-learning',
  'shopping-news-social',
];
export const VERDICTS = ['absorb', 'rebuild', 'selfhost', 'haggle', 'rotate', 'cancel', 'keep'];
export const DEVICES = [
  'old-laptop',
  'spare-pc',
  'raspberry-pi',
  'nas',
  'old-android',
  'old-iphone',
  'old-ipad',
  'kindle',
];
export const CADENCES = ['weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'annual'];
export const BILLED_VIA = ['direct', 'apple', 'google', 'paypal', 'amazon'];
/** Verdicts that need their own entry in `plans` (cancel is always required; keep has no plan). */
export const PLAN_VERDICTS = ['absorb', 'rebuild', 'selfhost', 'haggle', 'rotate'];

/** Names/ids matching this may never be rebuild/selfhost (primary or also). Policy: SPEC "Knowledge base policy". */
export const SENSITIVE_RE =
  /password|1password|lastpass|dashlane|bitwarden|lifelock|aura|norton|mcafee|identity|insurance|geico|progressive|allstate|state-farm|lemonade|usaa|adt|simplisafe|vivint/i;

export const MAX_WHY_CHARS = 220;
export const MIN_PROMPT_WORDS = 80;
export const MAX_PROMPT_WORDS = 180;
export const MAX_HAGGLE_SCRIPT_WORDS = 120;
export const MIN_LITERAL_CHARS = 4;

const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const TOP_KEYS = [
  'id', 'name', 'category', 'url', 'match', 'typicalMonthly', 'pricesCheckedAt',
  'verdict', 'also', 'why', 'alternatives', 'plans', 'sources',
];
const MATCH_KEYS = ['patterns', 'examples', 'billedVia', 'priceHints'];
const PLAN_KEYS = {
  absorb: ['claudeDoes', 'howTo', 'limits', 'prompt'],
  rebuild: ['whatYouBuild', 'hours', 'runsOn', 'ongoingCostYear', 'youLose', 'prompt'],
  selfhost: ['software', 'hardware', 'hours', 'powerCostYear', 'youLose', 'prompt'],
  haggle: ['leverage', 'script', 'expectedDiscountPct', 'bestTime'],
  rotate: ['pattern', 'monthsOffPerYear'],
  cancel: ['howTo', 'url', 'gotchas'],
};

// ---------------------------------------------------------------------------------------------
// Small helpers

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function isHttpsUrl(u) {
  if (typeof u !== 'string') return false;
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
}

export function wordCount(s) {
  return typeof s === 'string' ? s.trim().split(/\s+/).filter(Boolean).length : 0;
}

/** The simple normalization used by the collision test: uppercase, collapse whitespace. */
export function simpleNormalize(s) {
  return String(s).toUpperCase().replace(/\s+/g, ' ').trim();
}

/**
 * Minimum number of non-space LITERAL characters any match of the regex source must contain.
 * Character classes, `.`, `\d`, `\w`, `\s`, anchors and lookarounds count 0; escaped punctuation
 * (`\.`, `\*`) counts 1; alternation takes the minimum branch; quantifiers multiply by their minimum.
 * "MAX" -> 3 (too broad), "MAX\.COM|HBO ?MAX" -> 6, "HLU\*?HULU|^HULU" -> 4.
 */
export function minLiteralChars(source) {
  const src = String(source);
  const n = src.length;
  let i = 0;

  const parseDisjunction = () => {
    let min = Infinity;
    for (;;) {
      min = Math.min(min, parseSequence());
      if (src[i] === '|') {
        i++;
        continue;
      }
      return min;
    }
  };

  const parseSequence = () => {
    let total = 0;
    while (i < n && src[i] !== '|' && src[i] !== ')') {
      const atom = parseAtom();
      const reps = parseQuantifier();
      total += atom * reps;
    }
    return total;
  };

  const parseQuantifier = () => {
    const c = src[i];
    let reps = 1;
    if (c === '*' || c === '?') {
      reps = 0;
      i++;
    } else if (c === '+') {
      reps = 1;
      i++;
    } else if (c === '{') {
      const m = /^\{(\d+)(?:,(\d*))?\}/.exec(src.slice(i));
      if (!m) return 1; // a lone "{" is a literal; parseAtom handles it next
      reps = Number(m[1]);
      i += m[0].length;
    } else {
      return 1;
    }
    if (src[i] === '?') i++; // lazy modifier
    return reps;
  };

  const parseAtom = () => {
    const c = src[i];
    if (c === '(') {
      i++;
      let zero = false;
      if (src[i] === '?') {
        const rest = src.slice(i, i + 4);
        if (rest.startsWith('?:')) {
          i += 2;
        } else if (rest.startsWith('?=') || rest.startsWith('?!')) {
          zero = true;
          i += 2;
        } else if (rest.startsWith('?<=') || rest.startsWith('?<!')) {
          zero = true;
          i += 3;
        } else if (rest.startsWith('?<')) {
          const end = src.indexOf('>', i);
          i = end === -1 ? n : end + 1;
        } else {
          const end = src.indexOf(':', i); // inline modifiers such as (?i:...)
          i = end === -1 ? n : end + 1;
        }
      }
      const inner = parseDisjunction();
      if (src[i] === ')') i++;
      return zero ? 0 : inner;
    }
    if (c === '[') {
      i++;
      if (src[i] === '^') i++;
      while (i < n && src[i] !== ']') i += src[i] === '\\' ? 2 : 1;
      i++;
      return 0;
    }
    if (c === '\\') {
      const e = src[i + 1];
      if (e === undefined) {
        i++;
        return 0;
      }
      if ('dDwWsSbBtrnfv0'.includes(e)) {
        i += 2;
        return 0;
      }
      if (/[1-9]/.test(e)) {
        i++;
        while (/\d/.test(src[i] ?? '')) i++;
        return 0;
      }
      if (e === 'k') {
        const end = src.indexOf('>', i);
        i = end === -1 ? n : end + 1;
        return 0;
      }
      if (e === 'p' || e === 'P') {
        i += 2;
        if (src[i] === '{') {
          const end = src.indexOf('}', i);
          i = end === -1 ? n : end + 1;
        }
        return 0;
      }
      if (e === 'c') {
        i += 3;
        return 0;
      }
      if (e === 'x') {
        i += 4;
        return 1;
      }
      if (e === 'u') {
        if (src[i + 2] === '{') {
          const end = src.indexOf('}', i);
          i = end === -1 ? n : end + 1;
        } else {
          i += 6;
        }
        return 1;
      }
      i += 2;
      return /\s/.test(e) ? 0 : 1; // escaped punctuation is a literal
    }
    if (c === '.' || c === '^' || c === '$') {
      i++;
      return 0;
    }
    i++;
    return /\s/.test(c) ? 0 : 1;
  };

  const result = parseDisjunction();
  return Number.isFinite(result) ? result : 0;
}

// ---------------------------------------------------------------------------------------------
// Per-merchant checks

function checkMerchant(m, expectedCategory, err, warn) {
  if (!isObj(m)) {
    err('entry is not a JSON object');
    return;
  }

  for (const k of Object.keys(m)) {
    if (!TOP_KEYS.includes(k)) warn(`unknown field "${k}" (typo?)`);
  }

  // --- identity -----------------------------------------------------------------------------
  if (!isStr(m.id)) err('id must be a non-empty string');
  else if (!KEBAB_RE.test(m.id)) err(`id "${m.id}" must be kebab-case (lowercase letters, digits, hyphens)`);
  if (!isStr(m.name)) err('name must be a non-empty string');
  if (!CATEGORIES.includes(m.category)) {
    err(`category "${m.category}" is not one of: ${CATEGORIES.join(', ')}`);
  } else if (expectedCategory && m.category !== expectedCategory) {
    warn(`category "${m.category}" does not match its file name (${expectedCategory}.json)`);
  }
  if (!isHttpsUrl(m.url)) err(`url must be an https URL (got ${JSON.stringify(m.url)})`);

  // --- match --------------------------------------------------------------------------------
  const match = m.match;
  if (!isObj(match)) {
    err('match must be an object with patterns and examples');
  } else {
    for (const k of Object.keys(match)) {
      if (!MATCH_KEYS.includes(k)) warn(`unknown field "match.${k}" (typo?)`);
    }
    if (!Array.isArray(match.patterns) || match.patterns.length === 0) {
      err('match.patterns must be a non-empty array of strings');
    }
    if (!Array.isArray(match.examples) || match.examples.length === 0) {
      err('match.examples must be a non-empty array of strings (2-4 realistic raw descriptors)');
    } else if (match.examples.length < 2 || match.examples.length > 4) {
      warn(`match.examples has ${match.examples.length} entries; the spec asks for 2-4`);
    }
    if (match.billedVia !== undefined && !BILLED_VIA.includes(match.billedVia)) {
      err(`match.billedVia "${match.billedVia}" is not one of: ${BILLED_VIA.join(', ')}`);
    }
    if (match.priceHints !== undefined) {
      if (!Array.isArray(match.priceHints)) {
        err('match.priceHints must be an array of { amount, cadence, plan }');
      } else {
        match.priceHints.forEach((h, i) => {
          if (!isObj(h)) return err(`match.priceHints[${i}] must be an object`);
          if (!isNum(h.amount) || h.amount <= 0) err(`match.priceHints[${i}].amount must be a positive number`);
          if (!CADENCES.includes(h.cadence)) err(`match.priceHints[${i}].cadence "${h.cadence}" is not one of: ${CADENCES.join(', ')}`);
          if (!isStr(h.plan)) err(`match.priceHints[${i}].plan must be a non-empty string`);
        });
      }
    }
  }

  // --- pricing / dates ----------------------------------------------------------------------
  if (m.typicalMonthly !== null && !(isNum(m.typicalMonthly) && m.typicalMonthly >= 0)) {
    err(`typicalMonthly must be a number >= 0 or null (got ${JSON.stringify(m.typicalMonthly)})`);
  }
  if (typeof m.pricesCheckedAt !== 'string' || !MONTH_RE.test(m.pricesCheckedAt)) {
    err(`pricesCheckedAt must be YYYY-MM (got ${JSON.stringify(m.pricesCheckedAt)})`);
  }

  // --- verdicts -----------------------------------------------------------------------------
  const verdictOk = VERDICTS.includes(m.verdict);
  if (!verdictOk) err(`verdict "${m.verdict}" is not one of: ${VERDICTS.join(', ')}`);
  let also = [];
  if (m.also !== undefined) {
    if (!Array.isArray(m.also)) {
      err('also must be an array of verdicts');
    } else {
      also = m.also.filter((v) => {
        if (VERDICTS.includes(v)) return true;
        err(`also contains "${v}", which is not one of: ${VERDICTS.join(', ')}`);
        return false;
      });
      if (new Set(also).size !== also.length) warn('also contains duplicate verdicts');
      if (verdictOk && also.includes(m.verdict)) warn(`also repeats the primary verdict "${m.verdict}"`);
    }
  }

  // --- why ----------------------------------------------------------------------------------
  if (!isStr(m.why)) err('why must be a non-empty string');
  else if (m.why.length > MAX_WHY_CHARS) err(`why is ${m.why.length} chars; the limit is ${MAX_WHY_CHARS}`);

  // --- alternatives -------------------------------------------------------------------------
  if (m.alternatives !== undefined) {
    if (!Array.isArray(m.alternatives)) {
      err('alternatives must be an array of { name, url, note }');
    } else {
      m.alternatives.forEach((a, i) => {
        if (!isObj(a)) return err(`alternatives[${i}] must be an object`);
        if (!isStr(a.name)) err(`alternatives[${i}].name must be a non-empty string`);
        if (!isHttpsUrl(a.url)) err(`alternatives[${i}].url must be an https URL`);
        if (!isStr(a.note)) err(`alternatives[${i}].note must be a non-empty string`);
      });
    }
  }

  // --- plans --------------------------------------------------------------------------------
  const plans = m.plans;
  if (!isObj(plans)) {
    err('plans must be an object (plans.cancel is required)');
  } else {
    for (const k of Object.keys(plans)) {
      if (!(k in PLAN_KEYS)) warn(`unknown plan "plans.${k}" (typo?)`);
    }
    const checkKeys = (plan, name) => {
      for (const k of Object.keys(plan)) {
        if (!PLAN_KEYS[name].includes(k)) warn(`unknown field "plans.${name}.${k}" (typo?)`);
      }
    };
    const reqStr = (plan, name, key) => {
      if (!isStr(plan[key])) err(`plans.${name}.${key} must be a non-empty string`);
    };
    const checkPrompt = (plan, name) => {
      if (!isStr(plan.prompt)) return err(`plans.${name}.prompt must be a non-empty string`);
      const w = wordCount(plan.prompt);
      if (w < MIN_PROMPT_WORDS || w > MAX_PROMPT_WORDS) {
        err(`plans.${name}.prompt is ${w} words; it must be ${MIN_PROMPT_WORDS}-${MAX_PROMPT_WORDS}`);
      }
    };

    // cancel (always required)
    if (!isObj(plans.cancel)) {
      err('plans.cancel is required (an object with howTo)');
    } else {
      checkKeys(plans.cancel, 'cancel');
      reqStr(plans.cancel, 'cancel', 'howTo');
      if (plans.cancel.url !== undefined && !isHttpsUrl(plans.cancel.url)) err('plans.cancel.url must be an https URL when present');
      if (plans.cancel.gotchas !== undefined && !isStr(plans.cancel.gotchas)) err('plans.cancel.gotchas must be a non-empty string when present');
    }

    if (plans.absorb !== undefined) {
      const p = plans.absorb;
      if (!isObj(p)) err('plans.absorb must be an object');
      else {
        checkKeys(p, 'absorb');
        for (const k of ['claudeDoes', 'howTo', 'limits']) reqStr(p, 'absorb', k);
        checkPrompt(p, 'absorb');
      }
    }

    if (plans.rebuild !== undefined) {
      const p = plans.rebuild;
      if (!isObj(p)) err('plans.rebuild must be an object');
      else {
        checkKeys(p, 'rebuild');
        for (const k of ['whatYouBuild', 'runsOn', 'youLose']) reqStr(p, 'rebuild', k);
        if (!isNum(p.hours) || p.hours < 1 || p.hours > 12) {
          err(`plans.rebuild.hours must be a number from 1 to 12 (got ${JSON.stringify(p.hours)})`);
        }
        if (!isNum(p.ongoingCostYear) || p.ongoingCostYear < 0) err('plans.rebuild.ongoingCostYear must be a number >= 0');
        checkPrompt(p, 'rebuild');
      }
    }

    if (plans.selfhost !== undefined) {
      const p = plans.selfhost;
      if (!isObj(p)) err('plans.selfhost must be an object');
      else {
        checkKeys(p, 'selfhost');
        reqStr(p, 'selfhost', 'youLose');
        if (!Array.isArray(p.software) || p.software.length === 0 || !p.software.every(isStr)) {
          err('plans.selfhost.software must be a non-empty array of strings');
        }
        if (!Array.isArray(p.hardware) || p.hardware.length === 0) {
          err('plans.selfhost.hardware must be a non-empty array of devices');
        } else {
          for (const d of p.hardware) {
            if (!DEVICES.includes(d)) err(`plans.selfhost.hardware contains "${d}", which is not one of: ${DEVICES.join(', ')}`);
          }
        }
        if (!isNum(p.hours) || p.hours <= 0) err('plans.selfhost.hours must be a positive number');
        if (!isNum(p.powerCostYear) || p.powerCostYear < 0) err('plans.selfhost.powerCostYear must be a number >= 0');
        checkPrompt(p, 'selfhost');
      }
    }

    if (plans.haggle !== undefined) {
      const p = plans.haggle;
      if (!isObj(p)) err('plans.haggle must be an object');
      else {
        checkKeys(p, 'haggle');
        for (const k of ['leverage', 'script', 'bestTime']) reqStr(p, 'haggle', k);
        const d = p.expectedDiscountPct;
        if (!Array.isArray(d) || d.length !== 2 || !d.every(isNum)) {
          err('plans.haggle.expectedDiscountPct must be a [low, high] pair of numbers');
        } else if (d[0] < 0 || d[1] > 60 || d[0] > d[1]) {
          err(`plans.haggle.expectedDiscountPct must be ascending within 0..60 (got [${d[0]}, ${d[1]}])`);
        } else if (d[0] === d[1]) {
          warn('plans.haggle.expectedDiscountPct low and high are equal; give a range');
        }
        if (isStr(p.script) && wordCount(p.script) > MAX_HAGGLE_SCRIPT_WORDS) {
          warn(`plans.haggle.script is ${wordCount(p.script)} words; the spec asks for <= ${MAX_HAGGLE_SCRIPT_WORDS}`);
        }
      }
    }

    if (plans.rotate !== undefined) {
      const p = plans.rotate;
      if (!isObj(p)) err('plans.rotate must be an object');
      else {
        checkKeys(p, 'rotate');
        reqStr(p, 'rotate', 'pattern');
        if (!isNum(p.monthsOffPerYear) || p.monthsOffPerYear < 0 || p.monthsOffPerYear > 12) {
          err('plans.rotate.monthsOffPerYear must be a number from 0 to 12');
        }
      }
    }

    // The plan for the primary verdict, and for every "also" verdict, must exist.
    if (verdictOk && PLAN_VERDICTS.includes(m.verdict) && !isObj(plans[m.verdict])) {
      err(`verdict "${m.verdict}" requires plans.${m.verdict}`);
    }
    for (const v of also) {
      if (PLAN_VERDICTS.includes(v) && !isObj(plans[v])) err(`also "${v}" requires plans.${v}`);
    }
    const offered = new Set([...(verdictOk ? [m.verdict] : []), ...also]);
    for (const k of PLAN_VERDICTS) {
      if (plans[k] !== undefined && !offered.has(k)) warn(`plans.${k} is defined but neither verdict nor also offers "${k}"`);
    }
  }

  // --- sources ------------------------------------------------------------------------------
  if (!Array.isArray(m.sources) || m.sources.length === 0) {
    err('sources must be a non-empty array of https URLs');
  } else {
    m.sources.forEach((u, i) => {
      if (!isHttpsUrl(u)) err(`sources[${i}] must be an https URL (got ${JSON.stringify(u)})`);
    });
  }

  // --- policy: forbidden verdicts ----------------------------------------------------------
  const offeredAll = [...(verdictOk ? [m.verdict] : []), ...also];
  const buildish = offeredAll.filter((v) => v === 'rebuild' || v === 'selfhost');
  if (m.category === 'streaming-media' && buildish.length > 0) {
    err(`policy: streaming-media may not offer ${buildish.join('/')} (licensed content catalogs: keep or rotate)`);
  }
  if (buildish.length > 0 && SENSITIVE_RE.test(`${m.id ?? ''} ${m.name ?? ''}`)) {
    err(
      `policy: "${m.name ?? m.id}" looks like a password manager / identity / insurance / home-security service ` +
        `and may not offer ${buildish.join('/')}`,
    );
  }

  // --- tone ---------------------------------------------------------------------------------
  const toneStrings = [['why', m.why]];
  if (isObj(plans)) {
    for (const [name, plan] of Object.entries(plans)) {
      if (!isObj(plan)) continue;
      for (const [k, v] of Object.entries(plan)) {
        if (k !== 'prompt' && typeof v === 'string') toneStrings.push([`plans.${name}.${k}`, v]);
      }
    }
  }
  for (const [where, text] of toneStrings) {
    if (typeof text === 'string' && text.includes('!')) warn(`${where} contains an exclamation mark (tone: plain, no hype)`);
  }
}

/** Compile patterns and check them in isolation. Returns the usable regexes. */
function checkPatterns(m, err, warn) {
  const regexes = [];
  const patterns = isObj(m.match) && Array.isArray(m.match.patterns) ? m.match.patterns : [];
  const seen = new Set();
  patterns.forEach((p, i) => {
    const label = `match.patterns[${i}] /${p}/`;
    if (!isStr(p)) return err(`match.patterns[${i}] must be a non-empty string`);
    if (seen.has(p)) warn(`${label} is listed twice`);
    seen.add(p);
    let re;
    try {
      re = new RegExp(p, 'i');
    } catch (e) {
      return err(`${label} does not compile as a case-insensitive RegExp: ${e.message}`);
    }
    regexes.push({ source: p, re });
    if (re.test('')) {
      err(`${label} matches the empty string`);
    } else {
      const lit = minLiteralChars(p);
      if (lit < MIN_LITERAL_CHARS) {
        err(`${label} can match with only ${lit} non-space literal chars (need >= ${MIN_LITERAL_CHARS}): too broad`);
      }
    }
  });
  return regexes;
}

// ---------------------------------------------------------------------------------------------
// Whole-KB validation

/**
 * @param {{ targets: {file: string, merchants?: unknown, loadError?: string, expectedCategory?: string}[],
 *           context?: {file: string, merchants?: unknown}[] }} input
 *   targets: files to validate and report on. context: other files used only for id uniqueness and
 *   pattern-collision checks (their own problems are not reported).
 * @returns {{ errors: Issue[], warnings: Issue[], merchantCount: number, fileCount: number }}
 *   Issue = { file, id, message }
 */
export function validateKb({ targets, context = [] }) {
  const errors = [];
  const warnings = [];
  const push = (list, file, id, message) => list.push({ file, id, message });

  /** Every merchant that takes part in uniqueness/collision checks. */
  const all = [];
  const entriesOf = (f) => (Array.isArray(f.merchants) ? f.merchants : []);

  for (const f of context) {
    entriesOf(f).forEach((m, idx) => all.push({ m, file: f.file, idx, isTarget: false }));
  }
  let merchantCount = 0;
  for (const f of targets) {
    if (f.loadError) {
      push(errors, f.file, '-', f.loadError);
      continue;
    }
    if (!Array.isArray(f.merchants)) {
      push(errors, f.file, '-', 'top level must be a JSON array of Merchant objects');
      continue;
    }
    f.merchants.forEach((m, idx) => all.push({ m, file: f.file, idx, isTarget: true, expectedCategory: f.expectedCategory }));
    merchantCount += f.merchants.length;
  }

  // Per-merchant checks (targets only) + compile patterns for everyone.
  const firstSeen = new Map(); // id -> file
  for (const rec of all) {
    const { m, file, idx } = rec;
    const id = isObj(m) && typeof m.id === 'string' ? m.id : `#${idx}`;
    rec.id = id;
    const err = (msg) => push(errors, file, id, msg);
    const warn = (msg) => push(warnings, file, id, msg);

    if (rec.isTarget) {
      checkMerchant(m, rec.expectedCategory, err, warn);
      if (isObj(m) && typeof m.id === 'string') {
        if (firstSeen.has(m.id)) err(`duplicate id: already defined in ${firstSeen.get(m.id)}`);
      }
      rec.regexes = isObj(m) ? checkPatterns(m, err, warn) : [];
    } else {
      rec.regexes = [];
      if (isObj(m) && isObj(m.match) && Array.isArray(m.match.patterns)) {
        for (const p of m.match.patterns) {
          try {
            rec.regexes.push({ source: p, re: new RegExp(p, 'i') });
          } catch {
            /* the context file's owner reports this */
          }
        }
      }
    }
    if (isObj(m) && typeof m.id === 'string' && !firstSeen.has(m.id)) firstSeen.set(m.id, file);

    rec.examples =
      isObj(m) && isObj(m.match) && Array.isArray(m.match.examples)
        ? m.match.examples.filter(isStr).map((raw) => ({ raw, norm: simpleNormalize(raw) }))
        : [];
  }

  // Each example must be matched by its own merchant's patterns.
  for (const rec of all) {
    if (!rec.isTarget || rec.regexes.length === 0) continue;
    for (const ex of rec.examples) {
      if (!rec.regexes.some(({ re }) => re.test(ex.norm))) {
        push(errors, rec.file, rec.id, `example ${JSON.stringify(ex.raw)} (as "${ex.norm}") is not matched by this merchant's own patterns`);
      }
    }
  }

  // No example may be matched by ANY other merchant's patterns (across all files).
  for (const a of all) {
    if (a.examples.length === 0) continue;
    for (const b of all) {
      if (a === b || b.regexes.length === 0) continue;
      if (!a.isTarget && !b.isTarget) continue; // both only context: not our report
      if (a.id === b.id) continue; // duplicate ids are reported separately
      for (const ex of a.examples) {
        for (const { source, re } of b.regexes) {
          if (!re.test(ex.norm)) continue;
          const owner = b.isTarget ? b : a;
          push(
            errors,
            owner.file,
            owner.id,
            `collision: pattern /${source}/ of "${b.id}" (${b.file}) matches example ${JSON.stringify(ex.raw)} of "${a.id}" (${a.file})`,
          );
        }
      }
    }
  }

  return { errors, warnings, merchantCount, fileCount: targets.length };
}

// ---------------------------------------------------------------------------------------------
// File loading and reporting (shared by the CLI scripts)

export function relLabel(abs) {
  const rel = path.relative(ROOT, abs);
  return (rel.startsWith('..') || path.isAbsolute(rel) ? abs : rel).split(path.sep).join('/');
}

export function loadKbFile(abs) {
  const file = relLabel(abs);
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    return { file, abs, loadError: `cannot read file: ${e.message}` };
  }
  try {
    const merchants = JSON.parse(text.replace(/^﻿/, ''));
    const base = path.basename(abs, '.json');
    const inCategories = path.dirname(abs) === CATEGORIES_DIR;
    return { file, abs, merchants, expectedCategory: inCategories ? base : undefined };
  } catch (e) {
    return { file, abs, loadError: `invalid JSON: ${e.message}` };
  }
}

/** Absolute paths of src/kb/categories/*.json, sorted. */
export function categoryFiles() {
  if (!fs.existsSync(CATEGORIES_DIR)) return [];
  return fs
    .readdirSync(CATEGORIES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(CATEGORIES_DIR, f));
}

/**
 * Work out what validate-kb should check.
 * - explicit files: those are the targets; the remaining category files are loaded as context
 *   (so a single category can be checked against all the others) unless `isolated` is set
 *   or the merged file is itself a target.
 * - no files: all category files, else the merged merchants.json.
 */
export function resolveInputs({ args = [], isolated = false } = {}) {
  if (args.length > 0) {
    const abs = args.map((a) => path.resolve(process.cwd(), a));
    const targets = abs.map(loadKbFile);
    const mergedIsTarget = abs.some((a) => path.resolve(a) === MERGED_FILE);
    let context = [];
    if (!isolated && !mergedIsTarget) {
      const targetSet = new Set(abs.map((a) => path.resolve(a)));
      context = categoryFiles()
        .filter((f) => !targetSet.has(path.resolve(f)))
        .map(loadKbFile)
        .filter((f) => !f.loadError);
    }
    return { targets, context };
  }
  const cats = categoryFiles();
  if (cats.length > 0) return { targets: cats.map(loadKbFile), context: [] };
  if (fs.existsSync(MERGED_FILE)) return { targets: [loadKbFile(MERGED_FILE)], context: [] };
  return { targets: [], context: [] };
}

export function formatIssue(kind, { file, id, message }) {
  return `${kind}  ${file}  [${id}]  ${message}`;
}

/** Print errors and warnings; returns the number of errors. */
export function printReport(result, log = console.log) {
  for (const i of result.errors) log(formatIssue('ERROR', i));
  for (const i of result.warnings) log(formatIssue('WARN ', i));
  return result.errors.length;
}
