// Builds fixtures/test-kb.json: a small, deterministic KB used ONLY by the engine tests (not src/kb).
// Run: node fixtures/gen/build-test-kb.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = ['https://example.com/test-kb'];
const hint = (amount, cadence, plan) => ({ amount, cadence, plan });
const words = (n) => Array.from({ length: n }, (_, i) => `step${i + 1}`).join(' ');
const prompt = (what) => `Paste-ready test prompt for ${what}. ${words(80)}`;

function merchant(o) {
  const plans = { cancel: { howTo: `Cancel ${o.name} in account settings.` }, ...(o.plans ?? {}) };
  if (o.verdict === 'absorb' || o.also?.includes('absorb')) {
    plans.absorb ??= { claudeDoes: `Claude does the core of ${o.name}.`, howTo: 'Ask Claude.', limits: 'Fewer integrations.', prompt: prompt(o.name) };
  }
  return {
    id: o.id,
    name: o.name,
    category: o.category,
    url: `https://${o.id}.example.com`,
    match: {
      patterns: o.patterns,
      examples: o.examples,
      ...(o.billedVia ? { billedVia: o.billedVia } : {}),
      ...(o.hints ? { priceHints: o.hints } : {}),
    },
    typicalMonthly: o.typicalMonthly ?? null,
    pricesCheckedAt: '2026-10',
    verdict: o.verdict,
    ...(o.also ? { also: o.also } : {}),
    why: o.why ?? `${o.name} test reason.`,
    plans,
    sources: SRC,
  };
}

const rebuild = (what, hours, ongoing = 0) => ({
  rebuild: { whatYouBuild: what, hours, runsOn: 'Installable PWA', ongoingCostYear: ongoing, youLose: 'Sync across devices', prompt: prompt(what) },
});
const selfhost = (software, hardware, hours, power) => ({
  selfhost: { software, hardware, hours, powerCostYear: power, youLose: 'Support', prompt: prompt(software.join(' ')) },
});
const haggle = (lo, hi) => ({
  haggle: { leverage: 'A competitor offer', script: 'Hello, I would like a better rate.', expectedDiscountPct: [lo, hi], bestTime: 'Before renewal' },
});
const rotate = (months) => ({ rotate: { pattern: 'Subscribe one month in three', monthsOffPerYear: months } });
const LAPTOPS = ['old-laptop', 'spare-pc', 'raspberry-pi', 'nas'];

const kb = [
  // ai
  merchant({ id: 'chatgpt-plus', name: 'ChatGPT Plus', category: 'ai', patterns: ['OPENAI|CHATGPT'], examples: ['OPENAI *CHATGPT SUBSCR'], hints: [hint(20, 'monthly', 'Plus')], typicalMonthly: 20, verdict: 'absorb', also: ['cancel'] }),
  merchant({ id: 'claude-pro', name: 'Claude Pro', category: 'ai', patterns: ['ANTHROPIC|CLAUDE\\.AI'], examples: ['CLAUDE.AI SUBSCRIPTION'], hints: [hint(20, 'monthly', 'Pro'), hint(200, 'annual', 'Pro annual')], typicalMonthly: 20, verdict: 'keep' }),
  // productivity
  merchant({ id: 'grammarly', name: 'Grammarly', category: 'productivity', patterns: ['GRAMMARLY'], examples: ['GRAMMARLY GRAMMARLY.COM CA'], hints: [hint(144, 'annual', 'Premium annual'), hint(30, 'monthly', 'Premium')], typicalMonthly: 12, verdict: 'absorb' }),
  merchant({ id: 'otter-ai', name: 'Otter.ai', category: 'productivity', patterns: ['OTTER\\.?AI'], examples: ['OTTER.AI 650-555-0100 CA'], hints: [hint(16.99, 'monthly', 'Pro'), hint(99.99, 'annual', 'Pro annual')], typicalMonthly: 16.99, verdict: 'rebuild', plans: rebuild('Local Whisper transcriber', 8) }),
  merchant({ id: 'notion', name: 'Notion', category: 'productivity', patterns: ['NOTION'], examples: ['NOTION LABS SAN FRANCISCO CA'], hints: [hint(10, 'monthly', 'Plus')], typicalMonthly: 10, verdict: 'rebuild', plans: rebuild('Personal notes app', 12) }),
  merchant({ id: 'todoist', name: 'Todoist', category: 'productivity', patterns: ['TODOIST|DOIST'], examples: ['TODOIST DOIST.COM'], hints: [hint(5, 'monthly', 'Pro'), hint(48, 'annual', 'Pro annual')], typicalMonthly: 5, verdict: 'rebuild', plans: rebuild('Task list PWA', 6) }),
  merchant({ id: 'calendly', name: 'Calendly', category: 'productivity', patterns: ['CALENDLY'], examples: ['CALENDLY ATLANTA GA'], hints: [hint(10, 'monthly', 'Standard'), hint(12, 'monthly', 'Standard 2027')], typicalMonthly: 10, verdict: 'rebuild', plans: rebuild('Booking page', 5) }),
  merchant({ id: 'linktree', name: 'Linktree', category: 'shopping-news-social', patterns: ['LINKTREE|LINK\\.TREE'], examples: ['LINKTREE LINKTR.EE'], hints: [hint(5, 'monthly', 'Starter'), hint(12, 'monthly', 'Pro')], typicalMonthly: 12, verdict: 'rebuild', plans: rebuild('Link-in-bio page', 3) }),
  merchant({ id: 'zapier', name: 'Zapier', category: 'productivity', patterns: ['ZAPIER'], examples: ['ZAPIER.COM SAN FRANCISCO CA'], hints: [hint(29.99, 'monthly', 'Starter'), hint(19.99, 'monthly', 'Free+')], typicalMonthly: 29.99, verdict: 'rebuild', plans: rebuild('Cron + scripts', 10) }),
  merchant({ id: 'ynab', name: 'YNAB', category: 'productivity', patterns: ['YNAB|YOU NEED A BUDGET'], examples: ['YNAB.COM 855-555-0101'], hints: [hint(14.99, 'monthly', 'Monthly'), hint(109, 'annual', 'Annual')], typicalMonthly: 14.99, verdict: 'rebuild', plans: rebuild('Envelope budgeting PWA', 12) }),
  // health-family
  merchant({ id: 'peloton-app', name: 'Peloton App', category: 'health-family', patterns: ['PELOTON'], examples: ['PELOTON MEMBERSHIP NEW YORK NY'], hints: [hint(12.99, 'monthly', 'App One'), hint(24, 'monthly', 'App+')], typicalMonthly: 12.99, verdict: 'rotate', plans: rotate(4) }),
  merchant({ id: 'myfitnesspal', name: 'MyFitnessPal Premium', category: 'health-family', patterns: ['MYFITNESSPAL|MFP PREMIUM'], examples: ['MYFITNESSPAL.COM 888-555-0102'], hints: [hint(19.99, 'monthly', 'Premium'), hint(79.99, 'annual', 'Premium annual')], typicalMonthly: 19.99, verdict: 'rebuild', plans: rebuild('Food log PWA', 8) }),
  merchant({ id: 'huckleberry', name: 'Huckleberry', category: 'health-family', patterns: ['HUCKLEBERRY'], examples: ['HUCKLEBERRY LABS SAN FRANCISCO CA'], hints: [hint(14.99, 'monthly', 'Plus'), hint(58.99, 'annual', 'Plus annual')], typicalMonthly: 14.99, verdict: 'rebuild', plans: rebuild('Baby sleep tracker PWA', 7) }),
  merchant({ id: 'headspace', name: 'Headspace', category: 'health-family', patterns: ['HEADSPACE'], examples: ['HEADSPACE INC SANTA MONICA CA'], hints: [hint(12.99, 'monthly', 'Monthly'), hint(69.99, 'annual', 'Annual')], typicalMonthly: 12.99, verdict: 'rebuild', plans: rebuild('Meditation timer', 4) }),
  merchant({ id: 'planet-fitness', name: 'Planet Fitness', category: 'health-family', patterns: ['PLANET FIT|PLNT FIT'], examples: ['PLANET FITNESS CLUB FEE', 'PLANET FITNESS MONTHLY FEE'], hints: [hint(10, 'monthly', 'Classic'), hint(24.99, 'monthly', 'Black Card')], typicalMonthly: 24.99, verdict: 'haggle', plans: haggle(10, 25) }),
  merchant({ id: 'hellofresh', name: 'HelloFresh', category: 'shopping-news-social', patterns: ['HELLO ?FRESH'], examples: ['HELLOFRESH.COM NEW YORK NY'], hints: [hint(59.94, 'weekly', '3 meals')], typicalMonthly: null, verdict: 'rotate', plans: rotate(3) }),
  // storage / security / home
  merchant({ id: 'dropbox', name: 'Dropbox', category: 'storage-security-home', patterns: ['DROPBOX'], examples: ['DROPBOX DROPBOX.COM CA'], hints: [hint(11.99, 'monthly', 'Plus'), hint(119.88, 'annual', 'Plus annual')], typicalMonthly: 11.99, verdict: 'selfhost', also: ['cancel'], plans: selfhost(['Nextcloud', 'Syncthing'], LAPTOPS, 4, 22) }),
  merchant({ id: 'ring-protect', name: 'Ring Protect', category: 'storage-security-home', patterns: ['RING (PROTECT|PLAN|YEARLY)|RING\\.COM'], examples: ['RING PROTECT PLAN RING.COM CA'], hints: [hint(4.99, 'monthly', 'Basic'), hint(10.99, 'monthly', 'Plus'), hint(49.99, 'annual', 'Basic annual')], typicalMonthly: 4.99, verdict: 'keep', also: ['cancel'] }),
  merchant({ id: 'nordvpn', name: 'NordVPN', category: 'storage-security-home', patterns: ['NORD ?VPN|NORDSEC'], examples: ['NORDVPN.COM NORDSEC'], hints: [hint(12.99, 'monthly', 'Monthly'), hint(59.88, 'annual', '1 year'), hint(71.88, 'annual', '1 year renew')], typicalMonthly: 12.99, verdict: 'selfhost', plans: selfhost(['WireGuard', 'Tailscale'], ['raspberry-pi', 'old-laptop', 'spare-pc', 'nas'], 3, 6) }),
  merchant({ id: 'icloud-plus', name: 'iCloud+', category: 'storage-security-home', patterns: ['ICLOUD'], examples: ['APPLE ICLOUD STORAGE'], billedVia: 'apple', hints: [hint(0.99, 'monthly', '50 GB'), hint(2.99, 'monthly', '200 GB'), hint(9.99, 'monthly', '2 TB')], typicalMonthly: 2.99, verdict: 'keep' }),
  // streaming
  merchant({ id: 'netflix', name: 'Netflix', category: 'streaming-media', patterns: ['NETFLIX'], examples: ['NETFLIX.COM 866-579-7172 CA'], hints: [hint(7.99, 'monthly', 'Ads'), hint(15.49, 'monthly', 'Standard'), hint(17.99, 'monthly', 'Standard 2026'), hint(22.99, 'monthly', 'Premium')], typicalMonthly: 17.99, verdict: 'rotate', also: ['keep', 'cancel'], plans: rotate(4) }),
  merchant({ id: 'spotify', name: 'Spotify', category: 'streaming-media', patterns: ['SPOTIFY'], examples: ['SPOTIFY P3F8A2B91C STOCKHOLM'], hints: [hint(11.99, 'monthly', 'Individual'), hint(12.99, 'monthly', 'Individual 2026'), hint(19.99, 'monthly', 'Family')], typicalMonthly: 12.99, verdict: 'keep', also: ['rotate'], plans: rotate(2) }),
  merchant({ id: 'hulu', name: 'Hulu', category: 'streaming-media', patterns: ['HLU\\*?HULU|^HULU'], examples: ['HLU*HULU 877-824-4858 CA'], hints: [hint(9.99, 'monthly', 'Ads'), hint(18.99, 'monthly', 'No ads')], typicalMonthly: 9.99, verdict: 'rotate', plans: rotate(5) }),
  merchant({ id: 'max', name: 'Max', category: 'streaming-media', patterns: ['MAX\\.COM|HBO ?MAX'], examples: ['MAX.COM NEW YORK NY'], hints: [hint(9.99, 'monthly', 'Ads'), hint(16.99, 'monthly', 'No ads'), hint(18.49, 'monthly', 'No ads 2026')], typicalMonthly: 16.99, verdict: 'rotate', plans: rotate(6) }),
  merchant({ id: 'disney-plus', name: 'Disney+', category: 'streaming-media', patterns: ['DISNEY ?PLUS|DISNEYPLUS'], examples: ['DISNEY PLUS 888-905-7888 CA'], hints: [hint(9.99, 'monthly', 'Ads'), hint(13.99, 'monthly', 'No ads')], typicalMonthly: 13.99, verdict: 'rotate', plans: rotate(6) }),
  merchant({ id: 'paramount-plus', name: 'Paramount+', category: 'streaming-media', patterns: ['PARAMOUNT'], examples: ['PARAMOUNT PLUS 877-555-0103 NY'], hints: [hint(7.99, 'monthly', 'Essential'), hint(12.99, 'monthly', 'Premium')], typicalMonthly: 7.99, verdict: 'rotate', plans: rotate(8) }),
  merchant({ id: 'audible', name: 'Audible', category: 'streaming-media', patterns: ['AUDIBLE'], examples: ['AUDIBLE*AB1CD2EF3 AMZN.COM/BILL WA'], billedVia: 'amazon', hints: [hint(14.95, 'monthly', 'Premium Plus'), hint(149.5, 'annual', 'Annual')], typicalMonthly: 14.95, verdict: 'keep', also: ['cancel'] }),
  merchant({ id: 'youtube-premium', name: 'YouTube Premium', category: 'streaming-media', patterns: ['GOOGLE ?\\*YOUTUBE|YOUTUBE ?(PREMIUM|MUSIC)'], examples: ['GOOGLE *YouTube', 'GOOGLE *YOUTUBEPREMIUM'], billedVia: 'google', hints: [hint(13.99, 'monthly', 'Individual'), hint(15.99, 'monthly', 'Individual 2026'), hint(22.99, 'monthly', 'Family')], typicalMonthly: 13.99, verdict: 'rotate', also: ['keep'], plans: rotate(3) }),
  merchant({ id: 'apple-music', name: 'Apple Music', category: 'streaming-media', patterns: ['APPLE MUSIC'], examples: ['APPLE MUSIC SUBSCRIPTION'], billedVia: 'apple', hints: [hint(10.99, 'monthly', 'Individual'), hint(16.99, 'monthly', 'Family')], typicalMonthly: 10.99, verdict: 'keep' }),
  merchant({ id: 'apple-tv-plus', name: 'Apple TV+', category: 'streaming-media', patterns: ['APPLE TV'], examples: ['APPLE TV PLUS'], billedVia: 'apple', hints: [hint(9.99, 'monthly', 'Monthly')], typicalMonthly: 9.99, verdict: 'rotate', plans: rotate(8) }),
  // telecom
  merchant({ id: 'xfinity', name: 'Xfinity', category: 'telecom-utilities-finance', patterns: ['XFINITY|COMCAST'], examples: ['COMCAST CABLE COMM 800-COMCAST PA'], typicalMonthly: 80, verdict: 'haggle', plans: haggle(10, 25) }),
  merchant({ id: 'verizon', name: 'Verizon Wireless', category: 'telecom-utilities-finance', patterns: ['VZWRLSS|VERIZON|VZW'], examples: ['VZWRLSS*APOCC VISB 800-922-0204 NJ'], typicalMonthly: 85, verdict: 'haggle', plans: haggle(5, 15) }),
  // software / learning
  merchant({ id: 'duolingo', name: 'Duolingo Super', category: 'software-learning', patterns: ['DUOLINGO'], examples: ['DUOLINGO PITTSBURGH PA'], billedVia: 'google', hints: [hint(12.99, 'monthly', 'Super'), hint(83.99, 'annual', 'Super annual')], typicalMonthly: 12.99, verdict: 'absorb' }),
  merchant({ id: 'calm', name: 'Calm', category: 'health-family', patterns: ['\\bCALM\\b|CALM\\.COM'], examples: ['CALM.COM SAN FRANCISCO CA'], billedVia: 'google', hints: [hint(14.99, 'monthly', 'Monthly'), hint(69.99, 'annual', 'Annual')], typicalMonthly: 14.99, verdict: 'rebuild', plans: rebuild('Meditation timer', 4) }),
  // shopping / news
  merchant({ id: 'amazon-prime', name: 'Amazon Prime', category: 'shopping-news-social', patterns: ['AMAZON PRIME|AMZN PRIME|PRIME VIDEO|AMZN DIGITAL'], examples: ['AMAZON PRIME*XX1AB2CD3 AMZN.COM/BILL WA', 'AMZN DIGITAL*AB1CD2EF3'], billedVia: 'amazon', hints: [hint(14.99, 'monthly', 'Monthly'), hint(139, 'annual', 'Annual')], typicalMonthly: 14.99, verdict: 'keep' }),
  merchant({ id: 'nytimes', name: 'The New York Times', category: 'shopping-news-social', patterns: ['NYTIMES|NY TIMES|NEW YORK TIMES'], examples: ['NYTIMES*NYTIMES.COM 800-698-4637 NY'], hints: [hint(17, 'monthly', 'All Access'), hint(25, 'monthly', 'Full price')], typicalMonthly: 25, verdict: 'haggle', plans: haggle(20, 50) }),
];

fs.writeFileSync(path.join(here, '..', 'test-kb.json'), JSON.stringify(kb, null, 2) + '\n');
console.log(`wrote ${kb.length} merchants`);
