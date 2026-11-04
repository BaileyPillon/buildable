// Everything that produces text or files: copy, download, plan markdown, build kits, the
// "Ask Claude" prompt. All local; nothing is sent anywhere.
import type { Assessment, Context, Device, Verdict } from '../types';
import type { Derived } from './derive';
import { cadenceWord, fullDate, money, perCadence, rangeLabel, slug } from './format';
import { scrubbedDescriptors } from './scrub';
import { DEVICE_LABEL, VERDICT_LABEL, isBuild } from './verdicts';

// ---- clipboard + download ----

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(filename: string, text: string, mime = 'text/markdown'): void {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}

// ---- markdown helpers ----

function fence(text: string, lang = 'text'): string {
  const runs = text.match(/`+/g) ?? [];
  const longest = runs.reduce((n, r) => Math.max(n, r.length), 0);
  const ticks = '`'.repeat(Math.max(3, longest + 1));
  return `${ticks}${lang}\n${text}\n${ticks}`;
}

// control characters, DEL, and the Unicode line and paragraph separators; built from code points so the source stays plain ASCII
const CONTROL_CHARS = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]+`, 'g');

/** Text that came from the statement, as an inline code span: no HTML, links, headings or emphasis can get out of it. */
export function codeSpan(text: string): string {
  const flat = text.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim() || '-';
  const runs = flat.match(/`+/g) ?? [];
  const longest = runs.reduce((n, r) => Math.max(n, r.length), 0);
  const ticks = '`'.repeat(longest + 1);
  const pad = flat.startsWith('`') || flat.endsWith('`') ? ' ' : '';
  return `${ticks}${pad}${flat}${pad}${ticks}`;
}

/** A name for the export: catalog names are ours, anything else came from the statement. */
function exportName(a: Assessment): string {
  return a.merchant ? a.series.displayName : codeSpan(a.series.displayName);
}

/** "$29.99/mo, $359.88/yr" (or just "$359.88/yr" for an annual charge). No parentheses, so callers can add their own. */
function costPlain(a: Assessment): string {
  const yearly = `${money(a.series.annualCost, 'always')}/yr`;
  if (a.series.cadence === 'annual') return yearly;
  return `${perCadence(a.series.currentAmount, a.series.cadence)}, ${yearly}`;
}

/** "$29.99/mo ($359.88/yr)" */
function cost(a: Assessment): string {
  const yearly = `${money(a.series.annualCost, 'always')}/yr`;
  if (a.series.cadence === 'annual') return yearly;
  return `${perCadence(a.series.currentAmount, a.series.cadence)} (${yearly})`;
}

/** runsOn strings are sentences; strip the final period so the caller controls the punctuation. */
function noTrailingPeriod(s: string): string {
  return s.replace(/[.\s]+$/, '');
}

function deviceList(devices: Device[]): string {
  return devices.length ? devices.map((d) => DEVICE_LABEL[d]).join(', ') : 'none listed';
}

// ---- "Ask Claude about these" ----

/**
 * Only shortened descriptors, amounts and cadences. No dates, no account details, no other transactions.
 * Descriptors go through scrubDescriptor (phone numbers, card digits and reference ids removed). That cannot find
 * a person's name, which is why the page tells the user to read the prompt before pasting it.
 */
export function askClaudePrompt(items: Assessment[]): string {
  const lines = items.map((a, i) => {
    const shortened = scrubbedDescriptors(a.series.descriptors);
    const desc = (shortened.length ? shortened : scrubbedDescriptors([a.series.displayName])).join('  |  ');
    return `${i + 1}. "${desc}" - ${money(a.series.currentAmount, 'always')} ${cadenceWord(a.series.cadence)}`;
  });
  return [
    'These recurring charges appear on my bank statement and I could not identify them.',
    'For each one, tell me:',
    '- what service it most likely is (give your top two or three guesses if the descriptor is ambiguous, and what would settle it),',
    '- what that service usually costs and what it does,',
    '- whether Claude or Claude Code could replace it, and how,',
    '- how to cancel it, and any traps in the cancellation.',
    '',
    ...lines,
    '',
    'That is everything I am sharing: shortened descriptors, amounts and how often they bill. No account numbers, dates or other transactions.',
  ].join('\n');
}

// ---- build kit (CLAUDE.md-style brief + prompt) ----

export function buildKitFilename(a: Assessment): string {
  return `build-kit-${slug(a.merchant?.name ?? a.series.displayName)}.md`;
}

export function planPrompt(a: Assessment): string | null {
  const m = a.merchant;
  if (!m) return null;
  if (a.verdict === 'absorb') return m.plans.absorb?.prompt ?? null;
  if (a.verdict === 'rebuild') return m.plans.rebuild?.prompt ?? null;
  if (a.verdict === 'selfhost') return m.plans.selfhost?.prompt ?? null;
  return null;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

// What a kickoff prompt asks for decides which standing rules are safe to put in the CLAUDE.md. A CLAUDE.md is read as
// project rules, so a rule the prompt contradicts ("no third-party requests" next to a Cloudflare Worker that calls
// the Google Calendar API) is worse than no rule. The prompt always wins; the brief only adds what it cannot clash with.

/** Words that mean the build talks to a server, a third-party API or a service the user signs in to. */
const NETWORK_TERMS =
  /(?<!web |service )\bworkers?\b|\b(?:D1|R2|KV|FastAPI|Python|OAuth|Sheets|Calendar API|Resend|Open Food Facts|USDA|GitHub Actions|Wrangler|cron|webhooks?|email API|model downloads?|downloads? once)\b/i;
/** Storage that stays on the user's device. */
const ON_DEVICE = /\b(?:IndexedDB|localStorage|never leave the device)\b/i;

/** True when the plan is a local-first app, so "data stays on my device, no third-party requests" is accurate. */
export function isLocalFirst(runsOn: string, prompt: string): boolean {
  const text = `${runsOn}\n${prompt}`;
  return ON_DEVICE.test(text) && !NETWORK_TERMS.test(text);
}

function namesLanguage(prompt: string): boolean {
  return /\bTypeScript\b/i.test(prompt) && !/\bPython\b/i.test(prompt);
}

const PROMPT_WINS = 'Follow the stack and services named in the kickoff prompt. If this brief and the prompt disagree, the prompt wins.';

export function buildKit(a: Assessment, ctx: Context): string | null {
  const m = a.merchant;
  if (!m) return null;
  const name = m.name;
  const head = `# CLAUDE.md: ${name} replacement\n`;
  const foot = [
    '---',
    'Generated by Buildable, in the browser. The only things taken from the statement are the service name and what it costs.',
  ].join('\n');

  if (a.verdict === 'rebuild' && m.plans.rebuild) {
    const p = m.plans.rebuild;
    const local = isLocalFirst(p.runsOn, p.prompt);
    const offline = local || /\boffline\b/i.test(`${p.runsOn} ${p.prompt}`);
    const constraints = [
      `- Single user. Runs on: ${noTrailingPeriod(p.runsOn)}.`,
      `- Ongoing cost: ${money(p.ongoingCostYear)}/yr.`,
      local
        ? '- Data stays on my device. Export and import as JSON so I can leave at any time.'
        : '- Keep an export so I can leave at any time.',
      ...(local ? ['- No analytics, no third-party requests, no accounts.'] : []),
      `- ${PROMPT_WINS}`,
      ...(namesLanguage(p.prompt) ? ['- TypeScript, strict.'] : []),
      '- Small, readable code. Tests for the logic that matters.',
    ];
    return [
      head,
      '## Goal',
      `Replace ${name} (${costPlain(a)}) with ${lowerFirst(p.whatYouBuild)}`,
      '',
      '## Constraints',
      ...constraints,
      '',
      '## Known trade-offs',
      `- I give up: ${p.youLose}`,
      '',
      '## Definition of done',
      ...(offline ? ['- Core features work offline.'] : []),
      local
        ? '- One command runs it locally; the README explains a free deploy.'
        : '- The README explains how to set it up, how to run it, and what it costs to keep running, if anything.',
      '- My existing data can be imported if the old service offers an export.',
      '',
      '## Kickoff prompt',
      fence(p.prompt),
      '',
      foot,
      '',
    ].join('\n');
  }

  if (a.verdict === 'selfhost' && m.plans.selfhost) {
    const p = m.plans.selfhost;
    const owned = p.hardware.filter((d) => ctx.devices.includes(d));
    const hw = (owned.length ? owned : p.hardware).map((d) => DEVICE_LABEL[d]);
    const text = `${p.software.join(' ')} ${p.prompt}`;
    const portForward = /\bport[- ]forward/i.test(text);
    const docker = /\bDocker\b/i.test(text);
    const remote = portForward
      ? '- Remote access: the kickoff prompt calls for one UDP port forward (with Tailscale as the fallback if my ISP blocks it). Open no other router ports.'
      : /\bTailscale\b/i.test(text)
        ? '- Remote access through Tailscale; no router ports opened.'
        : '- Prefer Tailscale for remote access. If the kickoff prompt says otherwise, follow the prompt.';
    return [
      head,
      '## Goal',
      `Replace ${name} (${costPlain(a)}) with ${p.software.join(' + ')} running on hardware I already own.`,
      '',
      '## Hardware',
      `- ${owned.length ? 'Using' : 'Any of'}: ${hw.join(', ')}.`,
      `- Estimated power cost: ${money(p.powerCostYear)}/yr.`,
      '',
      '## Constraints',
      docker
        ? '- Use the official, maintained install method (Docker Compose where supported).'
        : '- Use the official, maintained install method.',
      remote,
      '- Back up to a separate drive on the schedule the kickoff prompt gives (nightly if it gives none), and test a restore.',
      '- Document every command so I can repeat it.',
      '- If this brief and the kickoff prompt disagree, the prompt wins.',
      '',
      '## Known trade-offs',
      `- I give up: ${p.youLose}`,
      '',
      '## Kickoff prompt',
      fence(p.prompt),
      '',
      foot,
      '',
    ].join('\n');
  }

  if (a.verdict === 'absorb' && m.plans.absorb) {
    const p = m.plans.absorb;
    return [
      head,
      '## Goal',
      `Stop paying for ${name} (${costPlain(a)}) by doing the job in Claude.`,
      '',
      '## What Claude does',
      p.claudeDoes,
      '',
      '## How',
      p.howTo,
      '',
      '## Limits',
      p.limits,
      '',
      '## Prompt',
      fence(p.prompt),
      '',
      foot,
      '',
    ].join('\n');
  }
  return null;
}

// ---- export my plan ----

function planSection(a: Assessment, rank: number | null): string[] {
  const m = a.merchant;
  const lines: string[] = [];
  const title = `${rank ? `${rank}. ` : ''}${exportName(a)}${m && m.name !== a.series.displayName ? ` (${m.name})` : ''}`;
  lines.push(`### ${title} - ${VERDICT_LABEL[a.verdict]}`);
  lines.push('');
  const facts = [`Costs ${cost(a)}`];
  if (a.verdict !== 'keep') facts.push(`saves ${money(a.savingsYear, 'never')}/yr`);
  if (a.hours > 0) facts.push(`${a.hours} hr`);
  if (a.roiPerHour !== null && isBuild(a.verdict)) {
    facts.push(`${money(a.roiPerHour, 'never')} saved per hour of building`);
  }
  lines.push(`- ${facts.join(' | ')}`);
  lines.push(`- Why: ${a.reason}`);
  if (a.blocked) lines.push(`- Blocked: ${a.blocked}`);
  if (!m) return [...lines, ''];

  const p = m.plans;
  if (a.verdict === 'absorb' && p.absorb) {
    lines.push(`- Claude does: ${p.absorb.claudeDoes}`);
    lines.push(`- How: ${p.absorb.howTo}`);
    lines.push(`- Limits: ${p.absorb.limits}`);
    lines.push('', '**Prompt for Claude**', '', fence(p.absorb.prompt));
  } else if (a.verdict === 'rebuild' && p.rebuild) {
    lines.push(`- You build: ${p.rebuild.whatYouBuild}`);
    lines.push(`- Runs on: ${noTrailingPeriod(p.rebuild.runsOn)}. Ongoing cost ${money(p.rebuild.ongoingCostYear)}/yr.`);
    lines.push(`- You lose: ${p.rebuild.youLose}`);
    lines.push('', '**Prompt for Claude Code**', '', fence(p.rebuild.prompt));
  } else if (a.verdict === 'selfhost' && p.selfhost) {
    lines.push(`- Software: ${p.selfhost.software.join(', ')}`);
    lines.push(`- Hardware that works: ${p.selfhost.hardware.map((d) => DEVICE_LABEL[d]).join(', ')}`);
    lines.push(`- Power: about ${money(p.selfhost.powerCostYear)}/yr`);
    lines.push(`- You lose: ${p.selfhost.youLose}`);
    lines.push('', '**Prompt for Claude Code**', '', fence(p.selfhost.prompt));
  } else if (a.verdict === 'haggle' && p.haggle) {
    lines.push(`- Leverage: ${p.haggle.leverage}`);
    lines.push(`- Best time: ${p.haggle.bestTime}`);
    lines.push(`- Expect: ${p.haggle.expectedDiscountPct[0]} to ${p.haggle.expectedDiscountPct[1]} percent off`);
    lines.push('', '**Script**', '', ...p.haggle.script.split('\n').map((l) => `> ${l}`));
  } else if (a.verdict === 'rotate' && p.rotate) {
    lines.push(`- Pattern: ${p.rotate.pattern}`);
    lines.push(`- Months off per year: ${p.rotate.monthsOffPerYear}`);
  } else if (a.verdict === 'cancel') {
    lines.push(`- How: ${p.cancel.howTo}`);
    if (p.cancel.url) lines.push(`- Link: ${p.cancel.url}`);
    if (p.cancel.gotchas) lines.push(`- Watch out: ${p.cancel.gotchas}`);
  }
  lines.push('');
  return lines;
}

export function planMarkdown(args: {
  derived: Derived;
  ctx: Context;
  start: string;
  end: string;
  fileCount: number;
}): string {
  const { derived: d, ctx, start, end, fileCount } = args;
  const t = d.totals;
  const out: string[] = [];
  out.push('# My Buildable plan', '');
  out.push(
    `Statement: ${rangeLabel(start, end)} (${fileCount} file${fileCount === 1 ? '' : 's'}). Generated ${fullDate(new Date().toISOString().slice(0, 10))}.`,
    '',
  );
  out.push('## Summary', '');
  out.push(
    `- Subscriptions found: ${t.activeCount}, costing ${money(t.totalYear, 'always')}/yr (${money(t.perMonth, 'always')}/mo)`,
  );
  out.push(`- Saved if I follow every verdict: ${money(t.savingsYear, 'never')}/yr`);
  if (t.claudeCostYear > 0) out.push(`- Less Claude Pro: ${money(t.claudeCostYear, 'never')}/yr`);
  out.push(`- I could keep: ${money(t.keepYear, 'never')}/yr`);
  out.push(`- Build time: about ${Math.round(t.buildHours * 10) / 10} hours`);
  out.push(
    `- Assumptions: Claude plan ${ctx.claudePlan}; devices: ${deviceList(ctx.devices)}; my time is worth ${money(ctx.hourlyValue, 'never')}/hr`,
    '',
  );

  if (d.queue.length) {
    out.push('## Build queue', '', 'Ranked by dollars saved per hour of building.', '');
    d.queue.forEach((a, i) => out.push(...planSection(a, i + 1)));
  }
  const labels: Record<string, string> = { haggle: 'Haggle', rotate: 'Rotate', cancel: 'Cancel', keep: 'Keep' };
  for (const g of d.groups) {
    out.push(`## ${labels[g.verdict] ?? g.verdict}`, '');
    g.items.forEach((a) => out.push(...planSection(a, null)));
  }
  if (d.needsPick.length) {
    out.push('## Which app is this?', '', 'Store-billed charges I still need to identify:', '');
    d.needsPick.forEach((a) => out.push(`- ${exportName(a)}: ${cost(a)}`));
    out.push('');
  }
  if (d.unrecognized.length) {
    out.push('## Unrecognized', '');
    d.unrecognized.forEach((a) =>
      out.push(`- ${codeSpan(scrubbedDescriptors(a.series.descriptors, 1)[0] ?? scrubbedDescriptors([a.series.displayName], 1)[0] ?? '-')}: ${cost(a)}`),
    );
    out.push('');
  }
  if (d.inactive.length) {
    out.push('## Already gone', '');
    d.inactive.forEach((a) =>
      out.push(`- ${exportName(a)}: last charged ${fullDate(a.series.lastSeen)}`),
    );
    out.push('');
  }
  out.push(
    '---',
    'Made with Buildable. Prices are US list prices at the time of checking. Not financial advice.',
    '',
  );
  return out.join('\n');
}

/** Verdicts the card can switch between: the merchant's primary plus its `also` list. */
export function verdictOptions(a: Assessment): Verdict[] {
  const m = a.merchant;
  if (!m) return [];
  return [m.verdict, ...(m.also ?? [])].filter(
    (v, i, arr) => arr.indexOf(v) === i && (v === 'keep' || Boolean(m.plans[v])),
  );
}
