# Free deploy to GitHub Pages

The app is a static site (relative base `./`, hash routing), so it works at `https://<you>.github.io/<repo>/` with no extra config.
GitHub Pages is free for public repositories.

1. **Create the repo.** On github.com choose New repository, name it (for example `habit-tracker`), keep it Public, and do not add a README.
2. **Push the code** from this folder:
   ```sh
   git init
   git add .
   git commit -m "Habit tracker"
   git branch -M main
   git remote add origin https://github.com/<you>/habit-tracker.git
   git push -u origin main
   ```
3. **Turn on Pages.** In the repo go to Settings, then Pages, and set Source to **GitHub Actions**.
4. **Let the workflow run.** `.github/workflows/deploy.yml` (already in this folder) runs the tests, builds, and publishes `dist/`. Watch it under the Actions tab; the first run takes about a minute.
5. **Open the site** at `https://<you>.github.io/habit-tracker/`. On Android or desktop Chrome/Edge use the install icon (or Settings, Install app); on iPhone use Share, Add to Home Screen.
6. **Update later** by pushing to `main`. Installed copies pick up the new version the next time they are opened online.

Without Actions you can also deploy by hand: `npm run build`, then publish the contents of `dist/` to a `gh-pages` branch and set Pages Source to that branch.

Notes
- Data lives in each browser's IndexedDB, not on GitHub. Use Settings, Export (JSON) to back up or move between devices.
- Notifications need HTTPS, which github.io provides.
- Locally: `npm install`, `npm run dev`, `npm test`, `npm run build`, `npm run preview`.
