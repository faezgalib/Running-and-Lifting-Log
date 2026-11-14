import { db, STORES, requestPersistence } from './db.js';
import {
  uid, esc, isoDate, isoDateTime, parseLocal, fmtDate, fmtShort, fmtTime, fmtDur, parseDur, fmtPace,
  num, fmtKg, e1rm, daysBetween, downloadFile, toCSV,
} from './util.js';
import { classify, STARTER, GROUPS, defaultStep, effStep } from './seed.js';
import { recommend, learnFactors, repsOf, workingSets, entryBest } from './recommend.js';
import { convertHevy } from './hevy.js';
import { lineChart, barChart, legend, LOC_COLORS } from './charts.js';

// ---------- state ----------
const S = { exercises: [], sessions: [], runs: [], races: [], bodyweight: [], meta: {} };
let draft = null;          // plan being built
let ui = { histFilter: 'all', progEx: null, progMetric: 'e1rm', openWhy: {}, hevy: null, picker: null };
const APP_VERSION = 'v4';
const LOCS = ['Home', 'Gym', 'Offshore'];
const SLEEP = [[4, '≤4'], [5, '5'], [6, '6'], [7, '7'], [8, '8+']];
const RUN_TYPES = ['Easy', 'Tempo', 'Interval', 'Long', 'Race', 'Treadmill'];
const $app = () => document.getElementById('app');
const exById = id => S.exercises.find(e => e.id === id);
const nowIso = () => isoDateTime(new Date());
const today = () => isoDate(new Date());

async function load() {
  for (const s of STORES) {
    if (s === 'meta') {
      const rows = await db.all('meta');
      S.meta = Object.fromEntries(rows.map(r => [r.id, r.value]));
    } else S[s] = await db.all(s);
  }
  if (!S.exercises.length) {
    S.exercises = STARTER.map(classify);
    await db.putMany('exercises', S.exercises);
  }
  draft = S.meta.draft || null;
}

const save = (store, obj) => {
  const arr = S[store];
  const i = arr.findIndex(x => x.id === obj.id);
  if (i >= 0) arr[i] = obj; else arr.push(obj);
  return db.put(store, obj);
};
const remove = (store, id) => { S[store] = S[store].filter(x => x.id !== id); return db.del(store, id); };
const setMeta = (k, v) => { S.meta[k] = v; return db.setMeta(k, v); };

let saveTimer;
const saveSoon = (store, obj) => { clearTimeout(saveTimer); saveTimer = setTimeout(() => save(store, obj), 300); };

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

// ---------- helpers ----------
const doneSessions = () => S.sessions.filter(s => s.status === 'done');
const activeSession = () => S.sessions.find(s => s.status === 'active');
const locBadge = l => (l ? `<span class="badge loc-${l.toLowerCase()}">${l}</span>` : '');
const chips = (name, opts, val) => `<div class="chips">${opts.map(([v, label]) => `<button class="chip ${String(v) === String(val) ? 'on' : ''}" data-act="chip" data-name="${name}" data-val="${esc(v)}">${esc(label)}</button>`).join('')}</div>`;
const weekKey = iso => { const d = parseLocal(iso); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return isoDate(d); };
const isLift = ex => ex && ex.kind === 'lift';
const unitW = ex => (ex.load === 'total' ? 'kg total' : 'kg');
const sides = ex => ex.unilateral || ex.perSide;

function fmtTarget(rec, ex) {
  if (!rec || rec.kind !== 'rec') return '';
  const w = rec.weight != null && ex.format === 'wr' ? ` @ ${fmtKg(rec.weight)} ${unitW(ex)}` : '';
  return `${rec.sets} × ${rec.reps}${sides(ex) ? '/side' : ''}${w}`;
}

function fmtSet(s, ex) {
  const side = (l, r, u) => (l != null || r != null ? `R ${r ?? '–'}${u} · L ${l ?? '–'}${u}` : null);
  let out;
  if (ex.format === 'hold') out = (sides(ex) && side(s.secL, s.secR, 's')) || `${s.sec ?? '–'}s`;
  else if (ex.format === 'dist') out = `${s.m ?? '–'} m`;
  else {
    const reps = (sides(ex) && side(s.rL, s.rR, '')) || `${s.r ?? '–'}`;
    out = ex.format === 'wr' && s.w != null ? `${fmtKg(s.w)} × ${reps}` : `${reps} reps`;
  }
  if (s.drop && s.drop.length) out += ` <span class="muted">→ ${s.drop.map(d => `${fmtKg(d.w)}×${d.r ?? '–'}`).join(' → ')}</span>`;
  return out;
}

function lastText(last, ex) {
  if (!last) return 'No history yet.';
  return `Last (${fmtShort(last.date)}, ${last.location}): ${last.sets.map(s => fmtSet(s, ex)).join(', ')}`;
}

// ---------- router ----------
const routes = {};
function route() {
  const [path, ...args] = (location.hash.slice(2) || '').split('/');
  const fn = routes[path] || routes[''];
  if (path !== 'run') ui.runEdit = null;
  if (path !== 'races') ui.raceEdit = null;
  ui.picker = null;
  window.scrollTo(0, 0);
  render(fn, args);
}
let current = null;
function render(fn = current?.fn, args = current?.args || []) {
  current = { fn, args };
  const tab = fn.tab || '';
  $app().innerHTML = `<main>${fn(...args)}</main>${nav(tab)}`;
  if (fn.after) fn.after(...args);
}
const rerender = () => { const y = window.scrollY; render(); window.scrollTo(0, y); };
const go = h => { if (location.hash === h) route(); else location.hash = h; };

function nav(tab) {
  const items = [['', 'Home', 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z'], ['history', 'History', 'M12 7v5l3 2M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9z'], ['progress', 'Progress', 'M4 19V9m6 10V5m6 14v-7m4 7H2'], ['more', 'More', 'M5 12h.01M12 12h.01M19 12h.01']];
  return `<nav class="tabbar">${items.map(([h, l, d]) => `<a href="#/${h}" class="${tab === h ? 'on' : ''}">${h === 'more' && backupDue() ? '<i class="dot" aria-label="Backup due"></i>' : ''}<svg viewBox="0 0 24 24"><path d="${d}"/></svg><span>${l}</span></a>`).join('')}</nav>`;
}

// ---------- HOME ----------
routes[''] = function home() {
  const act = activeSession();
  const nextRace = S.races.filter(r => r.date >= today()).sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  const wk = weekKey(nowIso());
  const wkSess = doneSessions().filter(s => weekKey(s.start) === wk);
  const wkRuns = S.runs.filter(r => weekKey(r.date) === wk);
  const wkSets = wkSess.reduce((a, s) => a + s.entries.reduce((b, e) => b + (isLift(exById(e.exId)) ? workingSets(e, exById(e.exId)).length : 0), 0), 0);
  const km = wkRuns.reduce((a, r) => a + (r.distKm || 0), 0);
  return `
  <header class="hero">
    <img src="icons/icon-192.png" alt="" width="44" height="44">
    <div><h1>Lift Run Journey</h1><span class="muted small">${greeting()}</span></div>
  </header>
  <div class="card quote"><p>${esc(dailyLine())}</p><span class="muted small">${esc(momentum())}</span></div>
  ${act ? `<a class="card resume" href="#/workout/${act.id}"><b>Session in progress</b><span>${locBadge(act.location)} started ${fmtTime(act.start)} · ${act.entries.length} exercises</span><span class="go">Resume →</span></a>` : ''}
  ${nextRace ? `<div class="card race"><div class="big">${daysBetween(today(), nextRace.date)}</div><div><b>days to ${esc(nextRace.name)}</b><span class="muted">${fmtDate(nextRace.date)} · ${nextRace.distKm} km${nextRace.targetSec ? ` · target ${fmtDur(nextRace.targetSec)}` : ''}</span></div></div>` : ''}
  <div class="actions">
    <button class="btn primary" data-act="newPlan">Start session</button>
    <button class="btn" data-act="goto" data-h="#/run/new">Log run</button>
  </div>
  <section><h2>This week</h2>
    <div class="stats">
      <div><b>${wkSess.length}</b><span>sessions</span></div>
      <div><b>${wkSets}</b><span>working sets</span></div>
      <div><b>${+km.toFixed(1)}</b><span>km run</span></div>
    </div>
  </section>
  <section><h2>Recent</h2>${activityList(8)}</section>`;
};
routes[''].tab = '';

const LINES = [
  'No human is limited. — Eliud Kipchoge',
  'Consistency beats intensity.', 'Small steps, every day.', 'Show up. The rest follows.',
  'Progress, not perfection.', 'Strong body, calm mind.', 'Today counts.', 'Train smart, recover well.',
  'Every session is a deposit.', 'Slow is smooth, smooth is fast.', 'Your only competition is yesterday.',
  'Rest is part of the plan.', 'Good form first, weight second.', 'Earn the next kilo.', 'Steady miles build strong legs.',
];
function greeting() {
  const h = new Date().getHours();
  return h < 11 ? 'Good morning' : h < 15 ? 'Good afternoon' : h < 19 ? 'Good evening' : 'Good night';
}
function dailyLine() {
  const d = new Date();
  const doy = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
  if (d.getDay() === 0) return LINES[0]; // Sundays: Kipchoge
  return LINES[doy % LINES.length];
}
function momentum() {
  const from = isoDate(new Date(Date.now() - 30 * 864e5));
  const ses = doneSessions().filter(s => s.start.slice(0, 10) >= from).length;
  const runs = S.runs.filter(r => r.date.slice(0, 10) >= from);
  const km = runs.reduce((a, r) => a + (r.distKm || 0), 0);
  if (!ses && !runs.length) return 'A fresh start. Let\'s go.';
  return `Last 30 days: ${ses} sessions · ${runs.length} runs · ${+km.toFixed(1)} km`;
}
function backupDue() {
  if (!doneSessions().length && !S.runs.length) return false;
  const lb = S.meta.lastBackup;
  return !lb || daysBetween(lb.slice(0, 10), today()) >= 7;
}

function activityList(limit, filter = 'all') {
  const items = [
    ...(filter !== 'run' ? doneSessions().map(s => ({ t: 'lift', d: s.start, s })) : []),
    ...(filter !== 'lift' ? S.runs.map(r => ({ t: 'run', d: r.date, r })) : []),
  ].sort((a, b) => (a.d < b.d ? 1 : -1)).slice(0, limit);
  if (!items.length) return `<p class="muted">Nothing logged yet.</p>`;
  return `<div class="list">${items.map(i => {
    if (i.t === 'run') {
      const r = i.r;
      return `<a class="row" href="#/run/${r.id}"><div><b>${r.type === 'Race' && r.raceName ? esc(r.raceName) : `${r.type} run`}</b><span class="muted">${fmtDate(r.date)}</span></div><div class="right"><b>${r.distKm} km</b><span class="muted">${fmtPace(r.durSec, r.distKm)}</span></div></a>`;
    }
    const s = i.s;
    const names = s.entries.map(e => exById(e.exId)?.name || '?');
    return `<a class="row" href="#/session/${s.id}"><div><b>${fmtDate(s.start)}</b><span class="muted clamp">${esc(names.join(', '))}</span></div><div class="right">${locBadge(s.location)}<span class="muted">${s.entries.length} ex</span></div></a>`;
  }).join('')}</div>`;
}

// ---------- PLAN ----------
function newDraft() {
  return { location: null, sleep: null, exIds: [] };
}
const saveDraft = () => setMeta('draft', draft);

routes.plan = function plan() {
  if (!draft) draft = newDraft();
  const ctx = planCtx();
  const learned = learnFactors(S.sessions, S.exercises);
  const lastSame = draft.location ? doneSessions().filter(s => s.location === draft.location).sort((a, b) => (a.start < b.start ? 1 : -1))[0] : null;
  const list = draft.exIds.map((id, i) => {
    const ex = exById(id);
    if (!ex) return '';
    const rec = recommend(ex, { ...ctx, position: i }, { sessions: S.sessions, runs: S.runs, learned });
    const why = ui.openWhy['p' + id];
    return `<div class="card ex">
      <div class="exhead"><span class="num">${i + 1}</span><b>${esc(ex.name)}</b>
        <span class="tools"><button class="icon" data-act="mv" data-i="${i}" data-d="-1" aria-label="Move up">↑</button><button class="icon" data-act="mv" data-i="${i}" data-d="1" aria-label="Move down">↓</button><button class="icon" data-act="rmPlan" data-i="${i}" aria-label="Remove">×</button></span></div>
      ${rec.kind === 'rec' ? `<div class="target">${fmtTarget(rec, ex)}</div>
        <button class="link" data-act="why" data-k="p${id}">${why ? 'Hide' : 'Why?'}</button>
        ${why ? `<ul class="why">${rec.reasons.map(r => `<li>${esc(r)}</li>`).join('')}<li class="muted">${esc(lastText({ date: rec.base.date, location: rec.base.location, sets: rec.base.sets }, ex))}</li></ul>` : ''}`
      : `<div class="muted small">${esc(rec.kind === 'last' ? lastText(rec.last, ex) : rec.reasons[0] || 'No history yet.')}</div>`}
    </div>`;
  }).join('');
  const ready = draft.location && draft.exIds.length;
  return `
  <header class="top"><button class="back" data-act="goto" data-h="#/">‹</button><h1>Plan session</h1></header>
  <section class="card">
    <label>Location</label>${chips('location', LOCS.map(l => [l, l]), draft.location)}
    <label>Sleep last night (h)</label>${chips('sleep', SLEEP, draft.sleep)}
  </section>
  <section>
    <h2>Exercises <span class="muted small">${draft.exIds.length ? `${draft.exIds.length} planned` : ''}</span></h2>
    ${list || '<p class="muted">Add the exercises you plan to do today, in order.</p>'}
    <div class="actions">
      <button class="btn" data-act="openPicker" data-mode="plan">+ Add exercise</button>
      ${lastSame && !draft.exIds.length ? `<button class="btn ghost" data-act="copyLast" data-id="${lastSame.id}">Copy last ${draft.location} session</button>` : ''}
    </div>
  </section>
  <div class="sticky"><button class="btn primary wide" data-act="startSession" ${ready ? '' : 'disabled'}>${draft.location ? 'Start' : 'Pick a location to start'}</button></div>
  ${pickerHtml()}`;
};

function planCtx() {
  return { location: draft.location || 'Home', sleep: draft.sleep != null ? +draft.sleep : null, start: nowIso() };
}

// ---------- exercise picker (modal) ----------
function pickerHtml() {
  if (!ui.picker) return '';
  const q = (ui.picker.q || '').toLowerCase();
  const usage = {};
  doneSessions().forEach(s => s.entries.forEach(e => { usage[e.exId] = (usage[e.exId] || 0) + 1; }));
  const selected = new Set(ui.picker.mode === 'plan' ? draft.exIds : []);
  const list = S.exercises.filter(e => !e.archived && e.name.toLowerCase().includes(q));
  const byKind = k => list.filter(e => e.kind === k).sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0) || a.name.localeCompare(b.name));
  const block = (title, arr) => (arr.length ? `<h3>${title}</h3>${arr.map(e => `<button class="pick ${selected.has(e.id) ? 'on' : ''}" data-act="pick" data-id="${e.id}"><span>${esc(e.name)}</span><span class="muted small">${e.group}${usage[e.id] ? ` · ${usage[e.id]}×` : ''}</span></button>`).join('')}` : '');
  return `<div class="modal"><div class="sheet">
    <div class="sheethead"><input id="pickq" type="search" placeholder="Search exercises" value="${esc(ui.picker.q || '')}" autocomplete="off"><button class="btn small" data-act="closePicker">Done</button></div>
    <div class="sheetbody">
      ${block('Lifts', byKind('lift'))}${block('Core', byKind('core'))}${block('Mobility', byKind('mobility'))}
      ${q && !list.some(e => e.name.toLowerCase() === q) ? `<button class="btn ghost wide" data-act="createEx">+ Create "${esc(ui.picker.q)}"</button>` : ''}
    </div></div></div>`;
}

// ---------- WORKOUT (active or editing) ----------
routes.workout = function workout(id) {
  const s = S.sessions.find(x => x.id === id);
  if (!s) return `<p>Session not found.</p>`;
  const editing = s.status === 'done';
  const order = allDone(s);
  const cards = s.entries.map((e, ei) => entryCard(s, e, ei, order)).join('');
  return `
  <header class="top"><button class="back" data-act="goto" data-h="#/">‹</button><h1>${editing ? 'Edit session' : 'Session'}</h1><span class="right">${locBadge(s.location)}</span></header>
  <p class="muted small ctxline">${fmtDate(s.start)} · ${fmtTime(s.start)}${s.sleep != null ? ` · sleep ${s.sleep >= 8 ? '8+' : s.sleep <= 4 ? '≤4' : s.sleep} h` : ''}</p>
  ${cards}
  <div class="actions"><button class="btn" data-act="openPicker" data-mode="session" data-id="${s.id}">+ Add exercise</button></div>
  <div class="sticky row2">
    ${editing ? `<button class="btn primary wide" data-act="saveEdit" data-id="${s.id}">Save</button>` : `<button class="btn ghost" data-act="discard" data-id="${s.id}">Discard</button><button class="btn primary wide" data-act="finish" data-id="${s.id}">Finish</button>`}
  </div>
  ${pickerHtml()}`;
};

// All "done" timestamps of the session in order (for rest times).
function allDone(s) {
  return s.entries.flatMap(e => e.sets.map(x => x.doneAt).filter(Boolean)).sort((a, b) => a - b);
}
function restFor(doneAt, order) {
  const i = order.indexOf(doneAt);
  return i > 0 ? (doneAt - order[i - 1]) / 1000 : null;
}

function setDefaults(s, e, si) {
  // Target (or last session's matching set), overridden by whatever the previous set actually used.
  const ex = exById(e.exId);
  const t = e.target;
  const KEYS = ['w', 'r', 'rL', 'rR', 'sec', 'secL', 'secR', 'm'];
  let d = {};
  if (t && t.kind === 'rec') {
    d = { w: t.weight, r: t.reps };
    if (sides(ex)) { d.rL = t.reps; d.rR = t.reps; }
  } else if (t && t.kind === 'last' && t.last) {
    const ls = t.last.sets[Math.min(si, t.last.sets.length - 1)];
    KEYS.forEach(k => { if (ls[k] != null) d[k] = ls[k]; });
  }
  const prev = e.sets[si - 1];
  if (prev) KEYS.forEach(k => { if (prev[k] != null) d[k] = prev[k]; });
  return d;
}

function entryCard(s, e, ei, order) {
  const ex = exById(e.exId);
  if (!ex) return '';
  const t = e.target;
  const why = ui.openWhy['w' + ei];
  const head = `<div class="exhead"><span class="num">${ei + 1}</span><b>${esc(ex.name)}</b>
    <span class="tools"><button class="icon" data-act="emv" data-i="${ei}" data-d="-1" aria-label="Move up">↑</button><button class="icon" data-act="emv" data-i="${ei}" data-d="1" aria-label="Move down">↓</button><button class="icon" data-act="erm" data-i="${ei}" aria-label="Remove">×</button></span></div>`;
  const tline = t && t.kind === 'rec'
    ? `<div class="target">Target ${fmtTarget(t, ex)} <button class="link" data-act="why" data-k="w${ei}">${why ? 'Hide' : 'Why?'}</button></div>${why ? `<ul class="why">${t.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}`
    : t && t.kind === 'last' ? `<div class="muted small">${esc(lastText(t.last, ex))}</div>` : '';
  const cols = ex.format === 'hold' ? (sides(ex) ? ['R sec', 'L sec'] : ['sec'])
    : ex.format === 'dist' ? ['m']
    : [...(ex.format === 'wr' ? [unitW(ex)] : []), ...(sides(ex) ? ['R reps', 'L reps'] : ['reps'])];
  const fields = ex.format === 'hold' ? (sides(ex) ? ['secR', 'secL'] : ['sec'])
    : ex.format === 'dist' ? ['m']
    : [...(ex.format === 'wr' ? ['w'] : []), ...(sides(ex) ? ['rR', 'rL'] : ['r'])];
  const rows = e.sets.map((st, si) => {
    const d = setDefaults(s, e, si);
    const inputs = fields.map(f => `<input inputmode="decimal" data-e="${ei}" data-s="${si}" data-f="${f}" value="${st[f] ?? ''}" placeholder="${d[f] ?? ''}">`).join('');
    const rest = st.doneAt ? restFor(st.doneAt, order) : null;
    const drops = (st.drop || []).map((dp, di) => `<div class="setrow drop"><span class="sn">↳</span><input inputmode="decimal" data-e="${ei}" data-s="${si}" data-d="${di}" data-f="w" value="${dp.w ?? ''}" placeholder="kg"><input inputmode="decimal" data-e="${ei}" data-s="${si}" data-d="${di}" data-f="r" value="${dp.r ?? ''}" placeholder="reps"><button class="icon" data-act="rmDrop" data-e="${ei}" data-s="${si}" data-d="${di}">×</button></div>`).join('');
    return `<div class="setrow cols${fields.length}"><span class="sn">${si + 1}</span>${inputs}<button class="done ${st.doneAt ? 'on' : ''}" data-act="done" data-e="${ei}" data-s="${si}" aria-label="Set done">✓</button></div>
      ${drops}
      <div class="setmeta">${rest != null ? `<span class="muted small">rest ${fmtDur(rest)}</span>` : '<span></span>'}
        <span>${ex.format === 'wr' ? `<button class="link small" data-act="addDrop" data-e="${ei}" data-s="${si}">+ drop</button>` : ''}<button class="link small" data-act="rmSet" data-e="${ei}" data-s="${si}">remove</button></span></div>`;
  }).join('');
  const lastDone = [...e.sets].reverse().find(x => x.doneAt);
  const rir = isLift(ex) && lastDone ? `<div class="rir"><span class="muted small">Reps left in tank (last set)</span>${chips(`rir:${ei}`, [[0, '0'], [1, '1'], [2, '2'], [3, '3+']], lastDone.rir)}</div>` : '';
  return `<div class="card ex">${head}${tline}
    <div class="sethead cols${fields.length}"><span>#</span>${cols.map(c => `<span>${c}</span>`).join('')}<span></span></div>
    ${rows}
    <div class="actions tight"><button class="btn small" data-act="addSet" data-e="${ei}">+ Set</button></div>
    ${rir}
    <textarea data-e="${ei}" data-f="note" placeholder="Note" rows="1">${esc(e.note || '')}</textarea>
  </div>`;
}

// ---------- SESSION DETAIL ----------
routes.session = function session(id) {
  const s = S.sessions.find(x => x.id === id);
  if (!s) return `<p>Session not found.</p>`;
  const order = allDone(s);
  const dur = s.end ? (parseLocal(s.end) - parseLocal(s.start)) / 1000 : null;
  const body = s.entries.map(e => {
    const ex = exById(e.exId);
    if (!ex) return '';
    const t = e.target;
    let verdict = '';
    if (t && t.kind === 'rec' && isLift(ex)) {
      const ws = workingSets(e, ex);
      const hit = ws.filter(x => (x.w || 0) >= (t.weight || 0) && repsOf(x, ex) >= t.reps).length;
      verdict = `<div class="verdict ${hit >= t.sets ? 'good' : hit ? 'mid' : 'bad'}">Target ${fmtTarget(t, ex)} · ${hit}/${t.sets} sets hit</div>`;
    }
    return `<div class="card ex"><div class="exhead"><b>${esc(ex.name)}</b></div>${verdict}
      <ol class="sets">${e.sets.map(x => `<li>${fmtSet(x, ex)}${x.rir != null ? ` <span class="muted small">· ${x.rir === 3 ? '3+' : x.rir} left</span>` : ''}${x.rpe != null ? ` <span class="muted small">· RPE ${x.rpe}</span>` : ''}${x.doneAt && restFor(x.doneAt, order) != null ? ` <span class="muted small">· rest ${fmtDur(restFor(x.doneAt, order))}</span>` : ''}</li>`).join('')}</ol>
      ${e.note ? `<p class="note">${esc(e.note)}</p>` : ''}</div>`;
  }).join('');
  return `
  <header class="top"><button class="back" data-act="goto" data-h="#/history">‹</button><h1>${fmtDate(s.start)}</h1></header>
  <section class="card">
    <label>Location</label>${chips(`sloc:${s.id}`, LOCS.map(l => [l, l]), s.location)}
    <p class="muted small">${fmtTime(s.start)}${dur ? ` · ${fmtDur(dur)}` : ''}${s.sleep != null ? ` · sleep ${s.sleep >= 8 ? '8+' : s.sleep} h` : ''}${s.source === 'hevy' ? ' · imported from Hevy' : ''}</p>
  </section>
  ${body}
  <div class="actions"><button class="btn" data-act="goto" data-h="#/workout/${s.id}">Edit sets</button><button class="btn danger" data-act="delSession" data-id="${s.id}">Delete</button></div>`;
};

// ---------- HISTORY ----------
routes.history = function history() {
  const f = ui.histFilter;
  return `<header class="top"><h1>History</h1></header>
  ${chips('histFilter', [['all', 'All'], ['lift', 'Sessions'], ['run', 'Runs']], f)}
  ${activityList(500, f)}`;
};
routes.history.tab = 'history';

// ---------- RUN ----------
routes.run = function run(id) {
  const isNew = id === 'new';
  let r;
  if (isNew) r = ui.runDraft || (ui.runDraft = { id: uid(), date: nowIso(), type: 'Easy', distKm: null, durSec: null, avgHr: null, rpe: null, location: null, sleep: null, notes: '', raceName: '' });
  else if (ui.runEdit && ui.runEdit.id === id) r = ui.runEdit;
  else { const found = S.runs.find(x => x.id === id); r = found ? { ...found } : null; }
  if (!r) return `<p>Run not found.</p>`;
  ui.runEdit = r;
  return `
  <header class="top"><button class="back" data-act="goto" data-h="${isNew ? '#/' : '#/history'}">‹</button><h1>${isNew ? 'Log run' : 'Run'}</h1></header>
  <section class="card form">
    <label>Date & time</label><input type="datetime-local" data-run="date" value="${r.date}">
    <label>Type</label>${chips('rtype', RUN_TYPES.map(t => [t, t]), r.type)}
    ${r.type === 'Race' ? `<label>Race name</label><input data-run="raceName" value="${esc(r.raceName || '')}" placeholder="e.g. Half marathon">` : ''}
    <div class="grid2">
      <div><label>Distance (km)</label><input inputmode="decimal" data-run="distKm" value="${r.distKm ?? ''}"></div>
      <div><label>Duration (h:mm:ss)</label><input inputmode="numeric" data-run="durSec" value="${r.durSec ? fmtDur(r.durSec) : ''}" placeholder="45:00"></div>
      <div><label>Avg HR</label><input inputmode="numeric" data-run="avgHr" value="${r.avgHr ?? ''}"></div>
      <div><label>Pace</label><div class="pace" id="pace">${fmtPace(r.durSec, r.distKm)}</div></div>
    </div>
    <label>Effort (RPE 1–10)</label>${chips('rrpe', Array.from({ length: 10 }, (_, i) => [i + 1, i + 1]), r.rpe)}
    <label>Location</label>${chips('rloc', LOCS.map(l => [l, l]), r.location)}
    <label>Sleep last night (h)</label>${chips('rsleep', SLEEP, r.sleep)}
    <label>Notes</label><textarea data-run="notes" rows="2">${esc(r.notes || '')}</textarea>
  </section>
  <div class="actions">
    <button class="btn primary wide" data-act="saveRun">Save</button>
    ${isNew ? '' : `<button class="btn danger" data-act="delRun" data-id="${r.id}">Delete</button>`}
  </div>`;
};

// ---------- PROGRESS ----------
routes.progress = function progress() {
  const usage = {};
  doneSessions().forEach(s => s.entries.forEach(e => { usage[e.exId] = (usage[e.exId] || 0) + 1; }));
  const lifts = S.exercises.filter(e => e.kind !== 'mobility' && usage[e.id]).sort((a, b) => usage[b.id] - usage[a.id]);
  if (!ui.progEx || !exById(ui.progEx)) ui.progEx = lifts[0]?.id || null;
  const ex = exById(ui.progEx);
  let exBlock = '<p class="muted">Log a few sessions to see progress.</p>';
  if (ex) {
    const pts = [];
    const imb = [];
    doneSessions().forEach(s => {
      const e = s.entries.find(x => x.exId === ex.id);
      if (!e) return;
      const b = entryBest(e, ex);
      if (!b) return;
      const metric = ui.progMetric;
      const y = ex.format !== 'wr' || !b.w ? b.r : metric === 'e1rm' ? +e1rm(b.w, b.r).toFixed(1) : b.w;
      pts.push({ x: parseLocal(s.start), y, color: LOC_COLORS[s.location], label: `${fmtShort(s.start)} ${s.location}: ${b.w ? fmtKg(b.w) + ' × ' : ''}${b.r}` });
      if (sides(ex)) {
        const ws = workingSets(e, ex).filter(x => x.rL != null && x.rR != null && Math.max(x.rL, x.rR) > 0);
        if (ws.length) {
          const v = ws.reduce((a, x) => a + (x.rR - x.rL) / Math.max(x.rL, x.rR), 0) / ws.length * 100;
          imb.push({ x: parseLocal(s.start), y: +v.toFixed(1), label: `${fmtShort(s.start)}: ${v.toFixed(0)}%` });
        }
      }
    });
    pts.sort((a, b) => a.x - b.x);
    imb.sort((a, b) => a.x - b.x);
    const ys = pts.map(p => p.y);
    const first = pts[0], last = pts[pts.length - 1];
    const yl = ex.format !== 'wr' ? 'best reps' : ui.progMetric === 'e1rm' ? `est. 1RM (${unitW(ex)})` : `top set (${unitW(ex)})`;
    exBlock = `
      ${ex.format === 'wr' ? chips('progMetric', [['e1rm', 'Est. 1RM'], ['top', 'Top set weight']], ui.progMetric) : ''}
      <div class="stats"><div><b>${ys.length ? fmtKg(Math.max(...ys)) : '–'}</b><span>best</span></div><div><b>${last ? fmtKg(last.y) : '–'}</b><span>last</span></div><div><b>${first && last && first.y ? `${last.y >= first.y ? '+' : ''}${Math.round((last.y / first.y - 1) * 100)}%` : '–'}</b><span>since first</span></div></div>
      ${lineChart([{ name: ex.name, color: 'var(--muted)', points: pts }], { yLabel: yl })}
      ${legend(LOCS.map(l => [l, LOC_COLORS[l]]))}
      ${imb.length ? `<h3>Right vs left</h3><p class="muted small">Positive = right stronger. 0% = balanced.</p>${lineChart([{ name: 'imbalance', color: 'var(--accent)', points: imb }], { yLabel: '% difference' })}` : ''}`;
  }

  // Weekly working sets (lifts), last 12 weeks
  const weeks = lastWeeks(12);
  const setsPerWeek = Object.fromEntries(weeks.map(w => [w, 0]));
  const groupThisWeek = {};
  const curWk = weeks[weeks.length - 1];
  doneSessions().forEach(s => {
    const wk = weekKey(s.start);
    s.entries.forEach(e => {
      const x = exById(e.exId);
      if (!isLift(x)) return;
      const n = workingSets(e, x).length;
      if (wk in setsPerWeek) setsPerWeek[wk] += n;
      if (wk === curWk) groupThisWeek[x.group] = (groupThisWeek[x.group] || 0) + n;
    });
  });
  const kmPerWeek = Object.fromEntries(weeks.map(w => [w, 0]));
  S.runs.forEach(r => { const wk = weekKey(r.date); if (wk in kmPerWeek) kmPerWeek[wk] += r.distKm || 0; });
  const paces = S.runs.filter(r => r.distKm > 0 && r.durSec > 0 && r.type !== 'Interval').map(r => ({ x: parseLocal(r.date), y: r.durSec / r.distKm, color: r.type === 'Race' ? 'var(--off)' : r.type === 'Treadmill' ? 'var(--gym)' : 'var(--home)', label: `${fmtShort(r.date)} ${r.type} ${r.distKm} km ${fmtPace(r.durSec, r.distKm)}` }));
  const bw = [...S.bodyweight].sort((a, b) => (a.date < b.date ? -1 : 1)).map(b => ({ x: parseLocal(b.date), y: b.kg, label: `${fmtShort(b.date)}: ${b.kg} kg` }));

  return `<header class="top"><h1>Progress</h1></header>
  <section class="card">
    <label>Exercise</label>
    <select id="progEx">${lifts.map(e => `<option value="${e.id}" ${e.id === ui.progEx ? 'selected' : ''}>${esc(e.name)} (${usage[e.id]})</option>`).join('')}</select>
    ${exBlock}
  </section>
  <section class="card"><h3>Working sets per week</h3>
    ${barChart(weeks.map(w => ({ label: fmtShort(w), value: setsPerWeek[w] })))}
    <p class="muted small">This week: ${Object.entries(groupThisWeek).map(([g, n]) => `${g} ${n}`).join(' · ') || 'none yet'}</p>
  </section>
  <section class="card"><h3>Running km per week</h3>
    ${barChart(weeks.map(w => ({ label: fmtShort(w), value: +kmPerWeek[w].toFixed(1) })), { color: 'var(--home)' })}
  </section>
  <section class="card"><h3>Pace</h3>
    ${lineChart([{ name: 'pace', color: 'var(--muted)', points: paces }], { yLabel: 'min/km', yFmt: v => fmtDur(v) })}
    ${legend([['Outdoor', 'var(--home)'], ['Treadmill', 'var(--gym)'], ['Race', 'var(--off)']])}
  </section>
  <section class="card"><h3>Body weight</h3>
    ${lineChart([{ name: 'kg', color: 'var(--accent)', points: bw }], { yLabel: 'kg' })}
  </section>`;
};
routes.progress.tab = 'progress';
routes.progress.after = () => {
  const sel = document.getElementById('progEx');
  if (sel) sel.onchange = () => { ui.progEx = sel.value; rerender(); };
};

function lastWeeks(n) {
  const out = [];
  const d = parseLocal(weekKey(nowIso()));
  for (let i = n - 1; i >= 0; i--) { const x = new Date(d); x.setDate(d.getDate() - i * 7); out.push(isoDate(x)); }
  return out;
}

// ---------- MORE ----------
routes.more = function more() {
  const lb = S.meta.lastBackup;
  const counts = `${doneSessions().length} sessions · ${S.runs.length} runs · ${S.exercises.length} exercises`;
  return `<header class="top"><h1>More</h1></header>
  <section class="card">
    <h3>Backup</h3>
    <p class="muted small">${lb ? `Last backup: ${fmtDate(lb)} ${fmtTime(lb)}` : 'Never backed up.'} Your data lives only on this phone. Export regularly and keep the file somewhere safe (Google Drive, email to yourself).</p>
    <p class="muted small">${counts}</p>
    <div class="actions"><button class="btn primary" data-act="exportJson">Export backup (.json)</button><button class="btn" data-act="exportCsv">Export for Excel (.csv)</button></div>
    <div class="actions"><label class="btn ghost file">Restore backup<input type="file" accept=".json,application/json" id="restoreFile"></label></div>
  </section>
  <a class="card row" href="#/exercises"><b>Exercises</b><span class="muted">${S.exercises.filter(e => !e.archived).length} ›</span></a>
  <a class="card row" href="#/races"><b>Races</b><span class="muted">${S.races.length} ›</span></a>
  <a class="card row" href="#/body"><b>Body weight</b><span class="muted">${S.bodyweight.length} ›</span></a>
  <a class="card row" href="#/import"><b>Import from Hevy</b><span class="muted">›</span></a>
  <p class="muted small center">Lift Run Journey · offline · ${APP_VERSION}</p>`;
};
routes.more.tab = 'more';
routes.more.after = () => {
  const f = document.getElementById('restoreFile');
  if (f) f.onchange = async () => {
    const file = f.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'lift-run-journey' || !data.data) throw new Error('Not a Lift Run Journey backup.');
      if (!confirm('Replace ALL data on this phone with this backup?')) return;
      for (const s of STORES) {
        await db.clear(s);
        if (data.data[s]) await db.putMany(s, data.data[s]);
      }
      await load();
      toast('Backup restored');
      rerender();
    } catch (e) { alert('Restore failed: ' + e.message); }
  };
};

// Exercises list / edit
routes.exercises = function exercises() {
  const block = (k, title) => {
    const arr = S.exercises.filter(e => e.kind === k).sort((a, b) => a.name.localeCompare(b.name));
    return `<h2>${title}</h2><div class="list">${arr.map(e => `<a class="row" href="#/exercise/${e.id}"><div><b class="${e.archived ? 'muted' : ''}">${esc(e.name)}</b><span class="muted small">${e.group} · ${e.equipment}${e.unilateral || e.perSide ? ' · L/R' : ''}${e.load === 'total' ? ' · total 2 DB' : ''}${e.archived ? ' · hidden' : ''}</span></div><span class="muted">›</span></a>`).join('')}</div>`;
  };
  return `<header class="top"><button class="back" data-act="goto" data-h="#/more">‹</button><h1>Exercises</h1></header>
  <div class="actions"><button class="btn" data-act="newEx">+ New exercise</button></div>
  ${block('lift', 'Lifts')}${block('core', 'Core')}${block('mobility', 'Mobility')}`;
};
routes.exercises.tab = 'more';

routes.exercise = function exercise(id) {
  const e = exById(id);
  if (!e) return '<p>Not found.</p>';
  ui.exEdit = e;
  const opt = (field, list, val) => chips(`ex:${field}`, list.map(x => (Array.isArray(x) ? x : [x, x])), val);
  return `<header class="top"><button class="back" data-act="goto" data-h="#/exercises">‹</button><h1>Edit exercise</h1></header>
  <section class="card form">
    <label>Name</label><input data-exf="name" value="${esc(e.name)}">
    <label>Kind</label>${opt('kind', [['lift', 'Lift'], ['core', 'Core'], ['mobility', 'Mobility']], e.kind)}
    <label>Log as</label>${opt('format', [['wr', 'Weight + reps'], ['r', 'Reps only'], ['hold', 'Hold (sec)'], ['dist', 'Distance (m)']], e.format)}
    <label>Left / right separately</label>${opt('unilateral', [[true, 'Yes'], [false, 'No']], !!(e.unilateral || e.perSide))}
    ${e.format === 'wr' ? `
      <label>Equipment</label>${opt('equipment', ['dumbbell', 'barbell', 'machine', 'cable', 'bodyweight'], e.equipment)}
      <label>Weight entered as</label>${opt('load', [['single', 'Per dumbbell / stack'], ['total', 'Total of 2 dumbbells']], e.load)}
      <label>Weight step (kg)</label>${opt('step', [[1.5, '1.5'], [2, '2'], [2.5, '2.5'], [3, '3']], e.step)}
      ${e.load === 'total' ? `<p class="muted small">Recommendation step = ${effStep(e)} kg total (${e.step} kg per dumbbell).</p>` : ''}` : ''}
    <label>Muscle group</label>${opt('group', GROUPS, e.group)}
    ${e.kind === 'lift' ? `<div class="grid2"><div><label>Rep range min</label><input inputmode="numeric" data-exf="repMin" value="${e.repMin}"></div><div><label>Rep range max</label><input inputmode="numeric" data-exf="repMax" value="${e.repMax}"></div></div>` : ''}
    <label>Show in picker</label>${opt('archived', [[false, 'Yes'], [true, 'Hidden']], !!e.archived)}
  </section>`;
};
routes.exercise.tab = 'more';
routes.exercise.after = () => {
  document.querySelectorAll('[data-exf]').forEach(inp => {
    inp.onchange = () => {
      const e = ui.exEdit, f = inp.dataset.exf;
      if (f === 'name') {
        const v = inp.value.trim();
        if (!v) return;
        if (S.exercises.some(x => x.id !== e.id && x.name.toLowerCase() === v.toLowerCase())) { alert('That name already exists.'); inp.value = e.name; return; }
        e.name = v;
      } else e[f] = parseInt(inp.value, 10) || e[f];
      save('exercises', e);
      toast('Saved');
    };
  });
};

// Races
routes.races = function races() {
  const list = [...S.races].sort((a, b) => (a.date < b.date ? -1 : 1));
  const r = ui.raceEdit || { id: null, name: '', date: '', distKm: '', targetSec: null, resultSec: null };
  return `<header class="top"><button class="back" data-act="goto" data-h="#/more">‹</button><h1>Races</h1></header>
  <div class="list">${list.map(x => `<button class="row" data-act="editRace" data-id="${x.id}"><div><b>${esc(x.name)}</b><span class="muted small">${fmtDate(x.date)} · ${x.distKm} km</span></div><div class="right">${x.resultSec ? `<b>${fmtDur(x.resultSec)}</b><span class="muted small">result</span>` : x.targetSec ? `<span class="muted small">target ${fmtDur(x.targetSec)}</span>` : ''}</div></button>`).join('') || '<p class="muted">No races yet.</p>'}</div>
  <section class="card form"><h3>${r.id ? 'Edit race' : 'Add race'}</h3>
    <label>Name</label><input id="rcName" value="${esc(r.name)}" placeholder="e.g. 10K race">
    <div class="grid2">
      <div><label>Date</label><input id="rcDate" type="date" value="${r.date}"></div>
      <div><label>Distance (km)</label><input id="rcDist" inputmode="decimal" value="${r.distKm}"></div>
      <div><label>Target (h:mm:ss)</label><input id="rcTarget" value="${r.targetSec ? fmtDur(r.targetSec) : ''}" placeholder="optional"></div>
      <div><label>Result (h:mm:ss)</label><input id="rcResult" value="${r.resultSec ? fmtDur(r.resultSec) : ''}" placeholder="after the race"></div>
    </div>
    <div class="actions"><button class="btn primary" data-act="saveRace">Save</button>${r.id ? `<button class="btn ghost" data-act="cancelRace">Cancel</button><button class="btn danger" data-act="delRace" data-id="${r.id}">Delete</button>` : ''}</div>
  </section>`;
};
routes.races.tab = 'more';

// Body weight
routes.body = function body() {
  const list = [...S.bodyweight].sort((a, b) => (a.date < b.date ? 1 : -1));
  return `<header class="top"><button class="back" data-act="goto" data-h="#/more">‹</button><h1>Body weight</h1></header>
  <section class="card form"><div class="grid2"><div><label>Date</label><input id="bwDate" type="date" value="${today()}"></div><div><label>kg</label><input id="bwKg" inputmode="decimal" placeholder="71.5"></div></div>
  <div class="actions"><button class="btn primary" data-act="saveBw">Add</button></div></section>
  <div class="list">${list.map(b => `<div class="row"><span>${fmtDate(b.date)}</span><span><b>${b.kg} kg</b> <button class="icon" data-act="delBw" data-id="${b.id}">×</button></span></div>`).join('')}</div>`;
};
routes.body.tab = 'more';

// Hevy import
routes.import = function imp() {
  const h = ui.hevy;
  return `<header class="top"><button class="back" data-act="goto" data-h="#/more">‹</button><h1>Import from Hevy</h1></header>
  <section class="card form">
    <p class="small">In Hevy: Profile → Settings → Export &amp; Import Data → Export Workouts. Then pick the CSV file here.</p>
    <label>Offshore periods (one per line, YYYY-MM-DD to YYYY-MM-DD)</label>
    <textarea id="periods" rows="5" placeholder="2026-05-19 to 2026-06-20">${esc(S.meta.offshorePeriods || '')}</textarea>
    <p class="muted small">Sessions in these dates are tagged Offshore. Others: machine/cable exercises → Gym, the rest → Home. Treadmill rows are skipped.</p>
    <label class="btn file">Choose Hevy CSV<input type="file" accept=".csv,text/csv" id="hevyFile"></label>
  </section>
  ${h ? `<section class="card"><h3>Preview</h3>
    <div class="stats"><div><b>${h.stats.sessions}</b><span>sessions</span></div><div><b>${h.stats.sets}</b><span>sets</span></div><div><b>${h.stats.runs}</b><span>runs</span></div></div>
    <p class="small">Home ${h.stats.loc.Home} · Gym ${h.stats.loc.Gym} · Offshore ${h.stats.loc.Offshore}</p>
    <p class="small">New exercises: ${h.exercises.length} · Left/right sets from notes: ${h.stats.lr} · Treadmill rows skipped: ${h.stats.skipped}</p>
    ${h.dupes ? `<p class="small warntext">${h.dupes} sessions already imported will be skipped.</p>` : ''}
    <div class="actions"><button class="btn primary" data-act="doImport">Import</button><button class="btn ghost" data-act="cancelImport">Cancel</button></div>
  </section>` : ''}`;
};
routes.import.tab = 'more';
routes.import.after = () => {
  const f = document.getElementById('hevyFile');
  const p = document.getElementById('periods');
  if (p) p.onchange = () => setMeta('offshorePeriods', p.value);
  if (f) f.onchange = async () => {
    const file = f.files[0];
    if (!file) return;
    try {
      await setMeta('offshorePeriods', p.value);
      const res = convertHevy(await file.text(), p.value, S.exercises);
      const have = new Set(S.sessions.filter(s => s.source === 'hevy').map(s => s.start));
      const haveRuns = new Set(S.runs.filter(r => r.source === 'hevy').map(r => r.date));
      res.dupes = res.sessions.filter(s => have.has(s.start)).length;
      res.sessions = res.sessions.filter(s => !have.has(s.start));
      res.runs = res.runs.filter(r => !haveRuns.has(r.date));
      ui.hevy = res;
      rerender();
    } catch (e) { alert(e.message); }
  };
};

// ---------- actions ----------
const actions = {
  goto: el => go(el.dataset.h),
  newPlan: () => {
    const act = activeSession();
    if (act) { go(`#/workout/${act.id}`); return; }
    if (!draft) { draft = newDraft(); saveDraft(); }
    go('#/plan');
  },
  chip: el => {
    const { name, val } = el.dataset;
    const v = val === 'true' ? true : val === 'false' ? false : val;
    if (['location', 'sleep'].includes(name)) {
      draft[name] = String(draft[name]) === String(v) ? null : name === 'sleep' ? +v : v;
      saveDraft();
    } else if (name === 'histFilter') ui.histFilter = v;
    else if (name === 'progMetric') ui.progMetric = v;
    else if (name.startsWith('rir:')) {
      const s = S.sessions.find(x => x.id === current.args[0]);
      const e = s.entries[+name.split(':')[1]];
      const lastDone = [...e.sets].reverse().find(x => x.doneAt);
      if (lastDone) { lastDone.rir = lastDone.rir === +v ? undefined : +v; save('sessions', s); }
    } else if (name.startsWith('sloc:')) {
      const s = S.sessions.find(x => x.id === name.split(':')[1]);
      s.location = v; save('sessions', s); toast('Location updated');
    } else if (['rtype', 'rrpe', 'rloc', 'rsleep'].includes(name)) {
      const r = ui.runEdit;
      const key = { rtype: 'type', rrpe: 'rpe', rloc: 'location', rsleep: 'sleep' }[name];
      const nv = ['rpe', 'sleep'].includes(key) ? +v : v;
      r[key] = r[key] === nv && key !== 'type' ? null : nv;
    } else if (name.startsWith('ex:')) {
      const e = ui.exEdit, f = name.slice(3);
      if (f === 'unilateral') { e.unilateral = v; e.perSide = v && e.kind === 'mobility'; }
      else if (f === 'step') e.step = +v;
      else if (f === 'equipment') { e.equipment = v; e.step = defaultStep(v) || e.step; }
      else e[f] = v;
      save('exercises', e);
    }
    rerender();
  },
  why: el => { ui.openWhy[el.dataset.k] = !ui.openWhy[el.dataset.k]; rerender(); },
  mv: el => {
    const i = +el.dataset.i, j = i + +el.dataset.d;
    if (j < 0 || j >= draft.exIds.length) return;
    [draft.exIds[i], draft.exIds[j]] = [draft.exIds[j], draft.exIds[i]];
    saveDraft(); rerender();
  },
  rmPlan: el => { draft.exIds.splice(+el.dataset.i, 1); saveDraft(); rerender(); },
  copyLast: el => {
    const s = S.sessions.find(x => x.id === el.dataset.id);
    draft.exIds = s.entries.map(e => e.exId).filter(exById);
    saveDraft(); rerender();
  },
  openPicker: el => { ui.picker = { mode: el.dataset.mode, sid: el.dataset.id, q: '' }; rerender(); focusPicker(); },
  closePicker: () => { ui.picker = null; rerender(); },
  pick: el => {
    const id = el.dataset.id;
    if (ui.picker.mode === 'plan') {
      const i = draft.exIds.indexOf(id);
      if (i >= 0) draft.exIds.splice(i, 1); else draft.exIds.push(id);
      saveDraft();
      rerender(); focusPicker(false);
    } else {
      const s = S.sessions.find(x => x.id === ui.picker.sid);
      addEntry(s, id);
      ui.picker = null;
      save('sessions', s); rerender();
    }
  },
  createEx: () => {
    const e = classify(ui.picker.q.trim());
    save('exercises', e);
    actions.pick({ dataset: { id: e.id } });
    toast('Created. Adjust details in More → Exercises.');
  },
  startSession: () => {
    if (!draft.location || !draft.exIds.length) return;
    const s = { id: uid(), start: nowIso(), end: null, location: draft.location, sleep: draft.sleep, entries: [], status: 'active', source: 'app' };
    draft.exIds.forEach(id => addEntry(s, id));
    save('sessions', s);
    draft = null; setMeta('draft', null);
    go(`#/workout/${s.id}`);
  },
  addSet: el => withEntry(el, (s, e) => { e.sets.push({ drop: [] }); }),
  rmSet: el => withEntry(el, (s, e) => { e.sets.splice(+el.dataset.s, 1); }),
  addDrop: el => withEntry(el, (s, e) => { const st = e.sets[+el.dataset.s]; (st.drop = st.drop || []).push({ w: null, r: null }); }),
  rmDrop: el => withEntry(el, (s, e) => { e.sets[+el.dataset.s].drop.splice(+el.dataset.d, 1); }),
  done: el => withEntry(el, (s, e) => {
    const si = +el.dataset.s, st = e.sets[si];
    if (st.doneAt) { delete st.doneAt; return; }
    const d = setDefaults(s, e, si);
    for (const k of ['w', 'r', 'rL', 'rR', 'sec', 'secL', 'secR', 'm']) if (st[k] == null && d[k] != null) st[k] = d[k];
    st.doneAt = Date.now();
  }),
  emv: el => withSession(s => {
    const i = +el.dataset.i, j = i + +el.dataset.d;
    if (j < 0 || j >= s.entries.length) return;
    [s.entries[i], s.entries[j]] = [s.entries[j], s.entries[i]];
    s.entries.forEach((e, k) => { e.order = k; });
  }),
  erm: el => withSession(s => {
    const e = s.entries[+el.dataset.i];
    if (e.sets.some(x => x.doneAt) && !confirm('Remove this exercise and its sets?')) return;
    s.entries.splice(+el.dataset.i, 1);
    s.entries.forEach((x, k) => { x.order = k; });
  }),
  finish: el => {
    const s = S.sessions.find(x => x.id === el.dataset.id);
    cleanSession(s);
    if (!s.entries.length) { if (confirm('No sets logged. Discard this session?')) { remove('sessions', s.id); go('#/'); } return; }
    s.status = 'done'; s.end = nowIso();
    save('sessions', s);
    go(`#/session/${s.id}`);
    toast('Session saved');
  },
  saveEdit: el => {
    const s = S.sessions.find(x => x.id === el.dataset.id);
    cleanSession(s);
    save('sessions', s);
    go(`#/session/${s.id}`);
  },
  discard: el => { if (confirm('Discard this session? Logged sets will be lost.')) { remove('sessions', el.dataset.id); go('#/'); } },
  delSession: el => { if (confirm('Delete this session permanently?')) { remove('sessions', el.dataset.id); go('#/history'); } },
  saveRun: () => {
    const r = ui.runEdit;
    readRunInputs(r);
    if (!r.distKm || !r.durSec) { alert('Distance and duration are needed.'); return; }
    save('runs', r);
    ui.runDraft = null; ui.runEdit = null;
    toast('Run saved');
    go('#/history');
  },
  delRun: el => { if (confirm('Delete this run?')) { remove('runs', el.dataset.id); go('#/history'); } },
  exportJson: async () => {
    const data = {};
    for (const s of STORES) data[s] = s === 'meta' ? (await db.all('meta')).filter(m => m.id !== 'lastBackup') : S[s];
    const stamp = nowIso().replace(':', '');
    downloadFile(`lift-run-journey-backup-${stamp}.json`, JSON.stringify({ app: 'lift-run-journey', version: 1, exportedAt: new Date().toISOString(), data }), 'application/json');
    await setMeta('lastBackup', nowIso());
    toast('Backup exported'); rerender();
  },
  exportCsv: () => {
    const rows = [];
    for (const s of [...doneSessions()].sort((a, b) => (a.start < b.start ? -1 : 1))) {
      const order = allDone(s);
      s.entries.forEach(e => {
        const ex = exById(e.exId);
        if (!ex) return;
        e.sets.forEach((st, i) => {
          const base = { date: s.start.slice(0, 10), time: s.start.slice(11), location: s.location, sleep_h: s.sleep ?? '', work_h: s.location === 'Offshore' ? 12 : 0, exercise: ex.name, kind: ex.kind, group: ex.group, load: ex.load, order: e.order + 1, set: i + 1 };
          rows.push({ ...base, drop: 0, weight_kg: st.w ?? '', reps: st.r ?? '', reps_right: st.rR ?? '', reps_left: st.rL ?? '', sec: st.sec ?? st.secR ?? '', sec_left: st.secL ?? '', metres: st.m ?? '', reps_in_tank: st.rir ?? '', rpe: st.rpe ?? '', rest_sec: st.doneAt && restFor(st.doneAt, order) != null ? Math.round(restFor(st.doneAt, order)) : '', note: e.note || '' });
          (st.drop || []).forEach(d => rows.push({ ...base, drop: 1, weight_kg: d.w ?? '', reps: d.r ?? '', reps_right: '', reps_left: '', sec: '', sec_left: '', metres: '', reps_in_tank: '', rpe: '', rest_sec: '', note: '' }));
        });
      });
    }
    const stamp = today();
    downloadFile(`lift-run-journey-sets-${stamp}.csv`, toCSV(rows), 'text/csv');
    const runs = [...S.runs].sort((a, b) => (a.date < b.date ? -1 : 1)).map(r => ({ date: r.date.slice(0, 10), time: r.date.slice(11), type: r.type, race: r.raceName || '', distance_km: r.distKm, duration_sec: r.durSec, pace_sec_per_km: r.distKm ? Math.round(r.durSec / r.distKm) : '', avg_hr: r.avgHr ?? '', rpe: r.rpe ?? '', location: r.location ?? '', sleep_h: r.sleep ?? '', work_h: r.location === 'Offshore' ? 12 : r.location ? 0 : '', notes: r.notes || '' }));
    setTimeout(() => downloadFile(`lift-run-journey-runs-${stamp}.csv`, toCSV(runs), 'text/csv'), 600);
    toast('CSV exported (sets + runs)');
  },
  newEx: () => { const e = classify('New exercise ' + (S.exercises.length + 1)); save('exercises', e); go(`#/exercise/${e.id}`); },
  editRace: el => { ui.raceEdit = { ...S.races.find(r => r.id === el.dataset.id) }; rerender(); },
  cancelRace: () => { ui.raceEdit = null; rerender(); },
  saveRace: () => {
    const v = id => document.getElementById(id).value.trim();
    const r = { id: ui.raceEdit?.id || uid(), name: v('rcName'), date: v('rcDate'), distKm: num(v('rcDist')), targetSec: parseDur(v('rcTarget')), resultSec: parseDur(v('rcResult')) };
    if (!r.name || !r.date || !r.distKm) { alert('Name, date and distance are needed.'); return; }
    save('races', r); ui.raceEdit = null; toast('Race saved'); rerender();
  },
  delRace: el => { if (confirm('Delete this race?')) { remove('races', el.dataset.id); ui.raceEdit = null; rerender(); } },
  saveBw: () => {
    const kg = num(document.getElementById('bwKg').value), date = document.getElementById('bwDate').value;
    if (!kg || !date) return;
    save('bodyweight', { id: uid(), date, kg }); toast('Saved'); rerender();
  },
  delBw: el => { remove('bodyweight', el.dataset.id); rerender(); },
  doImport: async () => {
    const h = ui.hevy;
    await db.putMany('exercises', h.exercises); S.exercises.push(...h.exercises);
    await db.putMany('sessions', h.sessions); S.sessions.push(...h.sessions);
    await db.putMany('runs', h.runs); S.runs.push(...h.runs);
    ui.hevy = null;
    toast(`Imported ${h.sessions.length} sessions and ${h.runs.length} runs`);
    go('#/history');
  },
  cancelImport: () => { ui.hevy = null; rerender(); },
};

function addEntry(s, exId) {
  const ex = exById(exId);
  const position = s.entries.length;
  const learned = learnFactors(S.sessions, S.exercises);
  const rec = recommend(ex, { location: s.location, sleep: s.sleep, start: s.start, position }, { sessions: S.sessions, runs: S.runs, learned });
  const n = rec.kind === 'rec' ? rec.sets : rec.kind === 'last' && rec.last ? rec.last.sets.length : 2;
  s.entries.push({ exId, order: position, target: rec.kind === 'none' ? null : rec, sets: Array.from({ length: Math.max(1, n) }, () => ({ drop: [] })), note: '' });
}

// Drop empty sets (never ticked and no values) and empty exercises.
function cleanSession(s) {
  const has = st => st.doneAt || ['w', 'r', 'rL', 'rR', 'sec', 'secL', 'secR', 'm'].some(k => st[k] != null);
  s.entries.forEach(e => { e.sets = e.sets.filter(has); e.sets.forEach(st => { st.drop = (st.drop || []).filter(d => d.w != null || d.r != null); }); });
  s.entries = s.entries.filter(e => e.sets.length);
  s.entries.forEach((e, k) => { e.order = k; });
}

function withSession(fn) {
  const s = S.sessions.find(x => x.id === current.args[0]);
  if (!s) return;
  fn(s);
  save('sessions', s);
  rerender();
}
function withEntry(el, fn) { withSession(s => fn(s, s.entries[+el.dataset.e])); }

function readRunInputs(r) {
  document.querySelectorAll('[data-run]').forEach(inp => {
    const k = inp.dataset.run, v = inp.value;
    if (k === 'distKm') r.distKm = num(v);
    else if (k === 'durSec') r.durSec = parseDur(v);
    else if (k === 'avgHr') r.avgHr = num(v);
    else r[k] = v;
  });
}

function focusPicker(select = true) {
  const q = document.getElementById('pickq');
  if (q && select) q.focus();
}

// ---------- global events ----------
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (fn) { ev.preventDefault(); fn(el); }
});

document.addEventListener('input', ev => {
  const el = ev.target;
  if (el.id === 'pickq') {
    ui.picker.q = el.value;
    const pos = el.selectionStart;
    rerender();
    const q = document.getElementById('pickq');
    q.focus(); q.setSelectionRange(pos, pos);
    return;
  }
  if (el.dataset.run && current?.fn === routes.run) {
    readRunInputs(ui.runEdit);
    const p = document.getElementById('pace');
    if (p) p.textContent = fmtPace(ui.runEdit.durSec, ui.runEdit.distKm);
    return;
  }
  if (el.dataset.e != null && current?.fn === routes.workout) {
    const s = S.sessions.find(x => x.id === current.args[0]);
    const e = s.entries[+el.dataset.e];
    if (el.dataset.f === 'note') { e.note = el.value; saveSoon('sessions', s); return; }
    const st = e.sets[+el.dataset.s];
    const target = el.dataset.d != null ? st.drop[+el.dataset.d] : st;
    const v = num(el.value);
    target[el.dataset.f] = el.dataset.f === 'w' || el.dataset.f === 'm' || v == null ? v : Math.round(v);
    saveSoon('sessions', s);
  }
});

window.addEventListener('hashchange', route);

// ---------- boot ----------
(async function boot() {
  try {
    await load();
    requestPersistence();
    route();
  } catch (e) {
    $app().innerHTML = `<main><p>Could not open storage: ${esc(e.message)}</p></main>`;
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(reg => {
      // Check for a new version every time the app comes back to the foreground.
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
    // New version installed: reload, but never in the middle of logging a session.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      if (current?.fn === routes.workout || current?.fn === routes.run) toast('Update ready. It applies next time you open the app.');
      else location.reload();
    });
  }
})();
