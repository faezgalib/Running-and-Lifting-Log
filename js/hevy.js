// Hevy CSV → app data.
import { parseCSV, uid, pad } from './util.js';
import { classify } from './seed.js';

const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

// "13 Nov 2026, 06:47" → "2026-11-13T06:47"
export function hevyDate(s) {
  const m = /^(\d{1,2}) (\w{3}) (\d{4}), (\d{1,2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  return `${m[3]}-${pad(MON[m[2]])}-${pad(m[1])}T${pad(m[4])}:${m[5]}`;
}

// "2026-07-16 to 2026-08-20" per line.
export function parsePeriods(text) {
  return (text || '').split(/\n+/).map(l => /(\d{4}-\d{2}-\d{2})\s*(?:to|-|–)\s*(\d{4}-\d{2}-\d{2})/.exec(l)).filter(Boolean).map(m => [m[1], m[2]]);
}

const SKIP = new Set(['Treadmill']);
const RUN = new Set(['Running']);
const isMachine = n => /\(machine\)|\(cable\)|pushdown|pulldown/i.test(n);

/**
 * Returns { sessions, runs, exercises (new ones), stats } — nothing is written here.
 * existing: current exercise list (matched by name).
 */
export function convertHevy(text, periodsText, existing = []) {
  const rows = parseCSV(text);
  if (!rows.length || !('exercise_title' in rows[0])) throw new Error('This does not look like a Hevy workout export.');
  const periods = parsePeriods(periodsText);
  const exByName = Object.fromEntries(existing.map(e => [e.name.toLowerCase(), e]));
  const newEx = [];
  const getEx = name => {
    const k = name.toLowerCase();
    if (!exByName[k]) { const e = classify(name); exByName[k] = e; newEx.push(e); }
    return exByName[k];
  };

  const bySession = new Map();
  for (const r of rows) {
    const key = r.start_time + '|' + r.title;
    if (!bySession.has(key)) bySession.set(key, []);
    bySession.get(key).push(r);
  }

  const sessions = [], runs = [];
  const stats = { sessions: 0, sets: 0, runs: 0, skipped: 0, lr: 0, loc: { Home: 0, Gym: 0, Offshore: 0 } };

  for (const [, rs] of bySession) {
    const start = hevyDate(rs[0].start_time);
    const end = hevyDate(rs[0].end_time);
    if (!start) continue;
    const day = start.slice(0, 10);
    const names = new Set(rs.map(r => r.exercise_title));
    const offshore = periods.some(([a, b]) => day >= a && day <= b);
    const location = offshore ? 'Offshore' : [...names].some(isMachine) ? 'Gym' : 'Home';

    const entries = [];
    const entryMap = new Map();
    for (const r of rs) {
      const name = r.exercise_title;
      if (SKIP.has(name)) { stats.skipped++; continue; }
      if (RUN.has(name)) {
        const km = parseFloat(r.distance_km) || 0, sec = parseFloat(r.duration_seconds) || 0;
        if (km || sec) {
          runs.push({ id: uid(), date: start, type: km >= 15 ? 'Long' : 'Easy', distKm: km, durSec: sec, avgHr: null, rpe: null, location, sleep: null, work: null, notes: r.exercise_notes || '', source: 'hevy' });
          stats.runs++;
        }
        continue;
      }
      const ex = getEx(name);
      if (!entryMap.has(name)) {
        const e = { exId: ex.id, order: entries.length, sets: [], note: r.exercise_notes || '' };
        entryMap.set(name, e); entries.push(e);
      }
      const e = entryMap.get(name);
      const w = r.weight_kg !== '' ? parseFloat(r.weight_kg) : null;
      const reps = r.reps !== '' ? parseInt(r.reps, 10) : null;
      const sec = r.duration_seconds !== '' ? parseFloat(r.duration_seconds) : null;
      const dist = r.distance_km !== '' ? parseFloat(r.distance_km) * 1000 : null;
      const rpe = r.rpe !== '' ? parseFloat(r.rpe) : null;
      const set = { w, r: reps, sec, m: dist, rpe, drop: [] };
      if (ex.unilateral || ex.perSide) {
        if (ex.format === 'hold') { set.secL = sec; set.secR = sec; } else { set.rL = reps; set.rR = reps; }
      }
      e.sets.push(set);
      stats.sets++;
    }
    // "Kiri beda N" → left side N reps fewer.
    for (const e of entries) {
      const m = /kiri beda (\d+)/i.exec(e.note || '');
      const ex = existingOrNew(e.exId);
      if (m && ex && ex.unilateral) {
        const n = parseInt(m[1], 10);
        e.sets.forEach(s => { if (s.rR != null) { s.rL = Math.max(0, s.rR - n); stats.lr++; } });
      }
    }
    if (!entries.length) continue;
    sessions.push({ id: uid(), start, end, location, sleep: null, work: null, entries, status: 'done', source: 'hevy', title: rs[0].title });
    stats.sessions++;
    stats.loc[location]++;
  }

  function existingOrNew(id) { return Object.values(exByName).find(e => e.id === id); }

  return { sessions, runs, exercises: newEx, stats };
}
