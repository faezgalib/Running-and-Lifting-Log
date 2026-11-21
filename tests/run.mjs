// Release tests for Lift Run Journey. Run before every pull request:  node tests/run.mjs
// Needs Node 18+ and Playwright with Chromium (see tests/README.md). Uses only fake data (tests/fixtures.mjs).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sampleHevyCsv, OFFSHORE_PERIOD } from './fixtures.mjs';
import { recommend, workingSets, entryBest, heaviestSet, setsLine, sessionVerdict, pbSets } from '../js/recommend.js';
import { classify } from '../js/seed.js';
import { parseDur, fmtDur } from '../js/util.js';
import { muscleVolume } from '../js/muscles.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); } catch { /* fall back to a global install */ }
  const g = execSync('npm root -g').toString().trim();
  return require(path.join(g, 'playwright'));
}

// ---------- tiny test harness ----------
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const section = t => console.log(`\n${t}`);

// ---------- 1. logic (no browser) ----------
function unitTests() {
  section('Recommendations');
  const ex = n => classify(n);
  const sess = (e, sets, loc = 'Offshore', sleep = null) => ({ id: 's' + Math.random(), start: '2026-11-15T06:40', location: loc, sleep, status: 'done', entries: [{ exId: e.id, order: 0, sets }] });
  const ctx = (loc, sleep = null, position = 0) => ({ location: loc, sleep, start: '2026-11-18T06:40', position });
  const bench = ex('Bench Press (Dumbbell)');
  let r = recommend(bench, ctx('Offshore'), { sessions: [sess(bench, [{ w: 16, r: 12 }, { w: 16, r: 10, rir: 1 }])] });
  check('per-set targets: 12,10 RIR1 → 12,11 @16', r.weight === 16 && r.repsBySet.join() === '12,11', JSON.stringify(r.repsBySet));
  r = recommend(bench, ctx('Offshore'), { sessions: [sess(bench, [{ w: 16, r: 9 }, { w: 16, r: 8, rir: 3 }])] });
  check('RIR 3+ → +2 reps', r.repsBySet.join() === '11,10', JSON.stringify(r.repsBySet));
  r = recommend(bench, ctx('Offshore'), { sessions: [sess(bench, [{ w: 16, r: 7 }, { w: 16, r: 6, rir: 0 }])] });
  check('failure below range → drop weight', r.weight === 14.5, String(r.weight));
  const gob = ex('Goblet Squat');
  r = recommend(gob, ctx('Offshore'), { sessions: [sess(gob, [{ w: 20, r: 11 }, { w: 20, r: 11, rir: 3 }])] });
  check('goblet squat is per dumbbell, RIR 3+ near top → +1.5 kg', gob.load === 'single' && r.weight === 21.5, `${gob.load} ${r.weight}`);
  const cc = ex('Concentration Curl');
  r = recommend(cc, ctx('Offshore'), { sessions: [sess(cc, [{ w: 13.5, rR: 9, rL: 8 }, { w: 13.5, rR: 10, rL: 8, rir: 0 }])] });
  check('unilateral uses weaker side, RIR 0 → hold', r.weight === 13.5 && r.repsBySet.join() === '8,8', JSON.stringify(r.repsBySet));
  r = recommend(bench, ctx('Offshore', 4), { sessions: [sess(bench, [{ w: 16, r: 12 }, { w: 16, r: 10, rir: 1 }], 'Offshore', 7)] });
  check('offshore: sleep is ignored', r.repsBySet.join() === '12,11', JSON.stringify(r.repsBySet));
  r = recommend(bench, ctx('Home', 4), { sessions: [sess(bench, [{ w: 16, r: 12 }, { w: 16, r: 10, rir: 1 }], 'Home', 7)] });
  check('home: low sleep → −1 rep', r.repsBySet.join() === '11,10', JSON.stringify(r.repsBySet));
  r = recommend(bench, ctx('Offshore', null, 4), { sessions: [sess(bench, [{ w: 16, r: 12 }, { w: 16, r: 10, rir: 1 }])] });
  check('later in the session than usual → −1 rep', r.repsBySet.join() === '11,10', JSON.stringify(r.repsBySet));

  section('Progress: actual weight');
  const press = ex('Chest Press (Machine)');
  const mixed = { sets: [{ w: 50, r: 12 }, { w: 52.5, r: 6 }] };
  check('Weight = heaviest lifted (52.5), not the best-1RM set (50)', heaviestSet(mixed, press).w === 52.5 && entryBest(mixed, press).w === 50, JSON.stringify(heaviestSet(mixed, press)));
  check('same weight: the set with more reps counts', heaviestSet({ sets: [{ w: 40, r: 8 }, { w: 40, r: 10 }] }, press).r === 10);
  check('recent line groups by weight', setsLine({ sets: [{ w: 47.5, r: 10 }, { w: 47.5, r: 10 }, { w: 45, r: 11 }] }, press) === '47.5 kg × 10, 10 · 45 kg × 11', setsLine({ sets: [{ w: 47.5, r: 10 }, { w: 47.5, r: 10 }, { w: 45, r: 11 }] }, press));
  check('recent line shows right/left', setsLine({ sets: [{ w: 12, rR: 10, rL: 9 }, { w: 12, rR: 9, rL: 9 }] }, cc) === '12 kg × R10/L9, R9/L9', setsLine({ sets: [{ w: 12, rR: 10, rL: 9 }, { w: 12, rR: 9, rL: 9 }] }, cc));
  check('bodyweight sets: reps only, no 0 kg', heaviestSet({ sets: [{ w: 0, r: 10 }] }, press) === null && setsLine({ sets: [{ r: 10 }, { r: 8 }] }, press) === '10, 8 reps');

  section('Line after Finish');
  const exs = { [press.id]: press, [cc.id]: cc };
  const day = (id, start, sets, target) => ({ id, start, status: 'done', location: 'Gym', entries: [{ exId: press.id, sets, target }] });
  const old = day('a', '2026-11-01T07:00', [{ w: 50, r: 10 }, { w: 50, r: 9 }]);
  const tgt = { kind: 'rec', weight: 50, reps: 10, repsBySet: [10, 10], sets: 2 };
  let v = sessionVerdict(day('b', '2026-11-08T07:00', [{ w: 52.5, r: 8 }, { w: 50, r: 10 }]), [old], id => exs[id]);
  check('heavier than before → "You beat it today." with the new best', v.title === 'You beat it today.' && v.best.w === 52.5 && v.best.r === 8, JSON.stringify(v));
  v = sessionVerdict(day('b', '2026-11-08T07:00', [{ w: 50, r: 11 }, { w: 50, r: 9 }]), [old], id => exs[id]);
  check('more reps at the same top weight → beat it', v.kind === 'best' && v.best.r === 11, JSON.stringify(v));
  v = sessionVerdict(day('b', '2026-11-08T07:00', [{ w: 50, r: 10 }, { w: 50, r: 10 }], tgt), [old], id => exs[id]);
  check('all targets hit, no new best → "You nailed it."', v.title === 'You nailed it.', JSON.stringify(v));
  v = sessionVerdict(day('b', '2026-11-08T07:00', [{ w: 50, r: 8 }, { w: 50, r: 7 }], tgt), [old], id => exs[id]);
  check('targets missed → still positive "Done. Every session counts."', v.title === 'Done. Every session counts.', JSON.stringify(v));
  v = sessionVerdict(day('b', '2026-11-08T07:00', [{ w: 30, r: 10 }]), [], id => exs[id]);
  check('first time doing an exercise is not called a new best', v.kind === 'done', JSON.stringify(v));

  section('Personal bests');
  const rec = { w: 50, r: 10 };
  check('PB: heavier, or more reps at the same weight', pbSets([{ w: 50, r: 10 }, { w: 50, r: 11 }, { w: 52.5, r: 6 }], press, rec).join() === '1,2');
  check('PB: a set equal to the new best is not a second PB', pbSets([{ w: 55, r: 8 }, { w: 55, r: 8 }], press, rec).join() === '0');
  check('PB: left/right uses the weaker side', pbSets([{ w: 12, rR: 12, rL: 9 }], cc, { w: 12, r: 9 }).length === 0 && pbSets([{ w: 12, rR: 11, rL: 10 }], cc, { w: 12, r: 9 }).join() === '0');
  check('PB: no earlier record → no PB', pbSets([{ w: 80, r: 5 }], press, null).length === 0);
  v = sessionVerdict(day('b', '2026-11-08T07:00', [{ w: 52.5, r: 8 }, { w: 50, r: 10 }]), [old], id => exs[id]);
  check('PB card lists the new best and the old record', v.bests.length === 1 && v.bests[0].prev.w === 50 && v.bests[0].prev.r === 10 && v.bests[0].prev.date === '2026-11-01T07:00', JSON.stringify(v.bests.map(b => b.prev)));

  section('Duration typing');
  const cases = { '003000': '30:00', '3000': '30:00', '4530': '45:30', '13000': '1:30:00', '45': '45:00', '45:30': '45:30', '1:30:00': '1:30:00' };
  for (const [inp, want] of Object.entries(cases)) check(`"${inp}" → ${want}`, fmtDur(parseDur(inp)) === want, fmtDur(parseDur(inp)));
  check('invalid "4:75" → rejected', parseDur('4:75') === null);

  section('Muscle volume');
  const byId = { [bench.id]: bench, [cc.id]: cc };
  const vol = muscleVolume([{ entries: [{ exId: bench.id, sets: [{ w: 16, r: 10 }, { w: 16, r: 9 }] }, { exId: cc.id, sets: [{ w: 12, rR: 9, rL: 8 }] }] }], id => byId[id], (e, x) => workingSets(e, x).length);
  check('bench 2 sets → chest 2, triceps 1, front delts 1', vol.chest === 2 && vol.triceps === 1 && vol.fdelt === 1, JSON.stringify(vol));
  check('curl 1 set → biceps 1, forearms ¼', vol.biceps === 1 && vol.forearms === 0.25, JSON.stringify(vol));
}

// ---------- 2. app in a real browser ----------
function startServer() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

async function browserTests() {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const URL = `http://127.0.0.1:${srv.address().port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrj-test-'));
  const csvPath = path.join(tmp, 'hevy.csv');
  fs.writeFileSync(csvPath, sampleHevyCsv());
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const dialogs = [];
  p.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  const where = async () => { await p.waitForTimeout(250); const u = p.url(); return u.startsWith(URL) ? '#' + (u.split('#')[1] || '/') : 'LEFT APP'; };
  const back = async () => { await p.goBack().catch(() => {}); return where(); };
  const tab = name => p.click(`.tabbar a:has-text("${name}")`);

  try {
    await p.goto('about:blank');
    await p.goto(URL); await p.waitForSelector('.hero');

    section('Home');
    check('logo is the largest element at the top', await p.evaluate(() => { const i = document.querySelector('.hero img'); return i && i.getBoundingClientRect().width >= 96; }));
    check('daily line shown', (await p.locator('.poster .q').innerText()).length > 5);
    check('Home has no opening animation', await p.evaluate(() => document.getAnimations().length === 0 && !document.querySelector('.home.intro')));
    const btns = (await p.locator('.cta .btn').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
    const colors = await p.evaluate(() => { const v = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(); return { run: v('--run'), home: v('--home'), gym: v('--gym'), off: v('--off'), accent: v('--accent'), btn: getComputedStyle(document.querySelector('.cta .btn.run')).borderTopColor }; });
    check('colour rule: green lift, blue run, Home/Gym/Offshore all different from both', colors.run === '#6ea8fe' && colors.accent === '#5fd0a6' && ![colors.run, colors.accent].some(c => [colors.home, colors.gym, colors.off].includes(c)), JSON.stringify(colors));
    check('Run button is blue', colors.btn === 'rgb(110, 168, 254)', colors.btn);
    check('Home buttons: Lift / Run with descriptions', btns[0] === 'Lift Start a session' && btns[1] === 'Run Log a finished run', btns.join(' | '));

    section('Import from Hevy (fake data)');
    await tab('More'); await p.click('a[href="#/import"]');
    await p.fill('#periods', OFFSHORE_PERIOD);
    await p.setInputFiles('#hevyFile', csvPath);
    await p.waitForSelector('text=Preview');
    const prev = await p.locator('section.card').nth(1).innerText();
    check('preview shows sessions, runs and an Offshore count', /30\s*sessions/.test(prev) && /Offshore [1-9]/.test(prev) && /\d+\s*runs/.test(prev), prev.replace(/\n/g, ' '));
    check('left/right taken from "Kiri beda" notes', /Left\/right sets from notes: [1-9]/.test(prev));
    await p.click('button[data-act=doImport]');
    check('import lands on History', await where() === '#/history');

    await tab('Home');
    const recentRows = await p.locator('.recent-home .rr').count();
    check('Home Recent shows at most 5 short rows', recentRows > 0 && recentRows <= 5, String(recentRows));
    check('Recent rows are one-line summaries', /exercises? · \d+ sets?|km · /.test(await p.locator('.recent-home').innerText()));
    await p.click('.hh a:has-text("See all")');
    check('"See all" opens History', await where() === '#/history');

    section('Plan and log a session');
    await tab('Home'); await p.click('button[data-act=newPlan]');
    await p.click('button.chip:has-text("Offshore")');
    check('offshore note about sleep', await p.locator('text=sleep is recorded').count() === 1);
    await p.click('text=+ Add exercise');
    const heads = await p.locator('.sheetbody h3').allInnerTexts();
    check('picker shows Recent then A–Z', /RECENT/i.test(heads[0] || '') && heads.some(h => /A–Z/.test(h)), heads.join('|'));
    // names listed under the "Lifts · A–Z" heading only (stop at the next heading)
    const az = await p.evaluate(() => {
      const out = []; let on = false;
      for (const el of document.querySelector('.sheetbody').children) {
        if (el.tagName === 'H3') { on = /^Lifts/i.test(el.textContent); continue; }
        if (on && el.classList.contains('pick')) out.push(el.querySelector('span').textContent);
      }
      return out;
    });
    check('lifts are sorted A–Z', JSON.stringify(az) === JSON.stringify([...az].sort((a, b) => a.localeCompare(b))));
    check('Back closes the picker', await back() === '#/plan' && await p.locator('.modal').count() === 0);
    await p.click('text=+ Add exercise');
    for (const n of ['Bench Press (Dumbbell)', 'Concentration Curl']) await p.locator('.pick', { hasText: n }).first().click();
    await p.click('button[data-act=closePicker]');
    const targets = await p.locator('.target').allInnerTexts();
    check('targets shown for planned exercises', targets.length === 2 && targets.every(t => /kg/.test(t)), targets.join(' | '));
    await p.click('button:has-text("Start")');
    const bench = p.locator('.ex').nth(0), curl = p.locator('.ex').nth(1);
    await bench.locator('button.done').nth(0).click(); await p.waitForTimeout(1100);
    await bench.locator('.setrow').nth(1).locator('input').first().fill('99');
    await bench.locator('button.done').nth(1).click();
    check('PB badge on the set during the session', /heaviest ever/.test(await bench.locator('.pbnote').innerText().catch(() => '')));
    check('Personal best toast', await p.locator('.toast', { hasText: 'Personal best · 99 kg' }).count() === 1, (await p.locator('.toast').allInnerTexts()).join(' | '));
    await bench.locator('button.chip:has-text("1")').click();
    await curl.locator('button.done').nth(0).click();
    await curl.locator('button[data-act=addDrop]').first().click();
    const dropInputs = curl.locator('.setrow.drop input');
    check('drop set on a unilateral exercise has kg, R and L', await dropInputs.count() === 3);
    await dropInputs.nth(0).fill('8'); await dropInputs.nth(1).fill('6'); await dropInputs.nth(2).fill('5');
    const rests = await p.locator('.setmeta .muted').allInnerTexts();
    check('rest only between sets of the same exercise', rests.length === 1, rests.join(','));
    check('Back from a session goes Home with a Resume card', await back() === '#/' && await p.locator('.card.resume').count() === 1);
    await p.click('.card.resume'); await p.click('button:has-text("Finish")');
    await p.waitForSelector('.musclemap');
    check('summary shows the muscle map without numbers', !/\bsets?\b/.test(await p.locator('.musclemap').textContent()));
    const ackText = await p.locator('.ack .big').innerText().catch(() => '');
    check('positive line after Finish', ['You beat it today.', 'You nailed it.', 'Done. Every session counts.'].includes(ackText), ackText);
    check('Personal best card after Finish', /Bench Press[\s\S]*99 kg[\s\S]*was /.test(await p.locator('.pbcard').innerText().catch(() => '')));
    check('line sits above the muscle map', await p.evaluate(() => { const a = document.querySelector('.ack'), m = document.querySelector('.musclemap'); return !!a && !!m && (a.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING) > 0; }));
    check('summary keeps the drop set (R/L)', (await p.locator('main').innerText()).includes('8×R6/L5'));
    check('Back after Finish goes Home (not to the finished session)', await back() === '#/');

    section('Exercise history and Progress');
    await tab('History'); await p.locator('.list a.row[href^="#/session"]').first().click();
    check('old session from History has no "after Finish" line', await p.locator('.ack').count() === 0);
    await p.locator('.exname', { hasText: 'Bench Press' }).first().click();
    check('exercise panel opens on Records', (await p.locator('.seg button.on').innerText()) === 'Records' && await p.locator('table.rec').count() === 1);
    const benchHead = await p.locator('table.rec th').allInnerTexts();
    check('two-handed lift: one Best column', benchHead.map(t => t.toUpperCase()).join('|') === 'REPS|BEST', benchHead.join('|'));
    const readCol = async (i) => (await p.locator(`table.rec tbody tr td:nth-child(${i + 2})`).allInnerTexts()).map(t => parseFloat(t));
    const benchBest = await readCol(0);
    check('records never get heavier as reps go up', benchBest.length > 0 && benchBest.every((v, i) => i === 0 || v <= benchBest[i - 1]), benchBest.join(','));
    await p.click('.seg button:has-text("History")');
    check('History tab keeps the sessions with location', await p.locator('.hrow .badge').count() > 0);
    check('Back closes the panel', (await back()).startsWith('#/session') && await p.locator('.modal').count() === 0);
    await p.locator('.exname', { hasText: 'Concentration Curl' }).first().click();
    const ccHead = (await p.locator('table.rec th').allInnerTexts()).map(t => t.toUpperCase());
    check('left/right exercise: Right and Left columns', ccHead.join('|') === 'REPS|RIGHT|LEFT', ccHead.join('|'));
    const right = await readCol(0), left = await readCol(1);
    check('each side never gets heavier as reps go up', [right, left].every(c => c.every((v, i) => i === 0 || v <= c[i - 1])));
    check('every row has a value for both sides', right.length > 0 && right.length === left.length && !right.concat(left).some(Number.isNaN), `${right} / ${left}`);
    await back();
    await tab('Home'); await p.click('button[data-act=newPlan]');
    await p.click('text=+ Add exercise'); await p.fill('#pickq', 'crunch');
    await p.locator('.pick', { hasText: /^Crunch/ }).first().click();
    await p.click('button[data-act=closePicker]');
    await p.locator('.exname', { hasText: 'Crunch' }).first().click();
    check('reps-only exercise shows its most reps', /Most reps in one set/.test(await p.locator('.sheetbody').innerText()) && /\d+ reps/.test(await p.locator('table.rec').innerText()));
    await back(); await back();
    await tab('Progress');
    check('Progress tabs are Lifting | Running', (await p.locator('.tabs button').allInnerTexts()).join('|') === 'Lifting|Running');
    check('Exercise progress comes before Weekly overview', /Exercise progress[\s\S]*Weekly overview/i.test((await p.locator('h2.sect').allInnerTexts()).join(' ')));
    await p.click('.selectbtn'); await p.fill('#pickq', 'goblet');
    const found = await p.locator('.pick span:first-child').allInnerTexts();
    check('exercise search filters the A–Z list', found.length === 1 && found[0] === 'Goblet Squat', found.join(','));
    await p.locator('.pick').first().click();
    check('chosen exercise shown', (await p.locator('.selectbtn').innerText()).includes('Goblet Squat'));
    check('Progress opens on Weight, then Est. 1RM', (await p.locator('.chips.center .chip').allInnerTexts()).join('|') === 'Weight|Est. 1RM' && (await p.locator('.chips.center .chip.on').innerText()) === 'Weight');
    check('best box says "heaviest" in kg', /heaviest/.test(await p.locator('.stats').innerText()) && /kg/.test(await p.locator('.stats div').first().innerText()));
    const progRows = await p.locator(".recent a.rs").allInnerTexts();
    check('Recent sessions: up to 5 rows with weight × reps', progRows.length > 0 && progRows.length <= 5 && progRows.every(t => /kg × \d/.test(t)), progRows[0]);
    const chartBox = await p.locator('.chartbox svg.chart').first().boundingBox();
    await p.mouse.click(chartBox.x + chartBox.width - 12, chartBox.y + chartBox.height / 2);
    check('tapping the chart shows the actual weight', /kg × \d/.test(await p.locator('.chartbox .tip').innerText().catch(() => '')));
    await p.click('h2.sect');
    check('tapping elsewhere hides it', await p.locator('.chartbox .tip').count() === 0);
    await p.click('.chip:has-text("Est. 1RM")');
    check('Est. 1RM still available', /est\. 1RM/.test(await p.locator('svg.chart').first().innerHTML()) && /best/.test(await p.locator('.stats').innerText()));
    await p.click('.chip:has-text("Weight")');
    await p.click('.tabs button:has-text("Running")');
    check('pace chart marked "faster ↑"', await p.locator('text=faster ↑').count() === 1);
    const runFills = await p.locator('section.card:has(h3:text("Running km per week")) rect').evaluateAll(rs => [...new Set(rs.map(r => r.getAttribute('fill')))]);
    check('km per week bars are running blue', runFills.join() === 'var(--run)', runFills.join());
    check('Running tab label is blue', await p.evaluate(() => getComputedStyle(document.querySelector('.tabs button.on')).color) === 'rgb(110, 168, 254)');
    check('pace filter: Outdoor | Treadmill | All, Outdoor first', (await p.locator('.chips.center .chip').allInnerTexts()).join('|') === 'Outdoor|Treadmill|All' && (await p.locator('.chips.center .chip.on').innerText()) === 'Outdoor');
    const paceFills = await p.locator('section.card:has(h3:text("Pace")) circle').evaluateAll(cs => [...new Set(cs.map(c => c.getAttribute('fill') === 'var(--surface)' ? c.getAttribute('stroke') : c.getAttribute('fill')))]);
    check('pace points are running blue (no location colours)', paceFills.join() === 'var(--run)', paceFills.join());
    const outdoorCount = await p.locator('section.card:has(h3:text("Pace")) circle').count();
    await p.click('.chip[data-name=paceView][data-val=all]');
    check('All shows every run', await p.locator('section.card:has(h3:text("Pace")) circle').count() >= outdoorCount && outdoorCount > 0);
    await p.click('.chip[data-name=paceView][data-val=outdoor]');
    const pts = await p.locator('section.card:has(h3:text("Pace")) circle').evaluateAll(cs => cs.map(c => ({ y: +c.getAttribute('cy'), t: c.textContent })));
    const pace = t => { const m = /(\d+):(\d+)\/km/.exec(t); return m ? +m[1] * 60 + +m[2] : 0; };
    const fastest = [...pts].sort((a, b) => pace(a.t) - pace(b.t))[0], highest = [...pts].sort((a, b) => a.y - b.y)[0];
    check('fastest run is plotted highest', fastest && highest && fastest.t === highest.t, `${fastest?.t} vs ${highest?.t}`);

    section('New exercises');
    await tab('Home'); await p.click('button[data-act=newPlan]');
    await p.click('text=+ Add exercise'); await p.fill('#pickq', 'seated cable');
    check('Seated Cable Row is in the list', (await p.locator('.pick span:first-child').allInnerTexts()).includes('Seated Cable Row'));
    await p.fill('#pickq', 'chin up');
    check('Chin Up is in the list', (await p.locator('.pick span:first-child').allInnerTexts()).includes('Chin Up'));
    await back(); await back();
    // A phone that had the owner's own "row cable" before this version: it becomes Seated Cable Row, sets kept.
    await p.evaluate(() => new Promise((res, rej) => {
      const r = indexedDB.open('lift-run-journey');
      r.onsuccess = () => {
        const db = r.result, t = db.transaction(['exercises', 'sessions'], 'readwrite');
        const ex = t.objectStore('exercises');
        ex.getAll().onsuccess = ev => {
          const std = ev.target.result.find(e => e.name === 'Seated Cable Row');
          if (std) ex.delete(std.id);
          ex.put({ id: 'own-row', name: 'row cable', kind: 'lift', format: 'wr', equipment: 'dumbbell', step: 1.5, load: 'single', unilateral: false, perSide: false, group: 'back', repMin: 8, repMax: 12, archived: false });
          t.objectStore('sessions').put({ id: 'own-row-s', start: '2026-11-20T06:30', end: '2026-11-20T07:10', location: 'Offshore', sleep: null, status: 'done', source: 'app', entries: [{ exId: 'own-row', order: 0, sets: [{ w: 30, r: 10 }, { w: 30, r: 9 }] }] });
        };
        t.oncomplete = res; t.onerror = rej;
      };
    }));
    await p.reload(); await p.waitForSelector('.hero');
    const lib = await p.evaluate(() => new Promise(res => { const r = indexedDB.open('lift-run-journey'); r.onsuccess = () => { r.result.transaction('exercises').objectStore('exercises').getAll().onsuccess = ev => res(ev.target.result); }; }));
    const rows = lib.filter(e => /row cable|seated cable row/i.test(e.name));
    check('"row cable" becomes Seated Cable Row (one exercise, cable, 2.5 kg steps)', rows.length === 1 && rows[0].id === 'own-row' && rows[0].name === 'Seated Cable Row' && rows[0].equipment === 'cable' && rows[0].step === 2.5, JSON.stringify(rows.map(e => [e.id, e.name, e.equipment, e.step])));
    await tab('History'); await p.locator('.list a.row[href="#/session/own-row-s"]').click();
    await p.click('button.chip:has-text("Back")');
    check('its logged sets now count as lats in the muscle map', /Lats/.test(await p.locator('.musclemap').textContent()) && await p.evaluate(() => [...document.querySelectorAll('.musclemap path')].some(x => !['#262b33', '#1c2027'].includes(x.getAttribute('fill')))));
    await back();

    section('Run, body weight, navigation');
    await tab('Home'); await p.click('button[data-h="#/run/new"]');
    await p.fill('[data-run=distKm]', '4'); await p.fill('[data-run=durSec]', '3000');
    check('"3000" on the number pad → pace 7:30/km', (await p.locator('#pace').innerText()) === '7:30/km');
    check('Log a run uses running blue', await p.evaluate(() => getComputedStyle(document.querySelector('button[data-act=saveRun]')).backgroundColor) === 'rgb(110, 168, 254)');
    await p.click('button:has-text("Save")');
    check('saved run → History, Back → Home', await where() === '#/history' && await back() === '#/');
    await tab('More'); await p.click('a[href="#/body"]');
    await p.fill('#bwKg', '72'); await p.click('button:has-text("+ Add weight")'); await p.waitForTimeout(200);
    check('body weight page has a chart and the entry', await p.locator('.chart').count() === 1 && (await p.locator('main').innerText()).includes('72 kg'));
    check('Back: Body weight → More → Home', await back() === '#/more' && await back() === '#/');
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(100);
    await tab('Progress'); await tab('Home');
    check('Home opens at the top after switching tabs', await p.evaluate(() => window.scrollY) === 0);
    await tab('History');
    const row = p.locator('.list a.row[href^="#/session"]').nth(8);
    await row.scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, 200)); await p.waitForTimeout(100);
    const y0 = await p.evaluate(() => window.scrollY);
    await row.click({ force: true }); await back(); await p.waitForTimeout(150);
    check('Back to History keeps the scroll position', Math.abs(await p.evaluate(() => window.scrollY) - y0) < 5, `${y0} vs ${await p.evaluate(() => window.scrollY)}`);
    await tab('Home');
    check('Back on Home leaves the app', await back() === 'LEFT APP');
    await p.goForward(); await p.waitForSelector('.hero');

    section('Backup and restore');
    await tab('More');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('button[data-act=shareBackup]')]);
    const backupPath = path.join(tmp, 'backup.json'); await dl.saveAs(backupPath);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    await p.waitForTimeout(400);
    check('Share backup (no share sheet in tests) saves a full backup', backup.app === 'lift-run-journey' && backup.data.sessions.length > 0);
    check('last backup date recorded (no reminder dot)', await p.locator('.tabbar .dot').count() === 0);
    const p2 = await ctx.newPage();
    const dialogs2 = []; p2.on('dialog', d => { dialogs2.push(d.message()); d.accept(); });
    await p2.goto(URL + '#/more'); await p2.waitForSelector('#restoreFile');
    await p2.setInputFiles('#restoreFile', backupPath); await p2.waitForTimeout(1200);
    check('restore shows what is in the file before replacing', /Backup from[\s\S]*sessions[\s\S]*On this phone now/.test(dialogs2[0] || ''), (dialogs2[0] || '').replace(/\n/g, ' '));
    // The share sheet sends the backup as .txt (Android allows plain text); Restore must accept it.
    const txtPath = path.join(tmp, 'backup.txt'); fs.copyFileSync(backupPath, txtPath);
    dialogs2.length = 0;
    await p2.setInputFiles('#restoreFile', txtPath); await p2.waitForTimeout(1200);
    check('restore accepts the shared .txt backup', /Backup from/.test(dialogs2[0] || '') && (await p2.locator('.toast').allInnerTexts()).some(x => /restored/i.test(x)));
    check('share uses a plain-text file (allowed by Android)', /name\.replace\(\/\\\.json\$\/, '\.txt'\)/.test(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8')) && /type: 'text\/plain'/.test(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8')));
    await p2.close();

    section('Offline and version');
    await p.goto(URL); await p.waitForTimeout(1500);
    await ctx.setOffline(true);
    await p.reload(); await p.waitForSelector('.hero', { timeout: 5000 }).catch(() => {});
    check('app opens offline', await p.locator('.hero').count() === 1);
    await ctx.setOffline(false);
    await tab('More');
    const ver = ((await p.locator('main').innerText()).match(/v\d+\.\d+/) || [''])[0];
    const swv = /VERSION = 'lrj-([\d.]+)'/.exec(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'))?.[1];
    check(`version shown (${ver}) matches sw.js (${swv})`, ver === `v${swv}`);

    section('Updates without pull-to-refresh');
    check('pull-to-refresh is disabled', await p.evaluate(() => getComputedStyle(document.body).overscrollBehaviorY) === 'contain');
    await p.click('button[data-act=checkUpdate]');
    await p.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /latest version|Updating/.test(t.textContent)), null, { timeout: 8000 }).catch(() => {});
    const toasts = await p.locator('.toast').allInnerTexts();
    check('More → Check for updates reports the latest version', toasts.some(t => t.includes(`You're on the latest version (${ver})`)), toasts.join(' | '));
    await ctx.setOffline(true);
    await p.click('button[data-act=checkUpdate]'); await p.waitForTimeout(300);
    check('Check for updates while offline says "No internet"', (await p.locator('.toast').allInnerTexts()).some(t => /No internet/.test(t)));
    await ctx.setOffline(false);
    check('no console errors', errors.length === 0, errors.join(' | '));
  } finally {
    await browser.close();
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

unitTests();
await browserTests();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
