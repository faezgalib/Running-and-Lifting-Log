# Working on Lift Run Journey

Read `SPEC.md` first. It holds every product decision made so far. Keep it updated when a decision changes.

## Working agreement
- The owner discusses in Indonesian. Reply in Indonesian; keep the app UI in English.
- Discuss before building larger changes. Small fixes can go straight to a pull request.
- `main` is protected. Work on a branch, open a pull request, and let the owner merge it. Never try to push to `main` directly.
- Never commit training data (Hevy CSV exports, JSON backups). `.gitignore` blocks them; keep it that way.
- Never add external scripts, analytics, or network calls. The Content-Security-Policy in `index.html` must stay strict.
- Keep the home screen positive. Safety features (backup reminder, export/restore, persistence) must not be removed.

## Release checklist
1. Bump `VERSION` in `sw.js` and `APP_VERSION` in `js/app.js`.
2. Test in Playwright (Chromium is preinstalled): import a Hevy CSV, plan → log → finish a session, log a run, open Progress, export/restore a backup, reload offline. No console errors.
3. Update `SPEC.md` if behaviour changed.
4. Open a pull request with a short summary in plain language; the owner merges it on GitHub.
