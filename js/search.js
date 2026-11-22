// Forgiving exercise search: names, short forms (RDL, DB, BB), muscle names and small typos.
// Pure functions, no DOM, so the release tests can check them directly.

// Short forms people type at the gym → the words in the exercise name.
export const SHORT_FORMS = { rdl: ['romanian', 'deadlift'], db: ['dumbbell'], bb: ['barbell'] };

const words = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

// Query → groups of words; every group must match. A short form expands to several required words.
const queryWords = q => words(q).flatMap(w => SHORT_FORMS[w] || [w]);

// Edit distance with swapped letters counting as one edit ("deadlfit" → "deadlift" = 1).
export function typoDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// How many typos a word may have: none for short words (row, fly), 1 from 4 letters, 2 from 8.
const allowed = w => (w.length >= 8 ? 2 : w.length >= 4 ? 1 : 0);

// Best way one query word fits a list of words: 0 = contained, n = n typos, null = no fit.
function fit(qw, list) {
  if (list.some(w => w.includes(qw))) return 0;
  const max = allowed(qw);
  if (!max) return null;
  let best = null;
  for (const w of list) {
    // Compare with the whole word and with its start, so a typo in a word still being typed counts too.
    const d = Math.min(typoDistance(qw, w), w.length > qw.length ? typoDistance(qw, w.slice(0, qw.length)) : Infinity);
    if (d <= max && (best == null || d < best)) best = d;
  }
  return best;
}

/**
 * exercises: the list to search. muscleNamesOf(ex) → e.g. ['Hamstrings', 'Glutes'] (main muscles).
 * Returns { matches, suggestions }:
 *  - matches: exercises whose name (or short form) contains every word, plus those that match through a muscle
 *    when the name also matched something ("chest" → Chest Fly and Bench Press).
 *  - suggestions ("Did you mean"): only when nothing matched by name; muscle matches first, then typos, at most 5.
 *    Each is { ex, why } where why is the muscle name that matched, or ''.
 */
export function searchExercises(exercises, q, muscleNamesOf) {
  const qws = queryWords(q);
  if (!qws.length) return { matches: exercises, suggestions: [] };
  const byName = [], byMuscle = [], byTypo = [];
  for (const ex of exercises) {
    const nameW = words(ex.name);
    const muscles = muscleNamesOf(ex) || [];
    const muscleW = muscles.flatMap(words);
    if (qws.every(w => fit(w, nameW) === 0)) { byName.push(ex); continue; }
    let typos = 0, why = '', ok = true;
    for (const w of qws) {
      const n = fit(w, nameW), m = fit(w, muscleW);
      if (n === 0) continue;
      if (m === 0) { why = why || muscles.find(x => words(x).some(y => y.includes(w))) || ''; continue; }
      const d = [n, m].filter(x => x != null);
      if (!d.length) { ok = false; break; }
      typos += Math.min(...d);
    }
    if (!ok) continue;
    if (typos === 0) byMuscle.push({ ex, why }); else byTypo.push({ ex, why, typos });
  }
  byTypo.sort((a, b) => a.typos - b.typos || a.ex.name.localeCompare(b.ex.name));
  if (byName.length) return { matches: [...byName, ...byMuscle.map(x => x.ex)], suggestions: [] };
  return { matches: [], suggestions: [...byMuscle, ...byTypo].slice(0, 5) };
}
