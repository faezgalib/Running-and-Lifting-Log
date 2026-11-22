# Lift Run Journey — Specification

Personal lifting + running + mobility log. Offline-first, single user, no accounts, no integrations.

## Principles
- Works fully offline (installable PWA on Android). Data lives only on the phone (IndexedDB).
- No server, no login, no Strava/Hevy sync. Backup = manual export file.
- English UI, dark theme, simple. No exercise "how to", no rest timer.
- Code is public; training data is never committed to the repo.

## Context (asked once per session, at start)
| Field | Options |
|---|---|
| Location | Home / Gym / Offshore |
| Sleep last night | ≤4, 5, 6, 7, 8+ h |

Work hours are not asked: Offshore always means a 12 h shift before training, Home/Gym means no work.
Offshore: sleep can still be recorded, but it is not used for targets (training on the rig always follows a shift, sleep comes after). Offshore targets follow previous offshore sessions and RIR.
Performance is compared against sessions in the same location first.

## Exercises
Each exercise has:
- **Kind**: lift, core, mobility
- **Equipment**: dumbbell, machine, cable, barbell, bodyweight → default weight step
  - Dumbbell / barbell: +1.5 kg (options 1.5 / 2 / 3)
  - Machine / cable: +2.5 kg
- **Load entry**: per dumbbell, or total of 2 dumbbells (step doubles)
- **Unilateral**: separate Left / Right reps per set (same weight)
- **Muscle group**: legs, chest, back, shoulders, arms, core, full body
- **Rep range**: default 8–12
- **Mobility format**: reps, hold (sec), or distance (m); optional per side
- Weight is typed manually, never a dropdown.

## Lift session flow
1. **Check-in**: location, sleep.
2. **Plan**: pick 5–7 exercises and order them. The app shows a recommended weight × reps × sets for each, with the reasons.
3. **Log**: enter actual weight and reps per set (Left/Right for unilateral). Optional "reps left in tank" (0/1/2/3+) on the last set. Drop sets are added to a set (with Left/Right reps for unilateral exercises) and count for volume, not for recommendations.
4. **Rest time**: time between "set done" taps of the same exercise. Switching to another exercise is not counted as rest.
5. **Finish**: summary of target vs actual.

The active session is saved continuously, so closing the app does not lose it.

## Recommendation rules (lift only; core and mobility show last session only)
Baseline = most recent session of that exercise in the same location (else any location).
For unilateral exercises, the weaker side counts. Targets are **per set**: set 1 follows set 1 of the last session, set 2 follows set 2, and so on.

1. **Double progression**: all working sets ≥ top of rep range → add one weight step and reset to the bottom of the range.
2. **Reps in reserve (last set)**: 0 → repeat, no increase · 1–2 → +1 rep · 3+ → +2 reps, or add weight if already within 1 rep of the top. Missing a target simply becomes the new baseline.
   Last set at 0 reps in tank and below range → drop one weight step.
3. **Downtrend**: estimated 1RM down two sessions in a row (same location) → hold. Down three in a row → drop one step.
4. **Context**: sleep ≤5 h → −1 rep (Home/Gym only); Offshore (12 h shift) when the baseline session was not Offshore → −1 rep. Once there is enough history (≥6 sessions in each condition), the app replaces these fixed rules with your own measured drop in performance. Tired days block a weight increase unless the last session ended with 3+ reps in reserve.
5. **Order**: the exercise is planned 2+ positions later than usual → −1 rep.
6. **Running load**: a long run (≥15 km, or type Long/Race) in the last 36 h → −1 rep for leg exercises.
7. If adjustments push reps more than 2 below the range → drop one weight step instead.

## Running
Manual entry (~30 s): date, type (Easy, Tempo, Interval, Long, Race, Treadmill), distance, duration, avg HR (optional), RPE 1–10, location, sleep, notes. Pace is calculated.
Duration can be typed on the number pad without ":" — read like a stopwatch: `4530` = 45:30, `003000` = 0:30:00, `13000` = 1:30:00, `45` = 45 min. The field shows the parsed h:mm:ss after leaving it.
Races: name, date, distance, target time, linked result → countdown on home screen.

## After Finish
Right after Finish, a short positive line sits above the muscle map, with "N exercises · N sets · N min" under it. It is chosen from the session, always positive:
- **You beat it today.** — at least one lift set a personal best. A **Personal best** card (green border) follows, listing each one: the new set in large green ("55 kg × 8") and the old record under it ("was 52.5 kg × 10 · 14 Nov").
- **You nailed it.** — every planned target was hit.
- **Done. Every session counts.** — any other day (a miss is never mentioned).
It shows only once; opening the session later from History does not show it. The muscle map itself is unchanged.

## Personal best
A set is a personal best when it is heavier than any earlier main set of that exercise, or has more reps at the same weight (weaker side for left/right; drop sets not counted). A first-ever exercise has no record to beat, so it is not a personal best.
- **During the session**: when a set marked done is a personal best, a green **PB** badge appears under it ("heaviest ever (was 52.5 kg)" or "most reps at 50 kg (was 10)") and a short "Personal best · 55 kg × 8" message shows.
- **After Finish**: the Personal best card (see After Finish).

## Mobility and core
Logged inside any session. Formats: reps / hold / distance, optional per side. No progression recommendation.

## Body weight
Optional log at any time.

## Exercise panel (tap any exercise name: plan, session, summary)
Two tabs; **Records** opens first.
- **Records** (no chart): weighted lifts show the heaviest weight lifted for **at least** N reps (so more reps never shows a heavier weight), rows 1 up to the most reps done (max 20), with the date. Left/right exercises have **Right** and **Left** columns. Reps-only exercises show the most reps in one set, holds the longest hold, distances the farthest. Main sets only (drop sets not counted); imported Hevy sessions count. No colours.
- **History**: est. 1RM chart (points coloured by location) and the last 10 sessions with location.

## Splash screen
When the app starts, Android shows its own splash: sometimes the Chrome logo first, then the app icon on the dark background, without text. For a web app on Android 12+ this screen can only hold the icon and background colour, so it cannot be changed from the app. A custom splash (logo + LIFT RUN JOURNEY, no Chrome logo) comes with the native app (ROADMAP phase 2). Home itself has no animation, so it appears instantly.

## Exercise library
Starter list plus common cable, machine, dumbbell and bodyweight exercises (v2.4, e.g. Seated Cable Row, Face Pull, Leg Extension, Arnold Press, Hip Thrust, Chin Up, Tibialis Raise), each with a muscle-map entry. An exercise the owner typed under a known alias is renamed to the standard name on start, keeping its sets ("row cable" → Seated Cable Row).

## Exercise picker
**Recent** (5 most recently used) on top, clearly labelled. Everything else A–Z, grouped Lifts / Core / Mobility. Searching shows A–Z only.

## Muscle map
Labelled body figure (front/back toggle), one green scale with clearly separated steps. Labels show muscle names only (no numbers); the legend below explains the shades in sets.
- Shown after finishing a session ("Muscles worked") and weekly in Progress (this week / last week).
- Counted in **working sets**. Primary muscle = 1 set, major helper = ½, minor helper = ¼. Mobility is not counted; core/abs is.
- The exercise → muscle table lives in `js/muscles.js` (`MUSCLE_MAP`). Unknown exercises fall back to their muscle group.

## Progress tab
Two tabs so charts never mix: **Lifting | Running**.
- **Lifting**, in two titled sections:
  - **Exercise progress** (top, used most): one exercise chosen from a searchable A–Z list. Two centred buttons of equal width: **Weight** (opens first) = the heaviest weight actually lifted in each session, and **Est. 1RM**. Points are coloured by location. Tap the chart to see the nearest point's date and weight × reps (phones have no hover). Below the chart, **Recent sessions**: the last 5 sessions with weight × reps per set ("47.5 kg × 10, 10 · 45 kg × 11"; left/right as "R10/L9"), location and set count; tap a row to open the session. Left vs Right chart for unilateral exercises.
  - **Weekly overview** (all exercises): muscle map (this week / last week), working sets per week.
- **Running** (in running blue): km per week, and pace. The pace axis is inverted (faster = higher, marked "faster ↑"). Pace has three centred buttons, **Outdoor** (opens first) | Treadmill | All, because treadmill pace is not comparable with outdoor pace. Run type is shown by the point's shape, not colour: filled = outdoor, hollow = treadmill, large with a white ring = race.

Chart axes always use whole numbers with round steps (13, 14 … 18 kg; 0, 10, 20 km; pace in round steps such as 7:00, 7:10, 7:20), so 17.5 kg sits between 17 and 18.

Body weight lives in **More → Body weight**: chart, quick add, and the list of entries.

## Navigation (Back button)
Behaves like a normal Android app:
- Back on **Home** leaves the app.
- Back on a tab (History, Progress, More) returns to Home.
- Back on a detail page returns to its parent (session → History, Exercises → More).
- Back closes an open sheet (exercise picker, exercise history) before leaving the page.
- After Finish or saving a new run, Back does not return to the finished screen.
- There is no "Close app" button (not an Android convention).
- Home and tabs opened from the bottom menu start at the top. A page reached with Back (e.g. the History list after opening a session) returns to where it was.

## Versions
Shown at the bottom of More. v2.0 = first full release after the initial build (v1–v9). Small updates: v2.1, v2.2…; a big redesign: v3.0.

## Tests
`node tests/run.mjs` before every pull request (see `tests/README.md`). Fake data only.

## Known issues (watching)
- iPhone (iOS 26.5, home-screen app): once, the bottom menu moved down while scrolling and its labels were partly hidden. It could not be repeated (not after reopening, not after using the keyboard), so nothing was changed. If it comes back, note what was done just before.

Tested on iPhone 13 (iOS 26.5): install to home screen, restore, typing kg/reps (no zoom, comma decimals), panels with Close, Log a run, Progress, Share backup, offline.

## Data
- **Share backup**: one tap opens the Android share sheet (Gmail, Drive, WhatsApp) so the file leaves the phone. The shared file ends in `.txt` (Android only shares certain file types; the content is the same JSON). Falls back to saving in Downloads where sharing is not available. Restore accepts `.json` and `.txt`. **Save to phone** keeps the plain download.
- **Restore** first shows what is in the file (date, sessions, runs, body weight) next to what is on the phone, then asks before replacing everything.
- Export for Excel: CSV (two files: sets, runs).
- Backup reminder: a small dot on the **More** tab after 7 days without a backup. No warning text on the home screen.
- Import: JSON backup (restore), Hevy CSV.

### Hevy CSV import
- Location: dates within the offshore periods you enter → Offshore. Otherwise sessions with machine/cable exercises → Gym, the rest → Home.
- Treadmill rows are not imported. They only help decide the location.
- "Running" rows → runs (editable afterwards, e.g. race date).
- "Stretching" rows → mobility with duration.
- Notes "Kiri beda N" → Left = Right − N for unilateral exercises. All other notes are kept as text.
- Weights are imported exactly as recorded (some exercises are a total of 2 dumbbells).

## Colours
One meaning per colour, taken from the logo:
- **Green** (#5fd0a6, the barbell) = lifting, and the app's general accent.
- **Blue** (#6ea8fe, the run line) = running: the Run button and "km run" on Home, the race countdown, Log a run, Races, and Progress → Running.
- **Purple / orange / red** = locations only (Home / Gym / Offshore), as small dots and badges. They are never used for anything else.
Keep it to these; no new colours for other features.

## Home screen
Design option A ("Poster"), Android system font, same colours as the rest of the app:
- **Logo** (large, centred) with LIFT RUN JOURNEY underneath — the most prominent element.
- **Daily line** second: thin type, centred, with the author in small green capitals. Sundays always show "No human is limited. — Eliud Kipchoge".
- Greeting by time of day and a last-30-days line (sessions and km).
- Resume card (session in progress) and next race countdown when they apply.
- **Lift** ("Start a session") / **Run** ("Log a finished run"), This week (sessions, working sets, km), and **Recent**: at most 5 rows, date on the left, one short line each ("6 exercises · 14 sets" / "4 km · 7:30/km"), location as a coloured dot, "See all" → History.
- Tone: positive. No warnings or negative messages on the home screen.

## Updates and data use
- Service worker is cache-first: opening the app uses no data except the browser's ~1 KB check of `sw.js`.
- The full app (~120 KB) downloads again only when `VERSION` in `sw.js` changes.
- A new version reloads the app automatically, except while a session or run is being logged.
- The browser checks for a new version when the app is opened from scratch. To check any time: **More → Check for updates** ("Updating…", "You're on the latest version", or "No internet").
- Pull-to-refresh is disabled, so pulling the screen down never reloads the app like a web page.
- Text on screen cannot be selected (fields you type in can), so tapping or pressing text never opens Chrome's Touch to Search or the iPhone copy menu.
- Every release: bump `VERSION` in `sw.js` and `APP_VERSION` in `js/app.js` (shown at the bottom of More).

## Security
- Content-Security-Policy in `index.html`: the app loads only its own files and cannot connect to other hosts.
- `main` is protected by the `protect-main` ruleset (no deletion, no force push, pull request required).
- Owner account uses 2FA. Changes reach the phone only after the owner merges a pull request.

## Tech
Vanilla JS (ES modules), no build step, IndexedDB, service worker for offline use, hand-written SVG charts. Hosted on GitHub Pages from `main`.
