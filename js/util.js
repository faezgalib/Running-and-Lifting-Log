export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const pad = n => String(n).padStart(2, '0');

// Local ISO date (YYYY-MM-DD) / datetime (YYYY-MM-DDTHH:MM) without timezone shifts.
export const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const isoDateTime = d => `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const parseLocal = s => {
  const [d, t = '00:00'] = s.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  return new Date(y, m - 1, dd, hh || 0, mm || 0);
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const fmtDate = s => { const d = parseLocal(s); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
export const fmtShort = s => { const d = parseLocal(s); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
export const fmtTime = s => { const d = parseLocal(s); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export const fmtDur = sec => {
  if (sec == null || isNaN(sec)) return '–';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};
// Accepts "45:30", "1:30:00", "45.30", "45 30" and digits only like a stopwatch:
// "45" = 45 min, "4530" = 45:30, "003000" = 0:30:00, "13000" = 1:30:00.
export const parseDur = str => {
  if (str == null) return null;
  const t = String(str).trim();
  if (!t) return null;
  let parts;
  if (/^\d+$/.test(t)) {
    if (t.length <= 2) return +t * 60;
    const sec = +t.slice(-2), min = +t.slice(-4, -2), hr = +(t.slice(0, -4) || 0);
    parts = [hr, min, sec];
  } else parts = t.split(/[:.,\s]+/).map(Number);
  if (!parts.length || parts.some(isNaN)) return null;
  if (parts.length > 1 && parts.slice(1).some(v => v >= 60)) return null;
  return parts.reduce((a, v) => a * 60 + v, 0);
};
export const fmtPace = (sec, km) => (km > 0 && sec > 0 ? `${fmtDur(sec / km)}/km` : '–');

export const num = v => {
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
};
export const fmtKg = w => (w == null ? '–' : `${+(+w).toFixed(2)}`);

// Epley estimated 1RM.
export const e1rm = (w, r) => (w > 0 && r > 0 ? w * (1 + r / 30) : 0);

export const daysBetween = (a, b) => Math.round((parseLocal(b) - parseLocal(a)) / 86400000);

export function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// RFC4180-ish CSV parser (handles quotes, commas, newlines in fields).
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() || [];
  return rows.filter(r => r.length > 1 || r[0]).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

export const toCSV = rows => {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n');
};

// Typed rest between sets: "230" or "2:30" = 2:30, "3" = 3 min, "90" = 90 s (one or two digits: up to 10 = minutes, above = seconds).
export const parseRest = v => { const t = String(v ?? '').trim(); if (/^\d{1,2}$/.test(t)) return +t <= 10 ? +t * 60 : +t; return parseDur(t); };
