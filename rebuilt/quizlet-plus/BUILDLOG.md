# BUILDLOG: quizlet-plus

## Prompt (verbatim)

Build a flashcard PWA with spaced repetition, no accounts and no backend. Features: (1) decks and cards with text and optional images stored in IndexedDB, (2) FSRS or SM-2 scheduling with a daily due queue and a new-cards-per-day limit, (3) study modes: flip, type the answer, multiple choice built from other cards in the deck, and a timed matching game, (4) stats: streak, retention rate and a heatmap of reviews, (5) import from a Quizlet export pasted as text, with a tab between term and definition and a new line between cards, plus CSV and JSON import and export, (6) dark mode and keyboard shortcuts. Use Vite and TypeScript, make it installable and offline-capable, and add tests for the scheduler. Host free on GitHub Pages and explain how I back up my decks.

Host constraints added by the harness (not part of the prompt): static app, everything bundled locally, relative base `./`, works under the strict CSP (no inline script, no eval, no blob workers), skip deploying, copy build to `D:\buildable\public\rebuilt\quizlet-plus\`.

## What was built

Vite + TypeScript, no runtime dependencies (devDeps: vite, typescript, vitest). Plain DOM with a tiny `h()` helper, hash routing. 67 kB JS / 14 kB CSS (24 + 4 kB gzipped).

- Storage: IndexedDB (`decks`, `cards`, `reviews`, `meta`). Card images are stored as Blobs, shrunk to 900 px WebP on the way in, shown via object URLs. Paste an image into a card box or pick a file.
- Scheduling: own implementation of FSRS-4.5 with the published default weights (`src/fsrs.ts`), learning steps 1/5/10 min (new card Again/Hard/Good), 5/10 min inside learning, 5 min after a lapse, review due dates land at local midnight. Adjustable desired retention. Daily queue (`src/scheduler.ts`): learning cards, reviews due before midnight (capped by reviews/day), new cards capped by new/day minus new cards already started today (counted from the review log). Per-deck limits, defaults from settings.
- Study modes: flip, type the answer (case/accent/punctuation-insensitive, `;` and `/` alternatives, typo tolerance suggests Hard), multiple choice (distractors from other cards in the same deck), timed matching game (4/6/8 pairs, misses, best time per deck). Front-first / back-first / mixed. Practice-all option that does not touch the schedule. Rating buttons show the next interval. Undo last rating.
- Stats: current/longest streak, 30-day and all-time true retention, reviews today, 53-week heatmap, card maturity split, 14-day due forecast, deck filter.
- Import: Quizlet text paste (tab / newline default, plus comma, semicolon, ` - ` and custom separators), CSV (header and delimiter detection, optional `deck` column), JSON (this app's backup or deck files, a `{decks}` object, a single deck, or a bare array of `{front,back}` / `{term,definition}`). Preview with skipped-line report before importing. Export per deck as CSV or JSON, all cards as CSV, full backup JSON (decks, images as data URLs, schedules, review history, settings). Restore modes: merge by id, import as copies, replace everything.
- Dark mode (auto / light / dark, `t` toggles), keyboard shortcuts with a `?` help overlay (`g` then `d/s/i/b` navigation, Space/Enter, 1-4, z undo, Esc, tile keys in the matching game).
- PWA: manifest with generated PNG + SVG + maskable icons, service worker generated at build time by a Vite plugin from the actual output file list (cache-first, offline navigation fallback, "update ready, reload" toast), install button in settings.
- GitHub Pages: `.github/workflows/pages.yml` (test, build, deploy). README explains the setup. In-app "Backup & settings" page and README explain backups; the deck list nags after 14 days without a backup.
- Tests (vitest, 75 tests): FSRS formulas and `schedule()` (new/learning/review/relearning transitions, interval ordering, growth, lapse, max interval, determinism, immutability), queue building and session ordering, forecast, Quizlet/CSV/JSON parsing and round trips, typed-answer checking and multiple-choice building, streak/retention/heatmap, base64 image decoding.

## Verification done

- `tsc --noEmit` clean, `npm test` 75/75, `npm run build` ok.
- Served `dist/` under `/rebuilt/quizlet-plus/` with the host CSP (`scripts/serve-csp.mjs`) and drove it in a browser: Quizlet paste import, flip/type/choice study with keyboard, undo, matching game, stats and heatmap, image card, full JSON backup then erase then restore (images, schedule and history came back).
- Service worker: the embedded browser pane refused to register service workers (environment limitation), so it was checked in real Chrome: registered, activated, controlled the page, precached all 10 files, and the page reloaded and rendered with the server stopped.

## Key decisions

- FSRS over SM-2 (prompt allowed either). Implemented from the published formulas rather than adding a library, so there is no dependency and the tests pin the maths. No optimiser, no fuzz (deterministic, testable).
- Good after a new card's 10-minute step graduates to 5 days rather than 4, because the Hard < Good < Easy ordering rule bumps Good one day above Hard, as the reference implementations do.
- Images in JSON travel as base64 data URLs and are decoded by hand, because `fetch()` on `data:` URLs is blocked by `connect-src 'self'`.
- Hash routing so it works on GitHub Pages and any sub-path without server rewrites.
- Theme is mirrored in localStorage so it applies before IndexedDB opens (try/catch around it).
- Settings live in IndexedDB so they ride along in the backup.

## Not done / limits

- Did not deploy (told to skip); workflow and instructions are provided but untested on real GitHub.
- No automated tests for the UI or the IndexedDB layer (checked by hand in a browser only). No per-user FSRS weight optimisation. No audio, no tags, no card suspend, no drag-and-drop file import. Dark mode was implemented but not eyeballed in a screenshot. Not tested on iOS/Safari or the actual install flow (manifest and SW are present and served correctly).
- CSV export is text only by design (images and schedule need JSON).

## Rough step count

About 60 tool calls: ~12 writing/reading config and core logic, ~12 writing UI files, ~8 fixing (a heredoc backslash bug, type errors, a test expectation), ~20 browser verification, ~8 docs/build/copy.
