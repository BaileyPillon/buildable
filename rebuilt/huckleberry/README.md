# Nestlog

Offline baby sleep, feeding, diaper and pumping tracker. React + Vite + TypeScript, data in IndexedDB, no backend, no accounts, installable as a PWA.

## What it does

- One-tap timers: sleep, breast (with left/right timers), bottle, pumping; diapers log in one tap (Wet / Dirty / Both).
- Edit or backdate any entry; "Edit / backdate" on a running timer; "Add past entry" for forgotten ones; undo on delete.
- Today timeline (with a 24 hour strip) and day navigation; daily and weekly summaries (total sleep, longest stretch, naps, feeds, diapers, pumping).
- Nap predictor: age-based wake-window ranges you can edit per child (Settings), narrowed using the last 10 days of logged sleep (see `src/lib/predictor.ts`).
- Share summary as PNG or text (copy, download, or the device share sheet) for today, yesterday, last 7 days or a custom range.
- Multiple children, each with their own wake windows.
- Dim red night mode (automatic 7 pm to 7 am, or always on/off). Red-only palette, no blue or green light.
- Export / import: JSON backup (merge or replace) and CSV export; CSV import with a column-mapping step, including a Huckleberry CSV preset.
- Works offline after first load (service worker precaches the app shell).

## Develop

```
npm install
npm run dev          # http://localhost:5173
npm test             # predictor, summaries, data/import, IndexedDB, offline/service-worker tests
npm run build        # type-check + production build into dist/ (base './', relative paths)
npm run serve:csp    # serve dist/ under /rebuilt/huckleberry/ with the strict CSP, to catch violations
npm run icons        # regenerate the PWA icons (pure node)
```

The service worker (`dist/sw.js`) is generated at build time from `src/sw-template.js` by `scripts/sw-plugin.ts`; it is only registered in production builds.

## Deploy to Cloudflare Pages (free)

Option A, Git integration (no CLI):

1. Push this folder to a GitHub or GitLab repository.
2. Cloudflare dashboard, Workers & Pages, Create, Pages, Connect to Git, pick the repo.
3. Build command `npm run build`, build output directory `dist`, environment variable `NODE_VERSION` = `20` (or newer).
4. Save and Deploy. Every push redeploys; your app is at `https://<project>.pages.dev`.

Option B, direct upload from your machine:

```
npm install
npm run build
npx wrangler login
npx wrangler pages deploy dist --project-name nestlog
```

Notes:

- `public/_headers` is copied into `dist/` and sets the Content-Security-Policy, caching (`sw.js`, `index.html` and the manifest are never cached stale; hashed assets are immutable).
- Pages serves over HTTPS, which service workers and "Install app" require. A custom domain is optional and free.
- Because the build uses relative paths, the same `dist/` also works under a sub-path.
- Data lives in each visitor's browser, so deploying updates never touches anyone's entries. Use Settings, Export JSON backup, before switching phones or clearing browser data.

## Data and privacy

Everything stays in the browser's IndexedDB. Nothing is sent anywhere. `navigator.storage.persist()` is requested so the browser is less likely to evict the data.
