# Buildable

Drop a bank or card statement. Buildable finds every recurring charge and sorts each one into what to do about
it: keep it, haggle, rotate, cancel, or one of three options that only exist now that Claude exists.

- **ABSORB**: Claude already does this job.
- **REBUILD**: Claude Code builds you a free personal version.
- **SELF-HOST**: an old device in your drawer runs the open-source equivalent.

The output is a "subscription tax" receipt and a build queue ranked by dollars saved per hour of building, each item
with a prompt you paste into Claude Code (or a build kit: a CLAUDE.md-style brief plus the prompt).

It runs entirely in the browser. The statement is parsed in the tab and never sent anywhere. `SPEC.md` is the source
of truth for behaviour; this file is the quick tour.

## Run it

```
npm install
npm run dev            # Vite dev server
npm test               # Vitest (use `node node_modules/vitest/vitest.mjs run --no-file-parallelism` on a busy machine)
npm run build          # type-check, then build to dist/
node scripts/serve-dist.mjs dist 4173    # serve dist/ with the same headers as production
```

`serve-dist.mjs` reads `vercel.json`, so the Content-Security-Policy you test under is the one that ships. It also
binds to loopback only.

## What "never leaves your device" means

The page is served with a strict Content-Security-Policy (`vercel.json`): scripts, styles, fonts and images only from
the site itself, `connect-src 'self'`, no forms, no framing. That blocks the browser's normal ways of sending data to
a server (fetch, XHR, WebSocket, beacons, images, forms). It is not a promise about every channel a browser has: a CSP
does not govern WebRTC or top-level navigation, so the guarantee is the combination of the policy and the code, which
makes no requests except to load its own files. View source or watch the network tab to check.

Only your preferences (Claude plan, devices, hourly value) are kept, in `localStorage`. Statement data is never stored.

Two places text leaves the page, both by your hand: the "Ask Claude about these" prompt and the exported plan. The
prompt uses shortened descriptors (phone numbers, card digits and reference ids removed), shows them in an editable
box, and says that a name can slip through. The exported plan wraps statement-derived text in code spans so a hostile
descriptor cannot inject markup.

## Layout

```
src/engine/        statement files -> transactions -> recurring series -> assessments (pure, no DOM)
src/kb/            the catalog: categories/*.json merged into merchants.json; proofs.json
src/ui/            React UI (Landing, Results, cards, receipt, exporters)
public/            sample-statement.csv and public/rebuilt/<id>/ (the proof apps, see below)
rebuilt/<id>/      the proof apps' source, build logs and PROOF.json
scripts/           merge-kb, validate-kb, serve-dist
vercel.json        headers (CSP etc.) and trailingSlash
```

## The catalog

`src/kb/categories/*.json` is the source; `npm run merge-kb` builds `src/kb/merchants.json` and
`npm run validate-kb` checks schema, policy (what may never be rebuilt or self-hosted) and pattern collisions.

## Proof that the REBUILD prompts work

Four REBUILD prompts were given word for word to Claude Sonnet 5.5, one session each, and an independent tester scored
each result in a real browser. The apps are static sites, built into `rebuilt/<id>/dist` and copied to
`public/rebuilt/<id>/`, so they ship at `/rebuilt/<id>/` on the same origin, under the same Content-Security-Policy.

| Service | App | Score (works / partly / missing) |
| --- | --- | --- |
| Huckleberry | Nestlog | 11 / 1 / 0 of 12 |
| Adobe Acrobat Pro | Private PDF Toolkit | 10 / 2 / 0 of 12 |
| Habitify | Habit Tracker | 10 / 2 / 0 of 12 |
| Quizlet Plus | Flashcards+ | 12 / 0 / 0 of 12 |

The score, checklist, summary and known problems are in `src/kb/proofs.json` (a copy of each
`rebuilt/<id>/PROOF.json`). The landing page lists the four apps, and the REBUILD card of each service shows the full
checklist, including items that only partly work, with links to the app and to its build log
(`rebuilt/<id>/BUILDLOG.md` on GitHub). A test checks that `proofs.json` still matches the `PROOF.json` files and that
the prompt on the card is still the prompt in the build log. If you edit one of these four prompts, rebuild the app or
remove its entry from `proofs.json`, because the card says "built from this exact prompt".

## Deploy

Deploy `dist/` as a static site. On Vercel no build settings beyond `npm run build` and the output directory `dist`
are needed; `vercel.json` sets the security headers on every route (the proof apps included) and
`"trailingSlash": true`, so `/rebuilt/habitify` redirects to `/rebuilt/habitify/` (the apps load their files by
relative URL). There are no rewrites, so nothing swallows `/rebuilt/*`: those paths are plain static files.

The catalog is a separate immutable JS chunk. A tab left open across a deploy can no longer fetch the old file; the page
then says so and offers a reload instead of blaming the user's CSV. Vercel's skew protection avoids it.

## Not affiliated

Not affiliated with Anthropic or any company listed. Prices are US list prices at the time of checking. Not financial
advice. Inspired by Nick Saraev, "31 Life-Changing Ways to Use Claude in 2027" (https://youtu.be/KDyPHt4lW60).
