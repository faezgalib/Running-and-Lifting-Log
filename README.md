# Lift Run Journey

A personal, offline lifting + running + mobility log. Installable on Android, no account, no server, no integrations.
Your training data stays on your phone. See [SPEC.md](SPEC.md) for how it works.

## Install on Android
1. Open the GitHub Pages URL in Chrome.
2. Menu (⋮) → **Add to Home screen** / **Install app**.
3. Open it once while online. After that it works fully offline.

## Backup (important)
Data lives only in the app on your phone. Clearing Chrome data or losing the phone deletes it.
- **More → Export backup (.json)** regularly, and keep the file in Google Drive or email it to yourself.
- **More → Restore backup** brings it back on any phone.
- **Export for Excel (.csv)** gives two files (sets, runs) for Power Query / pivot tables.

## Import from Hevy
Hevy: Profile → Settings → Export & Import Data → Export Workouts. Then in the app: **More → Import from Hevy**,
enter your offshore periods (one per line, `YYYY-MM-DD to YYYY-MM-DD`) and pick the CSV.
Re-importing the same file skips sessions that are already there.

## Updating the app
After changing any file, bump `VERSION` in `sw.js` so phones pick up the new version the next time they are online.

## Tech
Plain HTML/CSS/JS (ES modules), IndexedDB, service worker. No build step, no dependencies.
