// Fake training data in Hevy's CSV export format. Generated at test time, never stored as a .csv file,
// so the repo's ".csv is ignored" rule stays intact and no real training data is ever committed.

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = n => String(n).padStart(2, '0');
const hevyDate = d => `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const q = v => (v === '' || v == null ? '' : typeof v === 'number' ? String(v) : `"${String(v).replace(/"/g, '""')}"`);

const HEADER = ['title', 'start_time', 'end_time', 'description', 'exercise_title', 'superset_id', 'exercise_notes', 'set_index', 'set_type', 'weight_kg', 'reps', 'distance_km', 'duration_seconds', 'rpe'];

// Offshore block used by the tests (dates inside it are tagged Offshore on import).
export const OFFSHORE_PERIOD = '2026-02-02 to 2026-03-01';

/** 30 sessions every 3 days from 5 Jan 2026, plus a few runs. Returns CSV text. */
export function sampleHevyCsv() {
  const rows = [HEADER.join(',')];
  const add = (start, ex, sets, note = '') => {
    const end = new Date(start.getTime() + 55 * 60000);
    sets.forEach((s, i) => rows.push([
      q('Morning workout'), q(hevyDate(start)), q(hevyDate(end)), q(''), q(ex), '', q(note), i, q('normal'),
      s.w ?? '', s.r ?? '', s.km ?? '', s.sec ?? '', '',
    ].join(',')));
  };
  for (let i = 0; i < 30; i++) {
    const d = new Date(2026, 0, 5 + i * 3, 6, 40);
    const offshore = d >= new Date(2026, 1, 2) && d <= new Date(2026, 2, 1, 23, 59);
    const bump = Math.floor(i / 4);
    add(d, 'Bench Press (Dumbbell)', [{ w: 14 + bump * 0.5, r: 10 }, { w: 14 + bump * 0.5, r: 8 }]);
    add(d, 'Concentration Curl', [{ w: 10, r: 10 + (i % 3) }, { w: 10, r: 9 }], i % 5 === 0 ? 'Kiri beda 2' : '');
    add(d, 'Goblet Squat', [{ w: 16 + bump, r: 12 }, { w: 16 + bump, r: 11 }]);
    add(d, 'Crunch', [{ r: 20 }, { r: 18 }]);
    add(d, 'Side Plank', [{ sec: 40 }, { sec: 40 }]);
    if (i % 4 === 1 && !offshore) add(d, 'Leg Press (Machine)', [{ w: 60, r: 12 }, { w: 65, r: 10 }]);
    if (offshore && i % 2 === 0) add(d, 'Treadmill', [{ km: 5, sec: 2400 }]);
    if (i % 3 === 0) add(new Date(d.getTime() + 864e5), 'Running', [{ km: 6 + (i % 4), sec: (6 + (i % 4)) * (420 + (i % 5) * 10) }]);
  }
  return rows.join('\n') + '\n';
}
