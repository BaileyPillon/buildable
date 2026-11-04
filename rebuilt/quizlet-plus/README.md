# Flashcards+

Offline flashcards with spaced repetition. No account, no backend: everything is stored in your browser (IndexedDB).

- Decks and cards with text and optional images
- FSRS-4.5 scheduling (default weights), daily due queue, new-cards-per-day and reviews-per-day limits per deck
- Study modes: flip, type the answer, multiple choice (distractors from the other cards in the deck), timed matching game
- Stats: streak, retention rate, 12-month review heatmap, 14-day forecast
- Import a Quizlet export pasted as text (tab between term and definition, new line between cards), CSV and JSON; export CSV and JSON
- Dark mode, keyboard shortcuts (press `?`), installable PWA, works offline

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # scheduler, queue, import/export, stats tests (vitest)
npm run build      # type-check + production build into dist/
node scripts/serve-csp.mjs 4791   # serve dist/ under /rebuilt/quizlet-plus/ with a strict CSP
```

The build uses a relative base (`./`), so `dist/` works from any sub-path. A Vite plugin writes `dist/sw.js` with the list of built files to precache.

## Host it free on GitHub Pages

1. Create a GitHub repository and push this folder to its `main` branch.
2. In the repository go to Settings, then Pages, and set Source to "GitHub Actions".
3. The included workflow `.github/workflows/pages.yml` runs the tests, builds and publishes `dist/`. After the first run your app is at `https://<your-user>.github.io/<repo>/`.
4. Open that address once while online, then use your browser's Install option (Chrome and Edge: the install icon in the address bar; iOS Safari: Share, Add to Home Screen). It then works offline.

No settings change is needed for a project page because paths are relative.

## Back up your decks

Your decks live only in the browser profile on the device you studied on. There is no server copy. Clearing site data, using a private window, uninstalling the browser or switching device loses them unless you have a backup file.

1. Open **Backup & settings** (key `g` then `b`) and press **Download full backup (JSON)**. The file `flashcards-backup-YYYY-MM-DD.json` holds every deck, card, image, each card's schedule, your full review history and settings.
2. Save it somewhere that is itself backed up (a cloud drive, an email to yourself). Do this after long sessions or at least every couple of weeks; the deck list shows a reminder after 14 days.
3. To restore, or to move to a new device, open the app there, go to **Import**, choose the JSON file and pick Merge (keep what is there, update matching ids), Import as copies, or Replace everything.
4. **Export CSV** (per deck or all decks) is for other tools and spreadsheets. It contains only front and back text (and the deck name), so use JSON for real backups: CSV loses images, schedules and history.
5. In **Backup & settings** you can also ask the browser for persistent storage, which stops it from evicting the data when the disk is low.

Moving to Quizlet-style tools: export CSV and import it there. Importing from Quizlet: open a set, choose Export, copy the text and paste it on the Import page (tab between term and definition and a new line between cards are the defaults; other separators can be selected).

## Notes

- FSRS here is FSRS-4.5 with the published default weights and short learning steps (1/5/10 minutes for a new card, 5 minutes after a lapse). Desired retention is adjustable (0.70 to 0.99). There is no per-user weight optimisation and no interval fuzz.
- Typed answers ignore case, accents and punctuation, accept `a; b` / `a / b` alternatives, and treat small typos as "Hard".
- Multiple choice and type-the-answer fall back to flip for cards where they cannot work (image-only answer, deck too small).
