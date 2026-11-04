# Habit Tracker

A private, offline-first habit tracker. React + Vite + TypeScript, data in IndexedDB, no backend, installable as a PWA.

## Features
- Habits with a schedule (every day, specific weekdays, or N times a week), optional numeric goals (for example 8 glasses), and time-of-day groups.
- Today screen: one-tap check-in, +/- steppers for goals, skip and notes, and a day picker for backfilling.
- Per habit: current and best streak, completion rate (30 days, all time), and a keyboard-navigable calendar heatmap that you can click to edit any day.
- Weekly and monthly review charts with per-habit rates and comparison against the previous period.
- Reminders through the Notifications API where supported (clear fallback to in-app banners elsewhere).
- Archive, restore, delete and reorder (arrows or drag).
- JSON and CSV export/import, plus a Habitify CSV importer with a column-confirmation step.
- Offline-first (service worker precache), dark-mode aware (follows the device, overridable), keyboard accessible.

## Streak rules
See the comment at the top of `src/lib/streaks.ts`. In short: only scheduled days count, a skip is neutral, today never breaks a streak until the day is over, and N-per-week habits are measured in weeks.

## Develop
```sh
npm install
npm run dev      # local dev server
npm test         # unit tests (streaks, check-ins, CSV/JSON, Habitify import, reminders, review)
npm run build    # type-check + production build into dist/
npm run icons    # regenerate PNG icons
```

See `DEPLOY.md` for free GitHub Pages deployment.
