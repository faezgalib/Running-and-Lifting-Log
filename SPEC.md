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

## Mobility and core
Logged inside any session. Formats: reps / hold / distance, optional per side. No progression recommendation.

## Body weight
Optional log at any time.

## Exercise history
Tap an exercise name (plan, session, summary) → last 10 sessions of that exercise with date, location, sets, est. 1RM and reps in reserve, plus a small chart.

## Exercise picker
**Recent** (5 most recently used) on top, clearly labelled. Everything else A–Z, grouped Lifts / Core / Mobility. Searching shows A–Z only.

## Muscle map
Labelled body figure (front/back toggle), one green scale with clearly separated steps. Labels show muscle names only (no numbers); the legend below explains the shades in sets.
- Shown after finishing a session ("Muscles worked") and weekly in Progress (this week / last week).
- Counted in **working sets**. Primary muscle = 1 set, major helper = ½, minor helper = ¼. Mobility is not counted; core/abs is.
- The exercise → muscle table lives in `js/muscles.js` (`MUSCLE_MAP`). Unknown exercises fall back to their muscle group.

## Progress tab
Three tabs so charts never mix:
- **Lifts**: muscle map (this week / last week), progress for one exercise (est. 1RM or top set, points colored by location; Left vs Right for unilateral), working sets per week.
  The exercise is chosen from a searchable A–Z list (type to filter).
- **Running**: km per week, and pace for every run. The pace axis is inverted (faster = higher, marked "faster ↑").
- **Body**: body weight chart with a quick "+ Add weight" form.

## Data
- Export: full JSON backup + CSV for Excel (two files: sets, runs).
- Backup reminder: a small dot on the **More** tab after 7 days without a backup. No warning text on the home screen.
- Import: JSON backup (restore), Hevy CSV.

### Hevy CSV import
- Location: dates within the offshore periods you enter → Offshore. Otherwise sessions with machine/cable exercises → Gym, the rest → Home.
- Treadmill rows are not imported. They only help decide the location.
- "Running" rows → runs (editable afterwards, e.g. race date).
- "Stretching" rows → mobility with duration.
- Notes "Kiri beda N" → Left = Right − N for unilateral exercises. All other notes are kept as text.
- Weights are imported exactly as recorded (some exercises are a total of 2 dumbbells).

## Home screen
- Logo, app name, greeting by time of day.
- One positive line per day (rotating list). Sundays always show "No human is limited. — Eliud Kipchoge".
- Last-30-days summary (sessions, runs, km), next race countdown, quick actions, recent activity.
- Tone: positive. No warnings or negative messages on the home screen.

## Updates and data use
- Service worker is cache-first: opening the app uses no data except the browser's ~1 KB check of `sw.js`.
- The full app (~120 KB) downloads again only when `VERSION` in `sw.js` changes.
- A new version reloads the app automatically, except while a session or run is being logged.
- Every release: bump `VERSION` in `sw.js` and `APP_VERSION` in `js/app.js` (shown at the bottom of More).

## Security
- Content-Security-Policy in `index.html`: the app loads only its own files and cannot connect to other hosts.
- `main` is protected by the `protect-main` ruleset (no deletion, no force push, pull request required).
- Owner account uses 2FA. Changes reach the phone only after the owner merges a pull request.

## Tech
Vanilla JS (ES modules), no build step, IndexedDB, service worker for offline use, hand-written SVG charts. Hosted on GitHub Pages from `main`.
