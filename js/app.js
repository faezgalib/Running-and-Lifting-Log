import { db, STORES, requestPersistence } from './db.js';
import {
  uid, esc, isoDate, isoDateTime, parseLocal, fmtDate, fmtShort, fmtTime, fmtDur, parseDur, fmtPace,
  num, fmtKg, e1rm, daysBetween, downloadFile, toCSV,
} from './util.js';
import { classify, STARTER, GROUPS, defaultStep, effStep, ADDED_V24, ALIASES } from './seed.js';
import { recommend, learnFactors, repsOf, workingSets, entryBest, heaviestSet, setsLine, sessionVerdict } from './recommend.js';
import { convertHevy } from './hevy.js';
import { lineChart, barChart, legend, LOC_COLORS, chartTap } from './charts.js';
import { muscleVolume, muscleFigure, shadeLegend } from './muscles.js';

// ---------- state ----------
const S = { exercises: [], sessions: [], runs: [], races: [], bodyweight: [], meta: {} };
let draft = null;          // plan being built
let ui = { histFilter: 'all', progEx: null, progMetric: 'top', openWhy: {}, hevy: null, picker: null };
// Shown in More. Major.minor: big redesigns bump the major (v3.0), everything else the minor (v2.1, v2.2…).
const APP_VERSION = 'v2.6';
let swReg = null; // service worker registration, used by More → Check for updates
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
  await migrate();
}

// One-off data fixes, each runs once per phone.
async function migrate() {
  const done = S.meta.migrations || [];
  const run = async (id, fn) => { if (!done.includes(id)) { await fn(); done.push(id); } };
  await run('goblet-single-db', async () => {
    const g = S.exercises.find(e => e.name === 'Goblet Squat');
    if (g && g.load !== 'single') { g.load = 'single'; await db.put('exercises', g); }
  });
  await db.setMeta('migrations', done); S.meta.migrations = done;
  await upkeepExercises();
}

// Runs on every start and is safe to repeat: renames an exercise the owner typed under a known alias
// (e.g. "row cable" → "Seated Cable Row", keeping its logged sets) and adds any built-in exercise that is missing.
async function upkeepExercises() {
  const byName = name => S.exercises.find(e => e.name.trim().toLowerCase() === name.toLowerCase());
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    const typed = byName(alias);
    if (!typed) continue;
    if (byName(canonical)) continue; // the standard one already exists: leave the owner's copy alone
    const std = classify(canonical);
    Object.assign(typed, { ...std, id: typed.id, archived: !!typed.archived, repMin: typed.repMin || std.repMin, repMax: typed.repMax || std.repMax });
    await db.put('exercises', typed);
  }
  const missing = ADDED_V24.filter(n => !byName(n)).map(classify);
  if (missing.length) { S.exercises.push(...missing); await db.putMany('exercises', missing); }
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
  const per = rec.repsBySet || [];
  const side = sides(ex) ? '/side' : '';
  if (per.length > 1 && new Set(per).size > 1) return `${per.join(', ')} reps${side}${w}`;
  return `${rec.sets} × ${rec.reps}${side}${w}`;
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
  const dropReps = d => (d.rL != null || d.rR != null ? `R${d.rR ?? '–'}/L${d.rL ?? '–'}` : `${d.r ?? '–'}`);
  if (s.drop && s.drop.length) out += ` <span class="muted">→ ${s.drop.map(d => `${fmtKg(d.w)}×${dropReps(d)}`).join(' → ')}</span>`;
  return out;
}

const exName = ex => `<button class="exname" data-act="showHist" data-id="${ex.id}">${esc(ex.name)}</button>`;

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
  if (path !== 'session' || args[0] !== ui.justFinished) ui.justFinished = null; // the "You nailed it" line shows once, right after Finish
  ui.picker = null; ui.hist = null;
  render(fn, args);
  window.scrollTo(0, restoreY != null ? restoreY : 0);
  restoreY = null;
}
let restoreY = null; // set by Back so a list reopens where you left it
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
// Remember the scroll position of the page we are leaving, so Back can return to it.
const rememberY = () => { if (history.state) history.replaceState({ ...history.state, y: window.scrollY }, '', location.hash || '#/'); };
let current = null;
function render(fn = current?.fn, args = current?.args || []) {
  current = { fn, args };
  const tab = fn.tab || '';
  $app().innerHTML = `<main>${fn(...args)}</main>${nav(tab)}`;
  if (fn.after) fn.after(...args);
}
const rerender = () => { const y = window.scrollY; render(); window.scrollTo(0, y); };

// ---------- navigation (Android-style Back) ----------
// History stays shallow: Home (depth 0) → tab or page (1) → detail (2), plus one entry while a sheet is open.
// Back on Home leaves the app, Back on a tab returns Home, Back on a detail returns to its parent, Back closes sheets.
const TABS = ['#/', '#/history', '#/progress', '#/more'];
const depth = () => (history.state && history.state.d) || 0;
let pendingTab = null, ignorePop = 0, sheetOpen = false;
function go(h) {
  dropSheet();
  rememberY();
  history.pushState({ d: depth() + 1 }, '', h);
  route();
}
function goReplace(h) {
  dropSheet();
  history.replaceState({ d: depth() }, '', h);
  route();
}
function goTab(h) {
  dropSheet();
  const d = depth();
  if (h === '#/') { if (d === 0) route(); else history.go(-d); return; }
  if (d === 0) { history.pushState({ d: 1 }, '', h); route(); return; }
  pendingTab = h;
  history.go(-d);
}
function goBack(fallback = '#/') { if (depth() > 0) history.back(); else goReplace(fallback); }
function openSheet() {
  if (sheetOpen) return;
  sheetOpen = true;
  history.pushState({ d: depth() + 1, sheet: 1 }, '', location.hash || '#/');
}
function closeSheet() {
  ui.picker = null; ui.hist = null;
  if (sheetOpen) { sheetOpen = false; ignorePop++; history.back(); }
  rerender();
}
// Leaving the page while a sheet is open: forget the sheet; its history entry is replaced or skipped.
function dropSheet() { if (sheetOpen) { sheetOpen = false; ui.picker = null; ui.hist = null; } }
window.addEventListener('popstate', () => {
  if (ignorePop) { ignorePop--; return; }
  if (sheetOpen) { sheetOpen = false; ui.picker = null; ui.hist = null; rerender(); return; }
  if (pendingTab) { const h = pendingTab; pendingTab = null; history.pushState({ d: 1 }, '', h); }
  // Home always opens at the top. Pages reached by Back (e.g. the History list after a session) keep their position;
  // tabs opened from the menu are fresh entries without a saved position, so they open at the top too.
  const st = history.state || {};
  restoreY = (location.hash || '#/') === '#/' ? null : (st.y ?? null);
  route();
});

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
  // Home (design option A "Poster"): logo first, daily line second, then actions, this week and a short Recent list.
  const [quote, author] = dailyLine().split(' — ');
  return `
  <div class="home">
  <header class="hero">
    <img src="icons/icon-192.png" alt="" width="104" height="104">
    <div class="brand">LIFT RUN JOURNEY</div>
  </header>
  <section class="poster">
    <div class="rule"></div>
    <p class="q">${esc(quote)}</p>
    ${author ? `<div class="by">${esc(author.toUpperCase())}</div>` : ''}
    <div class="greet">${greeting()} · ${esc(momentum())}</div>
  </section>
  ${act ? `<a class="card resume" href="#/workout/${act.id}"><b>Session in progress</b><span>${locBadge(act.location)} started ${fmtTime(act.start)} · ${act.entries.length} exercises</span><span class="go">Resume →</span></a>` : ''}
  ${nextRace ? `<div class="card race"><div class="big">${daysBetween(today(), nextRace.date)}</div><div><b>days to ${esc(nextRace.name)}</b><span class="muted">${fmtDate(nextRace.date)} · ${nextRace.distKm} km${nextRace.targetSec ? ` · target ${fmtDur(nextRace.targetSec)}` : ''}</span></div></div>` : ''}
  <div class="cta">
    <button class="btn primary pill two" data-act="newPlan"><span class="t">Lift</span><span class="s">Start a session</span></button>
    <button class="btn pill outline two" data-act="goto" data-h="#/run/new"><span class="t">Run</span><span class="s">Log a finished run</span></button>
  </div>
  <div class="hh"><span>THIS WEEK</span></div>
  <div class="wk">
    <div><b>${wkSess.length}</b><span>sessions</span></div>
    <div><b>${wkSets}</b><span>working sets</span></div>
    <div><b>${+km.toFixed(1)}</b><span>km run</span></div>
  </div>
  <div class="hh"><span>RECENT</span><a href="#/history">See all</a></div>
  ${homeRecent(5)}
  </div>`;
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
  const parts = [ses ? `${ses} session${ses === 1 ? '' : 's'}` : '', runs.length ? `${+km.toFixed(1)} km` : ''].filter(Boolean);
  return `${parts.join(' and ')} in the last 30 days`;
}

// Home "Recent": at most 5 rows, one short summary line each (the full list lives in History).
function homeRecent(limit = 5) {
  const items = [
    ...doneSessions().map(s => ({ d: s.start, s })),
    ...S.runs.map(r => ({ d: r.date, r })),
  ].sort((a, b) => (a.d < b.d ? 1 : -1)).slice(0, limit);
  if (!items.length) return '<p class="muted small">Nothing logged yet.</p>';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const date = iso => { const d = parseLocal(iso); return `<div class="rd"><b>${d.getDate()}</b><span>${MON[d.getMonth()]}</span></div>`; };
  const place = l => (l ? `<div class="rl"><i style="background:${LOC_COLORS[l]}"></i>${l}</div>` : '<div></div>');
  return `<div class="recent-home">${items.map(i => {
    if (i.r) {
      const r = i.r;
      const title = r.type === 'Race' && r.raceName ? esc(r.raceName) : `${r.type === 'Treadmill' ? 'Treadmill' : r.type} run`;
      const sub = r.type === 'Race' ? `${r.distKm} km · ${fmtDur(r.durSec)}` : `${r.distKm} km · ${fmtPace(r.durSec, r.distKm)}`;
      return `<a class="rr" href="#/run/${r.id}">${date(r.date)}<div class="rt"><b>${title}</b><span>${sub}</span></div>${place(r.location)}</a>`;
    }
    const s = i.s;
    const sets = s.entries.reduce((a, e) => a + e.sets.length, 0);
    const n = s.entries.length;
    const onlyMob = s.entries.every(e => exById(e.exId)?.kind === 'mobility');
    return `<a class="rr" href="#/session/${s.id}">${date(s.start)}<div class="rt"><b>${onlyMob ? 'Mobility' : 'Lifting'}</b><span>${n} exercise${n === 1 ? '' : 's'} · ${sets} set${sets === 1 ? '' : 's'}</span></div>${place(s.location)}</a>`;
  }).join('')}</div>`;
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
      <div class="exhead"><span class="num">${i + 1}</span>${exName(ex)}
        <span class="tools"><button class="icon" data-act="mv" data-i="${i}" data-d="-1" aria-label="Move up">↑</button><button class="icon" data-act="mv" data-i="${i}" data-d="1" aria-label="Move down">↓</button><button class="icon" data-act="rmPlan" data-i="${i}" aria-label="Remove">×</button></span></div>
      ${rec.kind === 'rec' ? `<div class="target">${fmtTarget(rec, ex)}</div>
        <button class="link" data-act="why" data-k="p${id}">${why ? 'Hide' : 'Why?'}</button>
        ${why ? `<ul class="why">${rec.reasons.map(r => `<li>${esc(r)}</li>`).join('')}<li class="muted">${esc(lastText({ date: rec.base.date, location: rec.base.location, sets: rec.base.sets }, ex))}</li></ul>` : ''}`
      : `<div class="muted small">${esc(rec.kind === 'last' ? lastText(rec.last, ex) : rec.reasons[0] || 'No history yet.')}</div>`}
    </div>`;
  }).join('');
  const ready = draft.location && draft.exIds.length;
  return `
  <header class="top"><button class="back" data-act="back" data-h="#/">‹</button><h1>Plan session</h1></header>
  <section class="card">
    <label>Location</label>${chips('location', LOCS.map(l => [l, l]), draft.location)}
    <label>Sleep last night (h)</label>${chips('sleep', SLEEP, draft.sleep)}
    ${draft.location === 'Offshore' ? '<p class="muted small">Offshore: sleep is recorded, but targets follow your previous offshore sessions.</p>' : ''}
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
  ${pickerHtml()}${histHtml()}`;
};

function planCtx() {
  return { location: draft.location || 'Home', sleep: draft.sleep != null ? +draft.sleep : null, start: nowIso() };
}

// ---------- exercise picker (modal) ----------
function pickerHtml() {
  if (!ui.picker) return '';
  const q = (ui.picker.q || '').toLowerCase().trim();
  const lastUsed = {}, counts = {};
  doneSessions().forEach(s => s.entries.forEach(e => { counts[e.exId] = (counts[e.exId] || 0) + 1; if (!lastUsed[e.exId] || lastUsed[e.exId] < s.start) lastUsed[e.exId] = s.start; }));
  const selected = new Set(ui.picker.mode === 'plan' ? draft.exIds : []);
  const prog = ui.picker.mode === 'progress';
  const list = S.exercises.filter(e => (prog ? e.kind !== 'mobility' && lastUsed[e.id] : !e.archived) && e.name.toLowerCase().includes(q));
  // Recent: the 5 most recently used exercises (only when not searching). Everything else A–Z.
  const recent = q || prog ? [] : list.filter(e => lastUsed[e.id]).sort((a, b) => (lastUsed[a.id] < lastUsed[b.id] ? 1 : -1)).slice(0, 5);
  const recentIds = new Set(recent.map(e => e.id));
  const az = arr => [...arr].sort((a, b) => a.name.localeCompare(b.name));
  const byKind = k => az(list.filter(e => e.kind === k && !recentIds.has(e.id)));
  const item = e => `<button class="pick ${selected.has(e.id) ? 'on' : ''}" data-act="pick" data-id="${e.id}"><span>${esc(e.name)}</span><span class="muted small">${prog ? `${counts[e.id] || 0} sessions` : lastUsed[e.id] ? fmtShort(lastUsed[e.id]) : e.group}</span></button>`;
  const block = (title, arr, cls = '') => (arr.length ? `<h3 class="${cls}">${title}</h3>${arr.map(item).join('')}` : '');
  return `<div class="modal"><div class="sheet">
    <div class="sheethead"><input id="pickq" type="search" placeholder="Search exercises" value="${esc(ui.picker.q || '')}" autocomplete="off"><button class="btn small" data-act="closePicker">Done</button></div>
    <div class="sheetbody">
      ${recent.length ? `<div class="recent">${block('Recent', recent, 'recenth')}</div>` : ''}
      ${prog ? block('Exercises · A–Z', az(list)) : block(q ? 'Lifts' : 'Lifts · A–Z', byKind('lift'))}${prog ? '' : `${block('Core · A–Z', byKind('core'))}${block('Mobility · A–Z', byKind('mobility'))}`}
      ${q && !prog && !list.some(e => e.name.toLowerCase() === q) ? `<button class="btn ghost wide" data-act="createEx">+ Create "${esc(ui.picker.q)}"</button>` : ''}
    </div></div></div>`;
}

// ---------- exercise history (bottom sheet) ----------
function histHtml() {
  if (!ui.hist) return '';
  const ex = exById(ui.hist);
  if (!ex) return '';
  const rows = doneSessions()
    .map(s => ({ s, e: s.entries.find(x => x.exId === ex.id) }))
    .filter(x => x.e && x.e.sets.length)
    .sort((a, b) => (a.s.start < b.s.start ? 1 : -1))
    .slice(0, 10);
  const pts = [...rows].reverse().map(({ s, e }) => {
    const b = entryBest(e, ex);
    if (!b) return null;
    const y = ex.format === 'wr' && b.w ? +e1rm(b.w, b.r).toFixed(1) : b.r;
    return { x: parseLocal(s.start), y, color: LOC_COLORS[s.location], label: `${fmtShort(s.start)} ${s.location}` };
  }).filter(Boolean);
  const list = rows.map(({ s, e }) => {
    const b = isLift(ex) ? entryBest(e, ex) : null;
    const est = b && ex.format === 'wr' && b.w ? `<span class="muted small">est. 1RM ${fmtKg(+e1rm(b.w, b.r).toFixed(1))}</span>` : '';
    const rir = [...e.sets].reverse().find(x => x.rir != null);
    return `<div class="hrow"><div class="hhead"><b>${fmtDate(s.start)}</b>${locBadge(s.location)}</div>
      <div class="small">${e.sets.map(x => fmtSet(x, ex)).join(' · ')}</div>
      <div class="hmeta">${est}${rir ? `<span class="muted small">${rir.rir === 3 ? '3+' : rir.rir} left</span>` : ''}</div></div>`;
  }).join('');
  const tab = ui.histTab === 'history' ? 'history' : 'records';
  const seg = `<div class="seg">${[['records', 'Records'], ['history', 'History']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="histTab" data-k="${k}">${l}</button>`).join('')}</div>`;
  const head = `<div class="modal" data-act="closeHist"><div class="sheet hist" data-act="noop">
    <div class="sheethead"><b class="grow">${esc(ex.name)}</b><button class="btn small" data-act="closeHist">Close</button></div>
    <div class="sheetbody">${seg}`;
  if (tab === 'records') return `${head}${recordsHtml(ex)}</div></div></div>`;
  return `${head}
      ${pts.length > 1 ? lineChart([{ name: ex.name, color: 'var(--muted)', points: pts }], { yLabel: ex.format === 'wr' ? 'est. 1RM' : 'best reps', height: 140 }) + legend(LOCS.map(l => [l, LOC_COLORS[l]])) : ''}
      <h3>Last ${rows.length} session${rows.length === 1 ? '' : 's'}</h3>
      ${list || '<p class="muted">No history yet.</p>'}
      <button class="btn ghost wide" data-act="histToProgress" data-id="${ex.id}">Full chart in Progress</button>
    </div></div></div>`;
}

// ---------- set records ----------
// Weighted lifts: heaviest weight lifted for AT LEAST n reps (so more reps never shows a heavier weight),
// per side for left/right exercises. Reps-only: most reps in one set. Hold: longest. Distance: farthest.
// Main sets only (drop sets are not counted). Imported Hevy sessions count too.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const recDate = iso => { const d = parseLocal(iso); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; };

function computeRecords(ex, sessions) {
  const sets = [];
  for (const s of sessions) {
    if (s.status !== 'done') continue;
    const e = s.entries.find(x => x.exId === ex.id);
    if (e) for (const st of e.sets) sets.push({ ...st, date: s.start });
  }
  const two = ex.unilateral || ex.perSide;
  const sidesList = two ? [['R', 'Right'], ['L', 'Left']] : [['', '']];
  const repsFor = (st, k) => (k === 'R' ? st.rR ?? st.r : k === 'L' ? st.rL ?? st.r : st.r);
  // pick: the best value, and the earliest date it was reached
  const best = (cands, val) => cands.reduce((b, c) => (!b || val(c) > val(b) || (val(c) === val(b) && c.date < b.date) ? c : b), null);
  if (ex.format === 'wr' && sets.some(st => st.w > 0)) {
    const per = sidesList.map(([k]) => sets.filter(st => st.w > 0 && repsFor(st, k) > 0).map(st => ({ w: st.w, n: repsFor(st, k), date: st.date })));
    const maxN = Math.min(20, Math.max(0, ...per.flat().map(x => x.n)));
    const rows = [];
    for (let n = 1; n <= maxN; n++) {
      rows.push({ reps: n, cells: per.map(list => { const b = best(list.filter(x => x.n >= n), x => x.w); return b ? { value: b.w, date: b.date } : null; }) });
    }
    return { type: 'weight', sides: sidesList.map(([, l]) => l), rows };
  }
  const field = ex.format === 'hold' ? 'sec' : ex.format === 'dist' ? 'm' : 'r';
  const valFor = (st, k) => (k === 'R' ? st[field + 'R'] ?? st[field] : k === 'L' ? st[field + 'L'] ?? st[field] : st[field]);
  const cells = sidesList.map(([k]) => {
    const b = best(sets.filter(st => valFor(st, k) > 0), st => valFor(st, k));
    return b ? { value: valFor(b, k), date: b.date } : null;
  });
  return { type: field === 'sec' ? 'hold' : field === 'm' ? 'dist' : 'reps', sides: sidesList.map(([, l]) => l), cells };
}

function recordsHtml(ex) {
  const rec = computeRecords(ex, S.sessions);
  const two = rec.sides.length === 2;
  const cell = (c, unit) => (c ? `<td class="kg">${unit(c.value)}<small>${recDate(c.date)}</small></td>` : '<td class="kg">–</td>');
  if (rec.type === 'weight') {
    if (!rec.rows.length) return '<p class="muted">No sets with weight yet.</p>';
    const kg = v => `${fmtKg(v)} ${unitW(ex)}`;
    return `<p class="hint">Heaviest weight you lifted for at least this many reps${two ? ', per side' : ''}.</p>
      <table class="rec"><thead><tr><th>Reps</th>${two ? '<th>Right</th><th>Left</th>' : '<th>Best</th>'}</tr></thead>
      <tbody>${rec.rows.map(r => `<tr><td class="r">${r.reps}</td>${r.cells.map(c => cell(c, kg)).join('')}</tr>`).join('')}</tbody></table>`;
  }
  if (!rec.cells.some(Boolean)) return '<p class="muted">No sets yet.</p>';
  const label = { reps: 'Most reps in one set', hold: 'Longest hold', dist: 'Farthest' }[rec.type];
  const unit = { reps: v => `${v} reps`, hold: v => fmtDur(v), dist: v => `${v} m` }[rec.type];
  return `<p class="hint">${label}${two ? ', per side' : ''}.</p>
    <table class="rec"><thead><tr>${two ? '<th>Right</th><th>Left</th>' : '<th>Best</th>'}</tr></thead>
    <tbody><tr>${rec.cells.map(c => cell(c, unit)).join('')}</tr></tbody></table>`;
}

// ---------- WORKOUT (active or editing) ----------
routes.workout = function workout(id) {
  const s = S.sessions.find(x => x.id === id);
  if (!s) return `<p>Session not found.</p>`;
  const editing = s.status === 'done';
  const cards = s.entries.map((e, ei) => entryCard(s, e, ei)).join('');
  return `
  <header class="top"><button class="back" data-act="back" data-h="#/">‹</button><h1>${editing ? 'Edit session' : 'Session'}</h1><span class="right">${locBadge(s.location)}</span></header>
  <p class="muted small ctxline">${fmtDate(s.start)} · ${fmtTime(s.start)}${s.sleep != null ? ` · sleep ${s.sleep >= 8 ? '8+' : s.sleep <= 4 ? '≤4' : s.sleep} h` : ''}</p>
  ${cards}
  <div class="actions"><button class="btn" data-act="openPicker" data-mode="session" data-id="${s.id}">+ Add exercise</button></div>
  <div class="sticky row2">
    ${editing ? `<button class="btn primary wide" data-act="saveEdit" data-id="${s.id}">Save</button>` : `<button class="btn ghost" data-act="discard" data-id="${s.id}">Discard</button><button class="btn primary wide" data-act="finish" data-id="${s.id}">Finish</button>`}
  </div>
  ${pickerHtml()}${histHtml()}`;
};

// Rest = time since the previous finished set of the SAME exercise. Switching exercises is not rest.
function restIn(e, si) {
  const st = e.sets[si];
  if (!st || !st.doneAt) return null;
  for (let i = si - 1; i >= 0; i--) if (e.sets[i].doneAt) return st.doneAt > e.sets[i].doneAt ? (st.doneAt - e.sets[i].doneAt) / 1000 : null;
  return null;
}

function setDefaults(s, e, si) {
  // Target (or last session's matching set), overridden by whatever the previous set actually used.
  const ex = exById(e.exId);
  const t = e.target;
  const KEYS = ['w', 'r', 'rL', 'rR', 'sec', 'secL', 'secR', 'm'];
  let d = {};
  if (t && t.kind === 'rec') {
    const r = t.repsBySet ? t.repsBySet[Math.min(si, t.repsBySet.length - 1)] : t.reps;
    d = { w: t.weight, r };
    if (sides(ex)) { d.rL = r; d.rR = r; }
  } else if (t && t.kind === 'last' && t.last) {
    const ls = t.last.sets[Math.min(si, t.last.sets.length - 1)];
    KEYS.forEach(k => { if (ls[k] != null) d[k] = ls[k]; });
  }
  // Weight follows what was actually used on the previous set; reps keep the per-set target.
  const prev = e.sets[si - 1];
  if (prev) {
    const keep = t && t.kind === 'rec' ? ['w', 'sec', 'secL', 'secR', 'm'] : KEYS;
    keep.forEach(k => { if (prev[k] != null) d[k] = prev[k]; });
  }
  return d;
}

function entryCard(s, e, ei) {
  const ex = exById(e.exId);
  if (!ex) return '';
  const t = e.target;
  const why = ui.openWhy['w' + ei];
  const head = `<div class="exhead"><span class="num">${ei + 1}</span>${exName(ex)}
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
    const rest = restIn(e, si);
    const dropFields = sides(ex) ? [['w', 'kg'], ['rR', 'R reps'], ['rL', 'L reps']] : [['w', 'kg'], ['r', 'reps']];
    const drops = (st.drop || []).map((dp, di) => `<div class="setrow drop dcols${dropFields.length}"><span class="sn">↳</span>${dropFields.map(([f, ph]) => `<input inputmode="decimal" data-e="${ei}" data-s="${si}" data-d="${di}" data-f="${f}" value="${dp[f] ?? ''}" placeholder="${ph}">`).join('')}<button class="icon" data-act="rmDrop" data-e="${ei}" data-s="${si}" data-d="${di}">×</button></div>`).join('');
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
  const dur = s.end ? (parseLocal(s.end) - parseLocal(s.start)) / 1000 : null;
  const body = s.entries.map(e => {
    const ex = exById(e.exId);
    if (!ex) return '';
    const t = e.target;
    let verdict = '';
    if (t && t.kind === 'rec' && isLift(ex)) {
      const ws = workingSets(e, ex);
      const per = t.repsBySet || [];
      const hit = ws.filter((x, i) => (x.w || 0) >= (t.weight || 0) && repsOf(x, ex) >= (per[Math.min(i, per.length - 1)] ?? t.reps)).length;
      verdict = `<div class="verdict ${hit >= t.sets ? 'good' : hit ? 'mid' : 'bad'}">Target ${fmtTarget(t, ex)} · ${hit}/${t.sets} sets hit</div>`;
    }
    return `<div class="card ex"><div class="exhead">${exName(ex)}</div>${verdict}
      <ol class="sets">${e.sets.map((x, i) => `<li>${fmtSet(x, ex)}${x.rir != null ? ` <span class="muted small">· ${x.rir === 3 ? '3+' : x.rir} left</span>` : ''}${x.rpe != null ? ` <span class="muted small">· RPE ${x.rpe}</span>` : ''}${restIn(e, i) != null ? ` <span class="muted small">· rest ${fmtDur(restIn(e, i))}</span>` : ''}</li>`).join('')}</ol>
      ${e.note ? `<p class="note">${esc(e.note)}</p>` : ''}</div>`;
  }).join('');
  return `
  <header class="top"><button class="back" data-act="back" data-h="#/history">‹</button><h1>${fmtDate(s.start)}</h1></header>
  <section class="card">
    <label>Location</label>${chips(`sloc:${s.id}`, LOCS.map(l => [l, l]), s.location)}
    <p class="muted small">${fmtTime(s.start)}${dur ? ` · ${fmtDur(dur)}` : ''}${s.sleep != null ? ` · sleep ${s.sleep >= 8 ? '8+' : s.sleep} h` : ''}${s.source === 'hevy' ? ' · imported from Hevy' : ''}</p>
  </section>
  ${ui.justFinished === s.id ? ackHtml(s, dur) : ''}
  ${musclesCard([s], 'Muscles worked', [1, 2, 3], 'sets this session')}
  ${body}
  <div class="actions"><button class="btn" data-act="goto" data-h="#/workout/${s.id}">Edit sets</button><button class="btn danger" data-act="delSession" data-id="${s.id}">Delete</button></div>
  ${histHtml()}`;
};

// Positive line above the muscle map, only right after Finish.
function ackHtml(s, dur) {
  const v = sessionVerdict(s, S.sessions, exById);
  const n = s.entries.length;
  const sets = s.entries.reduce((a, e) => { const ex = exById(e.exId); return a + (ex ? workingSets(e, ex).length : 0); }, 0);
  const mins = dur >= 60 ? ` · ${Math.round(dur / 60)} min` : '';
  const pr = v.best ? `<div class="pr">New best · ${esc(v.best.name)} ${v.best.w ? `${fmtKg(v.best.w)} kg × ${v.best.r}` : `${v.best.r} reps`}</div>` : '';
  return `<div class="ack ${v.kind}"><div class="big">${v.title}</div><div class="line">${n} exercise${n === 1 ? '' : 's'} · ${sets} set${sets === 1 ? '' : 's'}${mins}</div>${pr}</div>`;
}

// ---------- muscle map card ----------
const countSets = (e, ex) => workingSets(e, ex).length;
function musclesCard(sessions, title, thresholds, unit, extra = '') {
  const vol = muscleVolume(sessions, exById, countSets);
  const total = Object.values(vol).reduce((a, b) => a + b, 0);
  const view = ui.mview || 'front';
  return `<section class="card"><h3>${title}</h3>${extra}
    ${chips('mview', [['front', 'Front'], ['back', 'Back']], view)}
    ${total ? muscleFigure(vol, view, thresholds) + shadeLegend(thresholds, unit) : '<p class="muted small">No lifting sets yet.</p>'}
  </section>`;
}

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
  <header class="top"><button class="back" data-act="back" data-h="${isNew ? '#/' : '#/history'}">‹</button><h1>${isNew ? 'Log run' : 'Run'}</h1></header>
  <section class="card form">
    <label>Date & time</label><input type="datetime-local" data-run="date" value="${r.date}">
    <label>Type</label>${chips('rtype', RUN_TYPES.map(t => [t, t]), r.type)}
    ${r.type === 'Race' ? `<label>Race name</label><input data-run="raceName" value="${esc(r.raceName || '')}" placeholder="e.g. Half marathon">` : ''}
    <div class="grid2">
      <div><label>Distance (km)</label><input inputmode="decimal" data-run="distKm" value="${r.distKm ?? ''}"></div>
      <div><label>Duration (h:mm:ss)</label><input inputmode="numeric" data-run="durSec" value="${r.durSec ? fmtDur(r.durSec) : ''}" placeholder="4530 = 45:30"></div>
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
  const lifts = S.exercises.filter(e => e.kind !== 'mobility' && usage[e.id]).sort((a, b) => a.name.localeCompare(b.name));
  if (!ui.progEx || !exById(ui.progEx)) ui.progEx = lifts[0]?.id || null;
  const ex = exById(ui.progEx);
  let exBlock = '<p class="muted">Log a few sessions to see progress.</p>';
  if (ex) {
    const pts = [];
    const imb = [];
    const recent = [];
    const weighted = ex.format === 'wr' && doneSessions().some(s => { const e = s.entries.find(x => x.exId === ex.id); return e && heaviestSet(e, ex); });
    const metric = !weighted ? 'reps' : ui.progMetric === 'e1rm' ? 'e1rm' : 'top';
    doneSessions().forEach(s => {
      const e = s.entries.find(x => x.exId === ex.id);
      if (!e) return;
      const b = entryBest(e, ex);
      if (!b) return;
      recent.push({ s, e });
      const top = heaviestSet(e, ex);
      let y, what;
      if (metric === 'top' && top) { y = top.w; what = `${fmtKg(top.w)} ${unitW(ex)} × ${top.r}`; }
      else if (metric === 'e1rm' && b.w) { y = +e1rm(b.w, b.r).toFixed(1); what = `${fmtKg(b.w)} × ${b.r} → 1RM ${fmtKg(y)}`; }
      else if (metric === 'reps') { y = b.r; what = `${b.w ? fmtKg(b.w) + ' × ' : ''}${b.r} reps`; }
      else return;
      pts.push({ x: parseLocal(s.start), y, color: LOC_COLORS[s.location], label: `${fmtShort(s.start)} · ${what}` });
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
    recent.sort((a, b) => (a.s.start < b.s.start ? 1 : -1));
    const ys = pts.map(p => p.y);
    const first = pts[0], last = pts[pts.length - 1];
    const u = metric === 'reps' ? '' : ' kg';
    const yl = metric === 'reps' ? 'best reps' : metric === 'e1rm' ? `est. 1RM (${unitW(ex)})` : `heaviest weight (${unitW(ex)})`;
    const rows = recent.slice(0, 5).map(({ s, e }) => {
      const n = workingSets(e, ex).length;
      const line = ex.format === 'wr' ? esc(setsLine(e, ex)) : e.sets.map(x => fmtSet(x, ex)).join(' · ');
      return `<a class="rs" href="#/session/${s.id}"><span class="d">${fmtShort(s.start)}</span><span class="v">${line}</span><span></span><span class="l"><i style="background:${LOC_COLORS[s.location]}"></i>${esc(s.location)} · ${n} set${n === 1 ? '' : 's'}</span></a>`;
    }).join('');
    exBlock = `
      ${weighted ? chips('progMetric', [['top', 'Weight'], ['e1rm', 'Est. 1RM']], metric).replace('class="chips"', 'class="chips center"') : ''}
      <div class="stats"><div><b>${ys.length ? fmtKg(Math.max(...ys)) + u : '–'}</b><span>${metric === 'top' ? 'heaviest' : 'best'}</span></div><div><b>${last ? fmtKg(last.y) + u : '–'}</b><span>last</span></div><div><b>${first && last && first.y ? `${last.y >= first.y ? '+' : ''}${Math.round((last.y / first.y - 1) * 100)}%` : '–'}</b><span>since first</span></div></div>
      ${lineChart([{ name: ex.name, color: 'var(--muted)', points: pts }], { yLabel: yl })}
      ${legend(LOCS.map(l => [l, LOC_COLORS[l]]))}
      ${rows ? `<div class="recent"><h3>Recent sessions</h3>${rows}<p class="muted small">Tap a row to open the full session.</p></div>` : ''}
      ${imb.length ? `<h3>Right vs left</h3><p class="muted small">Positive = right stronger. 0% = balanced.</p>${lineChart([{ name: 'imbalance', color: 'var(--accent)', points: imb }], { yLabel: '% difference' })}` : ''}`;
  }

  // Weekly working sets (lifts), last 12 weeks
  const weeks = lastWeeks(12);
  const setsPerWeek = Object.fromEntries(weeks.map(w => [w, 0]));
  doneSessions().forEach(s => {
    const wk = weekKey(s.start);
    s.entries.forEach(e => {
      const x = exById(e.exId);
      if (!isLift(x)) return;
      const n = workingSets(e, x).length;
      if (wk in setsPerWeek) setsPerWeek[wk] += n;
    });
  });
  const kmPerWeek = Object.fromEntries(weeks.map(w => [w, 0]));
  S.runs.forEach(r => { const wk = weekKey(r.date); if (wk in kmPerWeek) kmPerWeek[wk] += r.distKm || 0; });
  const paces = S.runs.filter(r => r.distKm > 0 && r.durSec > 0).map(r => ({ x: parseLocal(r.date), y: r.durSec / r.distKm, color: r.type === 'Race' ? 'var(--off)' : r.type === 'Treadmill' ? 'var(--gym)' : 'var(--home)', label: `${fmtShort(r.date)} ${r.type} ${r.distKm} km ${fmtPace(r.durSec, r.distKm)}` }));

  const wkOff = ui.mweek || 0;
  const wkStart = lastWeeks(wkOff + 1)[0];
  const wkSessions = doneSessions().filter(s => weekKey(s.start) === wkStart);
  const muscleBlock = musclesCard(wkSessions, 'Muscles', [3, 6, 9], 'sets', chips('mweek', [[0, 'This week'], [1, 'Last week']], wkOff) + `<p class="muted small">Week of ${fmtShort(wkStart)} · ${wkSessions.length} session${wkSessions.length === 1 ? '' : 's'}</p>`);
  const tab = ui.ptab === 'running' ? 'running' : 'lifts';
  let body;
  if (tab === 'lifts') body = `
  <h2 class="sect">Exercise progress</h2>
  <section class="card">
    <button class="selectbtn" data-act="openPicker" data-mode="progress"><span>${ex ? esc(ex.name) : 'Choose exercise'}</span><span class="muted small">${ex ? `${usage[ex.id]} sessions` : ''} ▾</span></button>
    ${exBlock}
  </section>
  <h2 class="sect">Weekly overview <span class="muted small">all exercises</span></h2>
  ${muscleBlock}
  <section class="card"><h3>Working sets per week</h3>
    ${barChart(weeks.map(w => ({ label: fmtShort(w), value: setsPerWeek[w] })))}
  </section>`;
  else if (tab === 'running') body = `
  <section class="card"><h3>Running km per week</h3>
    ${barChart(weeks.map(w => ({ label: fmtShort(w), value: +kmPerWeek[w].toFixed(1) })), { color: 'var(--accent)' })}
  </section>
  <section class="card"><h3>Pace</h3>
    ${lineChart([{ name: 'pace', color: 'var(--muted)', points: paces }], { yLabel: 'min/km', yFmt: v => fmtDur(v), invert: true, cornerNote: 'faster ↑' })}
    ${legend([['Outdoor', 'var(--home)'], ['Treadmill', 'var(--gym)'], ['Race', 'var(--off)']])}
  </section>`;
  return `<header class="top"><h1>Progress</h1></header>
  <div class="tabs">${[['lifts', 'Lifting'], ['running', 'Running']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="ptab" data-k="${k}">${l}</button>`).join('')}</div>
  ${body}
  ${pickerHtml()}${histHtml()}`;
};
routes.progress.tab = 'progress';

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
    <p class="muted small">${lb ? `Last backup: ${fmtDate(lb)} ${fmtTime(lb)}` : 'Never backed up.'} Your data lives only on this phone. <b>Share backup</b> sends the file off the phone (Gmail, Drive, WhatsApp).</p>
    <p class="muted small">${counts}</p>
    <div class="actions"><button class="btn primary" data-act="shareBackup">Share backup</button><button class="btn" data-act="exportJson">Save to phone</button></div>
    <div class="actions"><button class="btn" data-act="exportCsv">Export for Excel (.csv)</button></div>
    <div class="actions"><label class="btn ghost file">Restore backup<input type="file" accept=".json,.txt,application/json,text/plain" id="restoreFile"></label></div>
  </section>
  <a class="card row" href="#/exercises"><b>Exercises</b><span class="muted">${S.exercises.filter(e => !e.archived).length} ›</span></a>
  <a class="card row" href="#/races"><b>Races</b><span class="muted">${S.races.length} ›</span></a>
  <a class="card row" href="#/body"><b>Body weight</b><span class="muted">${S.bodyweight.length} ›</span></a>
  <a class="card row" href="#/import"><b>Import from Hevy</b><span class="muted">›</span></a>
  <div class="vline"><span class="muted small">Lift Run Journey · ${APP_VERSION}</span><button class="link small" data-act="checkUpdate">Check for updates</button></div>`;
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
      // Show what is in the file next to what is on the phone, so an old backup is not restored by mistake.
      const n = (arr, f = () => true) => (arr || []).filter(f).length;
      const d = data.data, when = data.exportedAt ? new Date(data.exportedAt) : null;
      const msg = `Backup${when ? ` from ${fmtDate(isoDate(when))} ${isoDateTime(when).slice(11)}` : ''}:\n`
        + `${n(d.sessions, x => x.status === 'done')} sessions · ${n(d.runs)} runs · ${n(d.bodyweight)} body weight entries\n\n`
        + `On this phone now:\n${doneSessions().length} sessions · ${S.runs.length} runs · ${S.bodyweight.length} body weight entries\n\n`
        + 'Replace ALL data on this phone with the backup?';
      if (!confirm(msg)) { f.value = ''; return; }
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
  return `<header class="top"><button class="back" data-act="back" data-h="#/more">‹</button><h1>Exercises</h1></header>
  <div class="actions"><button class="btn" data-act="newEx">+ New exercise</button></div>
  ${block('lift', 'Lifts')}${block('core', 'Core')}${block('mobility', 'Mobility')}`;
};
routes.exercises.tab = 'more';

routes.exercise = function exercise(id) {
  const e = exById(id);
  if (!e) return '<p>Not found.</p>';
  ui.exEdit = e;
  const opt = (field, list, val) => chips(`ex:${field}`, list.map(x => (Array.isArray(x) ? x : [x, x])), val);
  return `<header class="top"><button class="back" data-act="back" data-h="#/exercises">‹</button><h1>Edit exercise</h1></header>
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
  return `<header class="top"><button class="back" data-act="back" data-h="#/more">‹</button><h1>Races</h1></header>
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
  const pts = [...list].reverse().map(b => ({ x: parseLocal(b.date), y: b.kg, label: `${fmtShort(b.date)}: ${b.kg} kg` }));
  return `<header class="top"><button class="back" data-act="back" data-h="#/more">‹</button><h1>Body weight</h1></header>
  <section class="card">${lineChart([{ name: 'kg', color: 'var(--accent)', points: pts }], { yLabel: 'kg' })}</section>
  <section class="card form"><div class="grid2"><div><label>Date</label><input id="bwDate" type="date" value="${today()}"></div><div><label>kg</label><input id="bwKg" inputmode="decimal" placeholder="71.5"></div></div>
  <div class="actions"><button class="btn primary" data-act="saveBw">+ Add weight</button></div></section>
  <div class="list">${list.map(b => `<div class="row"><span>${fmtDate(b.date)}</span><span><b>${b.kg} kg</b> <button class="icon" data-act="delBw" data-id="${b.id}">×</button></span></div>`).join('')}</div>`;
};
routes.body.tab = 'more';

// Hevy import
routes.import = function imp() {
  const h = ui.hevy;
  return `<header class="top"><button class="back" data-act="back" data-h="#/more">‹</button><h1>Import from Hevy</h1></header>
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
  goto: el => (TABS.includes(el.dataset.h) ? goTab(el.dataset.h) : go(el.dataset.h)),
  back: el => goBack(el.dataset.h || '#/'),
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
    else if (name === 'mview') ui.mview = v;
    else if (name === 'mweek') ui.mweek = +v;
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
  showHist: el => { ui.hist = el.dataset.id; ui.histTab = 'records'; openSheet(); rerender(); },
  histTab: el => { ui.histTab = el.dataset.k; rerender(); },
  closeHist: () => closeSheet(),
  noop: () => {},
  ptab: el => { ui.ptab = el.dataset.k; rerender(); },
  histToProgress: el => { ui.progEx = el.dataset.id; ui.ptab = 'lifts'; goTab('#/progress'); },
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
  openPicker: el => { ui.picker = { mode: el.dataset.mode, sid: el.dataset.id, q: '' }; openSheet(); rerender(); focusPicker(); },
  closePicker: () => closeSheet(),
  pick: el => {
    const id = el.dataset.id;
    if (ui.picker.mode === 'progress') { ui.progEx = id; closeSheet(); return; }
    if (ui.picker.mode === 'plan') {
      const i = draft.exIds.indexOf(id);
      if (i >= 0) draft.exIds.splice(i, 1); else draft.exIds.push(id);
      saveDraft();
      rerender(); focusPicker(false);
    } else {
      const s = S.sessions.find(x => x.id === ui.picker.sid);
      addEntry(s, id);
      save('sessions', s); closeSheet();
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
    goReplace(`#/workout/${s.id}`);
  },
  addSet: el => withEntry(el, (s, e) => { e.sets.push({ drop: [] }); }),
  rmSet: el => withEntry(el, (s, e) => { e.sets.splice(+el.dataset.s, 1); }),
  addDrop: el => withEntry(el, (s, e) => { const st = e.sets[+el.dataset.s]; (st.drop = st.drop || []).push(sides(exById(e.exId)) ? { w: null, rR: null, rL: null } : { w: null, r: null }); }),
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
    if (!s.entries.length) { if (confirm('No sets logged. Discard this session?')) { remove('sessions', s.id); goTab('#/'); } return; }
    s.status = 'done'; s.end = nowIso();
    save('sessions', s);
    ui.justFinished = s.id;
    goReplace(`#/session/${s.id}`);
    toast('Session saved');
  },
  saveEdit: el => {
    const s = S.sessions.find(x => x.id === el.dataset.id);
    cleanSession(s);
    save('sessions', s);
    goBack(`#/session/${s.id}`);
  },
  discard: el => { if (confirm('Discard this session? Logged sets will be lost.')) { remove('sessions', el.dataset.id); goTab('#/'); } },
  delSession: el => { if (confirm('Delete this session permanently?')) { remove('sessions', el.dataset.id); goBack('#/history'); } },
  saveRun: () => {
    const r = ui.runEdit;
    readRunInputs(r);
    if (!r.distKm || !r.durSec) { alert('Distance and duration are needed.'); return; }
    const isNew = location.hash === '#/run/new';
    save('runs', r);
    ui.runDraft = null; ui.runEdit = null;
    toast('Run saved');
    if (isNew) goReplace('#/history'); else goBack('#/history');
  },
  delRun: el => { if (confirm('Delete this run?')) { remove('runs', el.dataset.id); goBack('#/history'); } },
  // Replaces pull-to-refresh: ask the browser to look for a new sw.js (~1 KB). A new version installs and the
  // existing 'controllerchange' listener reloads the app once (never while a session or run is being logged).
  checkUpdate: async () => {
    if (!navigator.onLine) { toast('No internet. Try again when you\'re online.'); return; }
    const reg = swReg || (navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null);
    if (!reg) { toast('Updates are not available here.'); return; }
    toast('Checking…');
    try { await reg.update(); } catch (e) { toast('No internet. Try again when you\'re online.'); return; }
    if (reg.installing || reg.waiting) { toast('Updating…'); return; }
    toast(`You're on the latest version (${APP_VERSION})`);
  },
  // One tap → Android share sheet (Gmail, Drive, WhatsApp…). Falls back to saving the file if sharing is not available.
  shareBackup: async () => {
    const { name, json } = backupFile();
    // Chrome on Android only shares certain file types; .json is not one of them, plain text is.
    // The content is unchanged, and Restore accepts both .txt and .json.
    const file = new File([json], name.replace(/\.json$/, '.txt'), { type: 'text/plain' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Lift Run Journey backup' });
        await setMeta('lastBackup', nowIso());
        toast('Backup shared'); rerender();
      } catch (e) {
        if (e && e.name !== 'AbortError') { downloadFile(name, json, 'application/json'); await setMeta('lastBackup', nowIso()); toast(`Sharing failed (${e.name}), saved to phone instead`); rerender(); }
      }
      return;
    }
    downloadFile(name, json, 'application/json');
    await setMeta('lastBackup', nowIso());
    toast('Saved to Downloads. Move it off the phone (email/Drive).'); rerender();
  },
  exportJson: async () => {
    const { name, json } = backupFile();
    downloadFile(name, json, 'application/json');
    await setMeta('lastBackup', nowIso());
    toast('Backup saved to Downloads'); rerender();
  },
  exportCsv: () => {
    const rows = [];
    for (const s of [...doneSessions()].sort((a, b) => (a.start < b.start ? -1 : 1))) {
      s.entries.forEach(e => {
        const ex = exById(e.exId);
        if (!ex) return;
        e.sets.forEach((st, i) => {
          const base = { date: s.start.slice(0, 10), time: s.start.slice(11), location: s.location, sleep_h: s.sleep ?? '', work_h: s.location === 'Offshore' ? 12 : 0, exercise: ex.name, kind: ex.kind, group: ex.group, load: ex.load, order: e.order + 1, set: i + 1 };
          rows.push({ ...base, drop: 0, weight_kg: st.w ?? '', reps: st.r ?? '', reps_right: st.rR ?? '', reps_left: st.rL ?? '', sec: st.sec ?? st.secR ?? '', sec_left: st.secL ?? '', metres: st.m ?? '', reps_in_tank: st.rir ?? '', rpe: st.rpe ?? '', rest_sec: restIn(e, i) != null ? Math.round(restIn(e, i)) : '', note: e.note || '' });
          (st.drop || []).forEach(d => rows.push({ ...base, drop: 1, weight_kg: d.w ?? '', reps: d.r ?? '', reps_right: d.rR ?? '', reps_left: d.rL ?? '', sec: '', sec_left: '', metres: '', reps_in_tank: '', rpe: '', rest_sec: '', note: '' }));
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
    goTab('#/history');
  },
  cancelImport: () => { ui.hevy = null; rerender(); },
};

// Full backup as JSON (built from memory so the share sheet opens straight from the tap).
function backupFile() {
  const data = {};
  for (const s of STORES) data[s] = s === 'meta' ? Object.entries(S.meta).filter(([k]) => k !== 'lastBackup').map(([id, value]) => ({ id, value })) : S[s];
  const name = `lift-run-journey-backup-${nowIso().replace(':', '')}.json`;
  return { name, json: JSON.stringify({ app: 'lift-run-journey', version: 1, appVersion: APP_VERSION, exportedAt: new Date().toISOString(), data }) };
}

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
  s.entries.forEach(e => { e.sets = e.sets.filter(has); e.sets.forEach(st => { st.drop = (st.drop || []).filter(d => ['w', 'r', 'rL', 'rR'].some(k => d[k] != null)); }); });
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
  if (chartTap(ev)) return;
  const a = ev.target.closest('a[href^="#/"]');
  if (a) {
    ev.preventDefault();
    const h = a.getAttribute('href');
    if (TABS.includes(h)) goTab(h); else go(h);
    return;
  }
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

// Show the parsed duration as h:mm:ss once the field is left, so a typo is visible right away.
document.addEventListener('focusout', ev => {
  const el = ev.target;
  if (el.dataset && el.dataset.run === 'durSec' && ui.runEdit) el.value = ui.runEdit.durSec ? fmtDur(ui.runEdit.durSec) : el.value;
});


// ---------- boot ----------
(async function boot() {
  try {
    await load();
    requestPersistence();
    // Make Home the bottom of the history stack, so Back always ends on Home and then leaves the app.
    if (!history.state || history.state.d == null) {
      const start = location.hash && location.hash !== '#' ? location.hash : '#/';
      history.replaceState({ d: 0 }, '', '#/');
      if (start !== '#/') history.pushState({ d: 1 }, '', start);
    }
    route();
  } catch (e) {
    $app().innerHTML = `<main><p>Could not open storage: ${esc(e.message)}</p></main>`;
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // The very first install (fresh phone) only takes control; every later new version reloads once.
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(r => { swReg = r; }).catch(() => {});
    // New version installed: reload, but never in the middle of logging a session.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) { hadController = true; return; }
      if (current?.fn === routes.workout || current?.fn === routes.run) toast('Update ready. It applies next time you open the app.');
      else location.reload();
    });
  }
})();
