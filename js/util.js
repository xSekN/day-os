// util.js: small, DOM-free helpers shared by every module.
// All "now" values come from Date.now() so timers survive the phone locking.

export const pad2 = (n) => String(n).padStart(2, '0');

export const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

export function clone(x) {
  return x === undefined ? undefined : JSON.parse(JSON.stringify(x));
}

export function uid(prefix = 'id') {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------- dates (local time, "YYYY-MM-DD") ----------

export function dateKey(d) {
  d = d || new Date(Date.now());
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export const todayKey = () => dateKey(new Date(Date.now()));

export function parseDateKey(k) {
  const [y, m, d] = String(k).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isDateKey(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return dateKey(parseDateKey(s)) === s;
}

export function addDays(k, n) {
  const d = parseDateKey(k);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

// Whole days from a to b (b - a).
export function daysBetween(a, b) {
  return Math.round((parseDateKey(b) - parseDateKey(a)) / 86400000);
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function prettyDate(k, { year = false } = {}) {
  if (!isDateKey(k)) return String(k || '');
  const d = parseDateKey(k);
  let s = `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`;
  if (year) s += `, ${d.getFullYear()}`;
  return s;
}

export function relDay(k, today = todayKey()) {
  const n = daysBetween(today, k);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return '';
}

// ---------- times ("HH:MM", 24h) ----------

// Accepts "6:30" or "06:30" (and "24:00"); returns "06:30" or null.
export function normTime(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = +m[1];
  const mi = +m[2];
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return null;
  return pad2(h) + ':' + pad2(mi);
}

export function toMin(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

export function fromMin(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
}

export function nowMinutes(ts = Date.now()) {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60000;
}

export function hhmm(ts = Date.now()) {
  const d = new Date(ts);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

// Timestamp for a date key plus minutes after its midnight (may exceed 1440).
export function tsAt(k, min) {
  const [y, m, d] = String(k).split('-').map(Number);
  const whole = Math.floor(min);
  return new Date(y, m - 1, d, Math.floor(whole / 60), whole % 60, Math.round((min - whole) * 60)).getTime();
}

// ---------- formatting ----------

// Countdown clock: "4:05", "42:10", "1:02:03". Rounds up so it hits 0:00 exactly at zero.
export function fmtClock(ms, { up = false } = {}) {
  let s = Math.max(0, up ? Math.floor(ms / 1000) : Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

// "25 min", "1 h", "1 h 5 min"
export function fmtMins(min) {
  min = Math.max(0, Math.round(min));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function fmtNum(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n);
  return Number.isInteger(x) ? String(x) : String(+x.toFixed(2));
}

export function plural(n, word, pl) {
  return `${n} ${n === 1 ? word : pl || word + 's'}`;
}

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function oneLine(s) {
  return String(s == null ? '' : s).replace(/\s*\n+\s*/g, ' / ').trim();
}

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
}
