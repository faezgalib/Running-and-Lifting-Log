// Small hand-written SVG charts (no dependencies, works offline).
import { esc } from './util.js';

export const LOC_COLORS = { Home: 'var(--home)', Gym: 'var(--gym)', Offshore: 'var(--off)' };

const W = 340, H = 180, P = { l: 34, r: 10, t: 12, b: 24 };

function scale(vals, pad = 0.08) {
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const d = (max - min) * pad;
  return [min - d, max + d];
}

function ticks(min, max, n = 4) {
  const step = (max - min) / n;
  return Array.from({ length: n + 1 }, (_, i) => min + step * i);
}

const fmtTick = v => (Math.abs(v) >= 100 ? Math.round(v) : +v.toFixed(1));

/**
 * series: [{ name, color, points: [{ x: Date|number, y, color?, label?, shape? }], dashed? }]
 * shape: 'dot' (default, filled), 'hollow' (outline only), 'ring' (larger, white outline).
 * Tapping the chart shows the label of the nearest point (phones have no hover).
 */
export function lineChart(series, { yLabel = '', xFmt = d => `${d.getDate()}/${d.getMonth() + 1}`, yFmt = fmtTick, height = H, invert = false, cornerNote = '' } = {}) {
  const pts = series.flatMap(s => s.points);
  if (pts.length < 1) return `<p class="muted small">Not enough data yet.</p>`;
  const xs = pts.map(p => +p.x), ys = pts.map(p => p.y);
  const [x0, x1] = xs.length > 1 && Math.min(...xs) !== Math.max(...xs) ? [Math.min(...xs), Math.max(...xs)] : [Math.min(...xs) - 864e5, Math.max(...xs) + 864e5];
  const [y0, y1] = scale(ys);
  const h = height;
  const X = x => P.l + ((+x - x0) / (x1 - x0)) * (W - P.l - P.r);
  // invert: smaller values plotted higher (e.g. pace, where lower = faster).
  const Y = y => invert ? P.t + ((y - y0) / (y1 - y0)) * (h - P.t - P.b) : h - P.b - ((y - y0) / (y1 - y0)) * (h - P.t - P.b);
  let g = '';
  for (const t of ticks(y0, y1)) g += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/><text x="${P.l - 4}" y="${Y(t) + 3}" class="ax" text-anchor="end">${esc(yFmt(t))}</text>`;
  const xt = [x0, (x0 + x1) / 2, x1];
  xt.forEach((t, i) => { g += `<text x="${X(t)}" y="${h - 6}" class="ax" text-anchor="${['start', 'middle', 'end'][i]}">${esc(xFmt(new Date(t)))}</text>`; });
  for (const s of series) {
    const sp = [...s.points].sort((a, b) => a.x - b.x);
    if (sp.length > 1) g += `<polyline fill="none" stroke="${s.color}" stroke-width="1.6" ${s.dashed ? 'stroke-dasharray="4 3"' : ''} stroke-opacity=".7" points="${sp.map(p => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')}"/>`;
    for (const p of sp) g += pointSvg(X(p.x), Y(p.y), p.color || s.color, p.shape, p.label);
  }
  if (yLabel) g += `<text x="${P.l}" y="9" class="ax">${esc(yLabel)}</text>`;
  if (cornerNote) g += `<text x="${W - P.r}" y="9" class="ax note" text-anchor="end">${esc(cornerNote)}</text>`;
  return `<div class="chartbox"><svg viewBox="0 0 ${W} ${h}" class="chart tappable" role="img" aria-label="${esc(yLabel)}">${g}</svg></div>`;
}

function pointSvg(x, y, color, shape, label) {
  const c = `cx="${x.toFixed(1)}" cy="${y.toFixed(1)}"`;
  const tip = `data-tip="${esc(label || '')}"`;
  const t = `<title>${esc(label || '')}</title>`;
  if (shape === 'hollow') return `<circle ${c} r="3.2" fill="var(--surface)" stroke="${color}" stroke-width="1.5" ${tip}>${t}</circle>`;
  if (shape === 'ring') return `<circle ${c} r="5" fill="${color}" stroke="var(--text)" stroke-width="1.5" ${tip}>${t}</circle>`;
  return `<circle ${c} r="3" fill="${color}" ${tip}>${t}</circle>`;
}

/** Show the label of the point nearest to a tap on a line chart. Returns true if handled. */
export function chartTap(ev) {
  const svg = ev.target.closest && ev.target.closest('svg.chart.tappable');
  document.querySelectorAll('.chartbox .tip').forEach(t => t.remove());
  document.querySelectorAll('.chartbox circle.hit').forEach(c => c.classList.remove('hit'));
  if (!svg) return false;
  const pts = [...svg.querySelectorAll('circle[data-tip]')];
  if (!pts.length) return true;
  const box = svg.getBoundingClientRect(), k = box.width / W;
  const tx = (ev.clientX - box.left) / k;
  const near = pts.reduce((a, c) => (Math.abs(+c.getAttribute('cx') - tx) < Math.abs(+a.getAttribute('cx') - tx) ? c : a));
  near.classList.add('hit');
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.textContent = near.dataset.tip;
  const wrap = svg.parentElement;
  wrap.appendChild(tip);
  // SVG elements have no offsetTop, so place the label from the boxes on screen.
  const wb = wrap.getBoundingClientRect();
  const cx = box.left - wb.left + +near.getAttribute('cx') * k, cy = box.top - wb.top + +near.getAttribute('cy') * k;
  const left = Math.min(Math.max(cx - tip.offsetWidth / 2, 0), wrap.clientWidth - tip.offsetWidth);
  const top = cy - tip.offsetHeight - 10 < 0 ? cy + 12 : cy - tip.offsetHeight - 10;
  tip.style.left = `${left}px`; tip.style.top = `${top}px`;
  return true;
}

/** bars: [{ label, value, color? }] */
export function barChart(bars, { yLabel = '', height = H, color = 'var(--accent)' } = {}) {
  if (!bars.length) return `<p class="muted small">Not enough data yet.</p>`;
  const max = Math.max(...bars.map(b => b.value), 1) * 1.1;
  const h = height;
  const bw = (W - P.l - P.r) / bars.length;
  const Y = v => h - P.b - (v / max) * (h - P.t - P.b);
  let g = '';
  for (const t of ticks(0, max)) g += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/><text x="${P.l - 4}" y="${Y(t) + 3}" class="ax" text-anchor="end">${fmtTick(t)}</text>`;
  const every = Math.ceil(bars.length / 6);
  bars.forEach((b, i) => {
    const x = P.l + i * bw + bw * 0.15;
    g += `<rect x="${x.toFixed(1)}" y="${Y(b.value).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${(h - P.b - Y(b.value)).toFixed(1)}" rx="2" fill="${b.color || color}"><title>${esc(b.label)}: ${fmtTick(b.value)}</title></rect>`;
    if (i % every === 0) g += `<text x="${(x + bw * 0.35).toFixed(1)}" y="${h - 6}" class="ax" text-anchor="middle">${esc(b.label)}</text>`;
  });
  if (yLabel) g += `<text x="${P.l}" y="9" class="ax">${esc(yLabel)}</text>`;
  return `<svg viewBox="0 0 ${W} ${h}" class="chart" role="img">${g}</svg>`;
}

export function legend(items) {
  return `<div class="legend">${items.map(([label, color]) => `<span><i style="background:${color}"></i>${esc(label)}</span>`).join('')}</div>`;
}
