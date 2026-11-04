// Self-test for scripts/kb-rules.mjs. Run: node scripts/kb-rules.selftest.mjs
// Uses two fake merchants (one valid, one whose pattern collides with the first) plus a few
// mutations of the valid one to prove each rule fires.

import assert from 'node:assert/strict';
import { validateKb, minLiteralChars, simpleNormalize } from './kb-rules.mjs';

let checks = 0;
const ok = (label) => {
  checks++;
  console.log(`ok - ${label}`);
};

const sentence = 'Use the files in this folder and keep every step small and testable.';
const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

/** A valid fake merchant (rotate verdict, so no long prompt is needed). */
const fakeflix = () => ({
  id: 'fakeflix',
  name: 'FakeFlix',
  category: 'streaming-media',
  url: 'https://fakeflix.example/',
  match: { patterns: ['FAKEFLIX'], examples: ['FAKEFLIX.COM 4155551234 CA', 'FAKEFLIX*MEMBERSHIP'] },
  typicalMonthly: 15.49,
  pricesCheckedAt: '2026-11',
  verdict: 'rotate',
  also: ['cancel'],
  why: 'A content catalog you cannot rebuild. Subscribe for a month, binge, cancel.',
  plans: {
    rotate: { pattern: 'One month each quarter.', monthsOffPerYear: 9 },
    cancel: { howTo: 'Account, then Cancel membership.', url: 'https://fakeflix.example/cancel' },
  },
  sources: ['https://fakeflix.example/pricing'],
});

/** Valid on its own, but its pattern also matches FakeFlix's examples. */
const fakeflixPlus = () => ({
  ...fakeflix(),
  id: 'fakeflix-plus',
  name: 'FakeFlix Plus',
  match: { patterns: ['FAKEFLIX|FFPLUS'], examples: ['FFPLUS PREMIUM', 'FFPLUS*ANNUAL'] },
});

const run = (...merchants) => validateKb({ targets: [{ file: 'fake.json', merchants }] });
const messages = (r) => r.errors.map((e) => `[${e.id}] ${e.message}`);
const expectError = (label, merchant, re) => {
  const r = run(merchant);
  assert.ok(messages(r).some((m) => re.test(m)), `${label}: expected an error matching ${re}, got:\n${messages(r).join('\n') || '(none)'}`);
  ok(label);
};

// --- the two required cases -------------------------------------------------------------------
{
  const r = run(fakeflix());
  assert.deepEqual(messages(r), [], 'valid merchant must produce no errors');
  assert.equal(r.merchantCount, 1);
  ok('valid merchant passes');
}
{
  const r = run(fakeflix(), fakeflixPlus());
  const hit = messages(r).find((m) => /collision/.test(m) && m.includes('fakeflix-plus') && m.includes('"fakeflix"'));
  assert.ok(hit, `expected a collision naming both ids, got:\n${messages(r).join('\n') || '(none)'}`);
  ok('colliding pattern is reported with both ids');
}
{
  // Checking one file against context files from elsewhere finds the same collision.
  const r = validateKb({
    targets: [{ file: 'mine.json', merchants: [fakeflixPlus()] }],
    context: [{ file: 'other.json', merchants: [fakeflix()] }],
  });
  assert.ok(messages(r).some((m) => /collision/.test(m)), 'context collision expected');
  ok('collision against a context file is reported');
}

// --- helpers ----------------------------------------------------------------------------------
assert.equal(minLiteralChars('MAX'), 3);
assert.equal(minLiteralChars('MAX\\.COM|HBO ?MAX'), 6);
assert.equal(minLiteralChars('HLU\\*?HULU|^HULU'), 4);
assert.equal(minLiteralChars('OPENAI.*CHATGPT|CHATGPT'), 7);
assert.equal(minLiteralChars('(?:NETFLIX|NFLX)\\s*\\d+'), 4);
assert.equal(minLiteralChars('.*'), 0);
assert.equal(simpleNormalize('  Netflix.com   CA '), 'NETFLIX.COM CA');
ok('minLiteralChars and simpleNormalize');

// --- each rule fires --------------------------------------------------------------------------
expectError('pattern "MAX" is too broad', { ...fakeflix(), match: { patterns: ['MAX'], examples: ['MAX'] } }, /too broad/);
expectError('pattern matching empty string', { ...fakeflix(), match: { patterns: ['(?:FAKEFLIX)?'], examples: ['FAKEFLIX'] } }, /empty string/);
expectError('pattern that does not compile', { ...fakeflix(), match: { patterns: ['FAKE(FLIX'], examples: ['FAKEFLIX'] } }, /does not compile/);
expectError('example not matched by own patterns', { ...fakeflix(), match: { patterns: ['FAKEFLIX'], examples: ['SOMETHING ELSE'] } }, /not matched by this merchant/);
expectError('id must be kebab-case', { ...fakeflix(), id: 'FakeFlix_1' }, /kebab-case/);
expectError('why over 220 chars', { ...fakeflix(), why: 'x'.repeat(221) }, /why is 221 chars/);
expectError('pricesCheckedAt format', { ...fakeflix(), pricesCheckedAt: '2026-13' }, /YYYY-MM/);
expectError('plans.cancel is required', { ...fakeflix(), plans: { rotate: { pattern: 'x', monthsOffPerYear: 9 } } }, /plans\.cancel is required/);
expectError('primary verdict needs its plan', { ...fakeflix(), verdict: 'haggle' }, /requires plans\.haggle/);
expectError('also verdict needs its plan', { ...fakeflix(), also: ['rotate', 'haggle'] }, /also "haggle" requires plans\.haggle/);
expectError('sources must be https', { ...fakeflix(), sources: ['http://fakeflix.example/pricing'] }, /sources\[0\] must be an https URL/);
expectError('sources must be non-empty', { ...fakeflix(), sources: [] }, /sources must be a non-empty/);
expectError('streaming-media may not rebuild', { ...fakeflix(), also: ['rebuild'] }, /streaming-media may not offer rebuild/);

const rebuild = (extra = {}) => ({
  ...fakeflix(),
  id: 'habit-app',
  name: 'Habit App',
  category: 'productivity',
  match: { patterns: ['HABITAPP'], examples: ['HABITAPP.COM'] },
  verdict: 'rebuild',
  also: [],
  plans: {
    rebuild: { whatYouBuild: 'A PWA.', hours: 4, runsOn: 'Static hosting', ongoingCostYear: 0, youLose: 'Sync', prompt: words(100) },
    cancel: { howTo: 'Settings, then Cancel.' },
  },
  ...extra,
});
{
  const r = run(rebuild());
  assert.deepEqual(messages(r), [], 'valid rebuild merchant must pass');
  ok('valid rebuild merchant passes');
}
expectError('prompt shorter than 80 words', rebuild({ plans: { ...rebuild().plans, rebuild: { ...rebuild().plans.rebuild, prompt: sentence } } }), /prompt is 13 words; it must be 80-180/);
expectError('prompt longer than 180 words', rebuild({ plans: { ...rebuild().plans, rebuild: { ...rebuild().plans.rebuild, prompt: words(181) } } }), /prompt is 181 words/);
expectError('rebuild hours above 12', rebuild({ plans: { ...rebuild().plans, rebuild: { ...rebuild().plans.rebuild, hours: 13 } } }), /hours must be a number from 1 to 12/);
expectError('password manager may not be rebuilt', rebuild({ id: 'dashlane', name: 'Dashlane', match: { patterns: ['DASHLANE'], examples: ['DASHLANE.COM'] } }), /policy: "Dashlane"/);
expectError('haggle discount must ascend within 0..60', {
  ...fakeflix(),
  verdict: 'haggle',
  also: [],
  plans: { haggle: { leverage: 'x', script: 'x', expectedDiscountPct: [30, 70], bestTime: 'x' }, cancel: { howTo: 'x' } },
}, /ascending within 0\.\.60/);
{
  const r = run(fakeflix(), { ...fakeflix(), name: 'Dup' });
  assert.ok(messages(r).some((m) => /duplicate id/.test(m)));
  ok('duplicate id across entries');
}

console.log(`\n${checks} checks passed`);
