# Working on Lift Run Journey

Read `SPEC.md` first. It holds every product decision made so far. Keep it updated when a decision changes.
`ROADMAP.md` holds the agreed path to Play Store / App Store; update its status list when a phase is done.

## Working agreement
- The owner discusses in Indonesian. Reply in Indonesian; keep the app UI in English.
- Discuss before building larger changes. Small fixes can go straight to a pull request.
- `main` is protected. Work on a branch, open a pull request, and let the owner merge it. Never try to push to `main` directly.
- Never commit training data (Hevy CSV exports, JSON backups). `.gitignore` blocks them; keep it that way.
- Never add external scripts, analytics, or network calls. The Content-Security-Policy in `index.html` must stay strict.
- Keep the home screen positive. Safety features (backup reminder, export/restore, persistence) must not be removed.

## Release checklist
1. Version: bump `APP_VERSION` in `js/app.js` and `VERSION` in `sw.js` together (`v2.1` ↔ `lrj-2.1`).
   Small updates bump the minor (v2.1, v2.2…); a big redesign bumps the major (v3.0).
2. Run `node tests/run.mjs` — all checks must pass. Add a check for every new feature or fixed bug.
   Tests use fake data only (`tests/fixtures.mjs`); never add real training data to the repo.
3. Update `SPEC.md` if behaviour changed.
4. Open a pull request with a short summary in plain language; the owner merges it on GitHub.
