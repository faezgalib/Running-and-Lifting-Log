// Recommendation engine. Rule-based first; context penalties switch to measured values once enough data exists.
import { e1rm, parseLocal } from './util.js';
import { effStep } from './seed.js';

export const repsOf = (set, ex) => {
  if (ex.unilateral || ex.perSide) {
    const v = [set.rL, set.rR].filter(x => x != null);
    if (v.length) return Math.min(...v);
  }
  return set.r ?? null;
};

export const workingSets = (entry, ex) => (entry.sets || []).filter(s => repsOf(s, ex) != null && repsOf(s, ex) > 0);

export function entryBest(entry, ex) {
  let best = null;
  for (const s of workingSets(entry, ex)) {
    const r = repsOf(s, ex), w = s.w || 0;
    const v = w > 0 ? e1rm(w, r) : r; // bodyweight: reps as score
    if (!best || v > best.score) best = { w, r, score: v };
  }
  return best;
}

// Heaviest weight actually lifted in a session (main sets only); ties go to more reps.
export function heaviestSet(entry, ex) {
  let top = null;
  for (const s of workingSets(entry, ex)) {
    const w = s.w || 0, r = repsOf(s, ex);
    if (w > 0 && (!top || w > top.w || (w === top.w && r > top.r))) top = { w, r };
  }
  return top;
}

// One line per session for weight + reps exercises, grouped by weight in set order:
// "47.5 kg × 10, 10 · 45 kg × 11"; left/right as "R10/L9". Bodyweight sets show reps only.
export function setsLine(entry, ex, unit = 'kg') {
  const two = ex.unilateral || ex.perSide;
  const reps = s => (two && (s.rL != null || s.rR != null) ? `R${s.rR ?? '–'}/L${s.rL ?? '–'}` : `${s.r ?? '–'}`);
  const groups = [];
  for (const s of workingSets(entry, ex)) {
    const w = s.w || 0, g = groups[groups.length - 1];
    if (g && g.w === w) g.reps.push(reps(s)); else groups.push({ w, reps: [reps(s)] });
  }
  return groups.map(g => (g.w ? `${+g.w.toFixed(2)} ${unit} × ${g.reps.join(', ')}` : `${g.reps.join(', ')} reps`)).join(' · ');
}

// Done sessions that contain the exercise, newest first.
export function historyFor(exId, sessions, beforeIso) {
  return sessions
    .filter(s => s.status === 'done' && (!beforeIso || s.start < beforeIso))
    .map(s => ({ s, entry: s.entries.find(e => e.exId === exId) }))
    .filter(x => x.entry && x.entry.sets && x.entry.sets.length)
    .sort((a, b) => (a.s.start < b.s.start ? 1 : -1));
}

// Offshore always means a 12 h shift before training; Home/Gym means no work.
export const afterShift = s => s && s.location === 'Offshore';

// Measured performance drop (fraction) under low sleep / long work, from app-logged sessions.
export function learnFactors(sessions, exercises) {
  const exById = Object.fromEntries(exercises.map(e => [e.id, e]));
  const groups = { sleepLow: [], sleepOk: [], work12: [], workOk: [] };
  const done = sessions.filter(s => s.status === 'done').sort((a, b) => (a.start < b.start ? -1 : 1));
  const prior = {}; // exId|location -> recent scores
  for (const s of done) {
    for (const e of s.entries) {
      const ex = exById[e.exId];
      if (!ex || ex.kind !== 'lift') continue;
      const b = entryBest(e, ex);
      if (!b) continue;
      const key = e.exId + '|' + s.location;
      const hist = prior[key] || (prior[key] = []);
      if (hist.length >= 2 && s.source !== 'hevy') {
        const ref = [...hist.slice(-3)].sort((a, c) => a - c)[Math.floor(Math.min(3, hist.length) / 2)];
        const ratio = b.score / ref;
        // Sleep is only meaningful away from the rig (offshore training always follows a 12 h shift).
        if (s.sleep != null && !afterShift(s)) (s.sleep <= 5 ? groups.sleepLow : groups.sleepOk).push(ratio);
        (afterShift(s) ? groups.work12 : groups.workOk).push(ratio);
      }
      hist.push(b.score);
    }
  }
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const f = (low, ok) => (low.length >= 6 && ok.length >= 6 ? Math.max(0, Math.min(0.25, 1 - mean(low) / mean(ok))) : null);
  return { sleep: f(groups.sleepLow, groups.sleepOk), work: f(groups.work12, groups.workOk), n: groups.sleepLow.length + groups.sleepOk.length };
}

// Reps lost when performance drops by pct at the same weight (inverse Epley).
const repsLost = (reps, pct) => Math.round((30 + reps) * pct);

const mode = arr => {
  const c = {};
  arr.forEach(v => { c[v] = (c[v] || 0) + 1; });
  return +Object.entries(c).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
};

export function lastSummary(exId, sessions, beforeIso) {
  const h = historyFor(exId, sessions, beforeIso)[0];
  return h ? { date: h.s.start, location: h.s.location, sets: h.entry.sets } : null;
}

/**
 * ctx: { location, sleep, start (iso), position (0-based) }
 * returns { kind: 'rec'|'last'|'none', weight, reps (lowest set), repsBySet[], sets, reasons[], base }
 */
export function recommend(ex, ctx, { sessions, runs = [], learned = {} }) {
  if (ex.kind !== 'lift') {
    const last = lastSummary(ex.id, sessions, ctx.start);
    return { kind: last ? 'last' : 'none', last, reasons: [] };
  }
  const hist = historyFor(ex.id, sessions, ctx.start);
  if (!hist.length) return { kind: 'none', reasons: ['No history yet. Start with a weight you can lift for about 10 clean reps.'] };

  const reasons = [];
  const same = hist.filter(h => h.s.location === ctx.location);
  const pool = same.length ? same : hist;
  const base = pool[0];
  if (!same.length) reasons.push(`No ${ctx.location} history yet. Based on your last ${base.s.location} session.`);

  const sets = workingSets(base.entry, ex);
  const step = effStep(ex);
  const bw = ex.format === 'r' || step === 0;
  let w = bw ? null : mode(sets.map(s => s.w || 0));
  const atW = bw ? sets : sets.filter(s => (s.w || 0) === w);
  const reps = atW.map(s => repsOf(s, ex));
  const minR = Math.min(...reps);
  const nSets = Math.max(1, sets.length);
  // Per-set baseline: set i follows set i of the last session (later sets are usually lower).
  const baseBySet = Array.from({ length: nSets }, (_, i) => reps[Math.min(i, reps.length - 1)]);
  const lastRir = atW.length ? atW[atW.length - 1].rir : null;
  const rirTxt = lastRir == null ? '' : lastRir >= 3 ? '3+ reps left' : `${lastRir} rep${lastRir === 1 ? '' : 's'} left`;
  const lo = ex.repMin || 8, hi = ex.repMax || 12;
  const kg = v => `${v} kg`;

  // Trend (same location): estimated 1RM across the last sessions, newest first.
  const scores = pool.slice(0, 4).map(h => (entryBest(h.entry, ex) || {}).score || 0);
  const drops = (() => { let n = 0; for (let i = 0; i < scores.length - 1 && scores[i] < scores[i + 1]; i++) n++; return n; })();

  let targets, increased = false;
  const baseW = w;
  const all = v => baseBySet.map(() => v);
  if (drops >= 3 && !bw && w - step > 0) {
    w = +(w - step).toFixed(2); targets = all(lo);
    reasons.push(`Performance down 3 sessions in a row → drop ${step} kg and rebuild.`);
  } else if (drops >= 2) {
    targets = [...baseBySet];
    reasons.push('Performance down 2 sessions in a row → hold, repeat last session.');
  } else if (lastRir === 0 && minR < lo && !bw && w - step > 0) {
    w = +(w - step).toFixed(2); targets = all(lo);
    reasons.push(`Last set hit failure below ${lo} reps → drop ${step} kg.`);
  } else if (reps.every(r => r >= hi) || (lastRir >= 3 && minR >= hi - 1)) {
    const why = reps.every(r => r >= hi) ? `All sets hit ${hi} reps` : `${minR} reps with ${rirTxt}`;
    if (bw) { const inc = lastRir >= 3 ? 2 : 1; targets = baseBySet.map(r => r + inc); reasons.push(`${why} → +${inc} rep${inc > 1 ? 's' : ''}.`); }
    else { w = +(w + step).toFixed(2); targets = all(lo); increased = true; reasons.push(`${why} → +${step} kg, back to ${lo} reps.`); }
  } else {
    // Reps in the tank on the last set decide the size of the step.
    const inc = lastRir === 0 ? 0 : lastRir >= 3 ? 2 : 1;
    targets = baseBySet.map(r => Math.min(r + inc, Math.max(hi, r)));
    const lastTxt = `Last: ${[...new Set(baseBySet)].length > 1 ? baseBySet.join(', ') : minR} reps${w != null ? ` at ${kg(w)}` : ''}`;
    reasons.push(inc === 0 ? `${lastTxt}, last set to failure → repeat, no increase.`
      : inc === 2 ? `${lastTxt} with ${rirTxt} → +2 reps.`
      : `${lastTxt}${rirTxt ? ` with ${rirTxt}` : ''} → +1 rep.`);
  }

  // Context adjustments relative to the baseline session's context.
  let adj = 0;
  const offshore = afterShift(ctx);
  // Offshore: sleep is recorded but not used. The offshore baseline already reflects training after a shift.
  const lowSleep = !offshore && ctx.sleep != null && ctx.sleep <= 5;
  const baseLowSleep = !afterShift(base.s) && base.s.sleep != null && base.s.sleep <= 5;
  const tMax = Math.max(...targets);
  if (lowSleep && !baseLowSleep) {
    const n = learned.sleep != null ? repsLost(tMax, learned.sleep) : 1;
    if (n) { adj -= n; reasons.push(learned.sleep != null ? `Low sleep: your data shows −${Math.round(learned.sleep * 100)}% → −${n} rep.` : 'Low sleep (≤5 h) → −1 rep.'); }
  }
  if (offshore && !afterShift(base.s)) {
    const n = learned.work != null ? repsLost(tMax, learned.work) : 1;
    if (n) { adj -= n; reasons.push(learned.work != null ? `Offshore after a 12 h shift: your data shows −${Math.round(learned.work * 100)}% → −${n} rep.` : 'Offshore after a 12 h shift (baseline was not) → −1 rep.'); }
  }
  if (ctx.position != null) {
    const orders = hist.slice(0, 5).map(h => h.entry.order).filter(o => o != null);
    if (orders.length) {
      const usual = orders.reduce((a, b) => a + b, 0) / orders.length;
      if (ctx.position - usual >= 2) { adj -= 1; reasons.push(`Later in the session than usual (#${ctx.position + 1} vs ~#${Math.round(usual) + 1}) → −1 rep.`); }
    }
  }
  if (ex.group === 'legs' && ctx.start) {
    const t = parseLocal(ctx.start).getTime();
    const long = runs.find(r => {
      const dt = (t - parseLocal(r.date).getTime()) / 3600000;
      return dt >= 0 && dt <= 36 && (r.distKm >= 15 || r.type === 'Long' || r.type === 'Race');
    });
    if (long) { adj -= 1; reasons.push(`Long run in the last 36 h (${long.distKm} km) → −1 rep for legs.`); }
  }

  // Tired today: don't add weight, unless the last session clearly had room (3+ reps left).
  if (increased && adj < 0 && !(lastRir >= 3)) {
    w = baseW;
    targets = baseBySet.map(r => Math.min(r, hi + 2));
    reasons.push(`Not a day to add weight → stay at ${kg(baseW)}.`);
  }

  let finalBySet = targets.map(t => t + adj);
  if (Math.min(...finalBySet) < lo - 2 && !bw && w - step > 0) {
    w = +(w - step).toFixed(2);
    finalBySet = [...targets];
    reasons.push(`Too many reps lost → drop ${step} kg instead.`);
  }
  finalBySet = finalBySet.map(r => Math.max(1, r));
  const finalReps = Math.min(...finalBySet);

  return {
    kind: 'rec', weight: w, reps: finalReps, repsBySet: finalBySet, sets: nSets, reasons,
    base: { date: base.s.start, location: base.s.location, sets: base.entry.sets },
  };
}
