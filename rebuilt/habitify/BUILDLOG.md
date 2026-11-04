# BUILDLOG: habitify rebuild

## Prompt (verbatim)

Build a personal habit tracker as an installable PWA (React, Vite, TypeScript, IndexedDB, no backend). Features: (1) habits with a schedule (daily, specific weekdays, or N times per week), optional numeric goals such as 8 glasses of water, and time-of-day grouping; (2) one-tap check-in from a Today screen, with skip and note options; (3) streaks, completion rate and a calendar heatmap per habit; (4) weekly and monthly review charts; (5) local reminders using the Notifications API where the browser supports them, with a clear fallback message where it does not; (6) archive and reorder habits. Keep all data in IndexedDB with JSON and CSV export and import. Check whether Habitify can export my history and, if so, write an importer after confirming its columns with me. Make it offline-first, dark-mode aware and keyboard accessible, add tests for the streak logic, and finish with free deploy steps for GitHub Pages.

Host constraints added on top (not part of the prompt): static web app, all libraries bundled locally, relative base `./`, must run under the CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; ...` (no inline scripts, no eval, no blob workers), skip deploying, copy the build to `D:\buildable\public\rebuilt\habitify\`.

## What was built

Work folder `D:\buildable\rebuilt\habitify\`; production build copied to `D:\buildable\public\rebuilt\habitify\` (index.html, assets/, icons/, manifest.webmanifest, sw.js).

Stack: React 19, Vite 8, TypeScript 7 (strict), Vitest. The only runtime dependencies are react and react-dom. No router library, no chart library, no CSV library, no IndexedDB wrapper: all hand-written (about 300 KB JS, 94 KB gzip).

Screens (hash routes so it works from any sub-path):
- Today: date picker for backfilling, progress summary, groups by time of day, one-tap check circle, +/- stepper for numeric goals, "..." dialog for Skip / Done / Not done, progress value and note. Weekly (N times a week) habits show "x of N this week".
- Habits: add, edit, archive/restore, permanent delete (with confirm), reorder by up/down buttons or drag and drop.
- Habit detail: current and best streak, 30-day and all-time completion rate, total check-ins, average logged value for goal habits, calendar heatmap (3 / 6 / 12 months; arrow keys, Home/End, Enter; click a day to edit it), recent notes.
- Review: week or month, previous/next navigation, completion rate versus the previous period, check-ins, perfect days, best day, daily bar chart (plus a weekly chart for months), per-habit table. Charts are hand-written accessible SVG with a hidden data table.
- Settings: theme (device / light / dark), week start (Mon/Sun), notification status and permission button, test notification, JSON and CSV export, import, persistent-storage request, install button when the browser offers it, delete all data.

Other: service worker precaches every built file (offline-first), web manifest with generated PNG icons (maskable too), reminders, cross-tab sync through BroadcastChannel, skip link, focus moved to the page on navigation, `<dialog>` modals (focus trap, Escape), live-region announcements, reduced-motion and forced-colors handling.

Tests (67, all passing; `npm test`): streak logic (daily, weekdays, N per week, skips, pending today, year/leap boundaries, Sunday-start weeks, history older than createdAt), completion rate, heatmap cell states, check-in transitions, date math without DST drift, CSV parse/write (quotes, BOM, semicolons, formula guard), JSON/CSV round trips, hostile-import sanitising, merge/replace, reminders, review aggregation, Habitify importer.

Deploy: `DEPLOY.md` (free GitHub Pages steps) and `.github/workflows/deploy.yml` (test, build, publish with Actions). `README.md` summarises the app.

## Verification done

- `tsc --noEmit` clean, `vitest run` 67/67, `vite build` ok.
- Served `dist/` under `/rebuilt/habitify/` with the exact CSP from the host constraints and drove the app in the browser pane by DOM scripting: created a habit, checked in, stepper, skip and note, imported a seeded JSON (243 check-ins), heatmap states and keyboard focus, review week/month/previous, reorder, archive, reload persistence, JSON/CSV export blobs, the Habitify import dialog end to end (auto-detected day/month/year, confirm gate, 30 check-ins, goal inferred), dark mode via emulated prefers-color-scheme and the manual override, no horizontal overflow at 375 px. No CSP violations were logged.
- Service worker: the embedded browser pane refuses to register any service worker (even a one-line one), so registration could not be observed live. Instead the built `sw.js` was run in a Node harness with mocked `caches`/`self`: install precaches, old caches are deleted, shell served for navigations, assets served from cache, 504 when offline and uncached, cross-origin and non-GET ignored.

## Key decisions

- Data model: `habits`, `entries` (key `habitId|date`) and `meta` stores. All state is held in memory and written through to IndexedDB; dates are local calendar keys with UTC day-number arithmetic so DST cannot shift a day.
- Streak rules (written at the top of `src/lib/streaks.ts`): only scheduled days count; a skip is neutral; today without a check-in never breaks a streak; N-per-week habits use weekly streaks where a week with enough done+skipped days is excused and the current and first partial weeks are neutral until met.
- A goal habit is "done" when progress reaches the target; the status is stored on the entry so later changes to the goal do not rewrite history.
- Review excludes archived habits because the app does not record when a habit was archived.
- Notifications: the Notifications API can only fire while the browser is running the page or service worker (no push server, and Notification Triggers is not available), so reminders are checked every 30 s while the app is open. A system notification is sent when permission is granted (via the service worker registration when present), and an in-app banner is always shown for overdue reminders. The Settings text says plainly when the API is unsupported (for example iOS Safari outside the Home Screen app) or blocked.
- CSV export writes two files (habits, check-ins) because one flat file cannot carry schedules for habits with no check-ins. Text cells starting with `=`, `+`, `-`, `@` get a leading apostrophe on export and are restored on import. Imported JSON/CSV is validated and clamped field by field.
- Hash routing instead of a router library: works under any base path on GitHub Pages with no 404 fallback.
- Own service-worker generator (small Vite plugin) instead of a PWA plugin, to keep dependencies to react and react-dom.

## Habitify check and importer

I searched Habitify's help center: it offers (Settings, Import / Export) a CSV check-in log and a full `.sqlite` backup. There is no JSON export. The documented CSV columns are `Habit, Date, Total log, Unit, Status, Habit ID`, with Status one of Completed, Skipped, Failed; the help page does not state the date format or show a sample row.

Importer (`src/lib/habitify.ts`, `src/components/ImportDialogs.tsx`): the app has to be non-interactive here, so "confirm the columns with me" is built into the import flow itself. The user picks the file in Settings; the dialog shows the detected column mapping with the first rows of each column, lets the user change any mapping, shows the date format (auto-detected as year-month-day / day-month-year / month-day-year, with an ambiguity warning and a live preview) and the status mapping, then lists the habits (per-habit include box, schedule choice, inferred goal), and the Import button stays disabled until the user ticks "these match my file". Re-importing the same file merges into the same habits (matched by Habit ID, then by name) and does not duplicate check-ins. Failed rows are not stored because a miss is the absence of a check-in. Schedules are not in the CSV, so habits default to daily, with a weekly suggestion for sparse histories that contain no failures.

## Could not do, and why

- Confirm the Habitify columns with the user: no user to ask in this run. I used Habitify's published column names and moved the confirmation into the import dialog. The date format is a guess to be checked on a real export.
- Import Habitify's `.sqlite` backup: it needs a SQLite engine (a WASM build would have to be bundled); only the CSV is supported.
- See a real export from the user's account: not available.
- Observe service-worker registration in a real browser (pane limitation above). Verified by simulation only.
- Fire a real system notification: the pane reports notifications as blocked. Permission logic and the fallback message were exercised; the due-reminder logic is unit tested.
- Visual review by screenshot: screenshots timed out in the shared browser pane, so layout was checked through computed styles, scroll widths and DOM text rather than by eye.
- Deploy: skipped as instructed; steps are in `DEPLOY.md`.

## Rough step count

About 80 tool calls: 3 for reading the prompt and checking Habitify's export, 1 install, about 30 file writes (config, libs, components, tests, docs), 6 test/build runs, about 35 browser/DOM verification and fix steps.
