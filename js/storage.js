// storage.js: every read and write of app state goes through here.
// localStorage is wrapped in try/catch; if it is unavailable the app keeps
// working from memory for the session instead of crashing.

import { addDays, isObj, todayKey } from './util.js';

const P = 'dayos.';
export const KEEP_DAYS = 60;
export const MAX_WORKOUTS = 200;

let mem = null; // fallback store when localStorage is missing or blocked
let errorHandler = null;
const cache = new Map();

function ls() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    return s;
  } catch {
    return null;
  }
}

export function onStorageError(fn) {
  errorHandler = fn;
}

function rawGet(k) {
  try {
    const s = ls();
    if (s) return s.getItem(k);
  } catch {
    /* fall through to memory */
  }
  return mem ? (mem.has(k) ? mem.get(k) : null) : null;
}

function rawSet(k, v) {
  const s = ls();
  if (s) {
    s.setItem(k, v);
    return;
  }
  (mem || (mem = new Map())).set(k, v);
}

function rawDel(k) {
  try {
    const s = ls();
    if (s) s.removeItem(k);
  } catch {
    /* ignore */
  }
  if (mem) mem.delete(k);
}

function rawKeys() {
  const out = [];
  try {
    const s = ls();
    if (s) {
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k && k.startsWith(P)) out.push(k);
      }
      return out;
    }
  } catch {
    /* fall through */
  }
  if (mem) for (const k of mem.keys()) if (k.startsWith(P)) out.push(k);
  return out;
}

export function read(key, fallback) {
  if (cache.has(key)) return cache.get(key);
  let val = fallback;
  try {
    const raw = rawGet(P + key);
    if (raw != null) val = JSON.parse(raw);
  } catch {
    val = fallback;
  }
  if (val !== undefined) cache.set(key, val);
  return val;
}

export function write(key, value) {
  cache.set(key, value);
  try {
    rawSet(P + key, JSON.stringify(value));
    return true;
  } catch (e) {
    // Quota exceeded: drop the oldest day records and try once more.
    try {
      pruneDays(todayKey(), 30);
      rawSet(P + key, JSON.stringify(value));
      return true;
    } catch (e2) {
      if (errorHandler) errorHandler(e2);
      return false;
    }
  }
}

export function remove(key) {
  cache.delete(key);
  rawDel(P + key);
}

export function keys() {
  return rawKeys().map((k) => k.slice(P.length));
}

export function resetCache() {
  cache.clear();
}

// For unit tests: use a plain in-memory store.
export function useMemoryStore() {
  mem = new Map();
  cache.clear();
}

// ---------- settings ----------

export const DEFAULT_SETTINGS = { sound: true, headsUpMin: 5 };

export function getSettings() {
  const s = read('settings', null);
  return { ...DEFAULT_SETTINGS, ...(isObj(s) ? s : {}) };
}

export function saveSettings(s) {
  return write('settings', s);
}

// ---------- days ----------

export function newDay(date) {
  return {
    date,
    plan: null, // the (patched) day code, blocks carry _state and _tasks
    top3: [], // booleans aligned with plan.top3
    changes: [], // [{ t: "HH:MM", text }]
    trackerLog: [], // the user's own tracker edits that day
    note: '', // day note for the report
    reportCopiedAt: null,
    headsUp: [], // "id@start" keys already announced
    focus: {}, // blockId -> { acc, since }
  };
}

function fixDay(d, date) {
  const base = newDay(date);
  if (!isObj(d)) return base;
  const out = { ...base, ...d, date };
  for (const k of ['top3', 'changes', 'trackerLog', 'headsUp']) if (!Array.isArray(out[k])) out[k] = [];
  if (!isObj(out.focus)) out.focus = {};
  if (out.plan && !Array.isArray(out.plan.blocks)) out.plan = null;
  return out;
}

export function getDay(date) {
  const d = read('day.' + date, null);
  return d ? fixDay(d, date) : null;
}

export function ensureDay(date) {
  return getDay(date) || newDay(date);
}

export function saveDay(day) {
  return write('day.' + day.date, day);
}

export function listDayKeys() {
  return keys()
    .filter((k) => k.startsWith('day.'))
    .map((k) => k.slice(4))
    .sort();
}

export function pruneDays(today = todayKey(), keep = KEEP_DAYS) {
  const cutoff = addDays(today, -keep);
  let n = 0;
  for (const k of listDayKeys()) {
    if (k < cutoff) {
      remove('day.' + k);
      n++;
    }
  }
  const inbox = getInbox();
  const kept = inbox.filter((i) => !i.date || i.date >= cutoff);
  if (kept.length !== inbox.length) saveInbox(kept);
  return n;
}

// ---------- tracker ----------

export function getTracker() {
  const t = read('tracker', null);
  return isObj(t) && Array.isArray(t.items) ? t : { items: [] };
}

export function saveTracker(t) {
  return write('tracker', t);
}

// ---------- inbox ----------

export function getInbox() {
  const v = read('inbox', []);
  return Array.isArray(v) ? v : [];
}

export function saveInbox(list) {
  return write('inbox', list);
}

// ---------- workouts ----------

export function getActiveWorkout() {
  const s = read('workout.active', null);
  return isObj(s) && isObj(s.code) ? s : null;
}

export function saveActiveWorkout(s) {
  if (!s) {
    remove('workout.active');
    return true;
  }
  return write('workout.active', s);
}

export function getWorkoutHistory() {
  const v = read('workout.history', []);
  return Array.isArray(v) ? v : [];
}

export function saveWorkoutHistory(list) {
  const sorted = list.slice().sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  return write('workout.history', sorted.slice(0, MAX_WORKOUTS));
}

export function upsertWorkout(entry) {
  const list = getWorkoutHistory().filter((e) => e.id !== entry.id);
  list.push(entry);
  return saveWorkoutHistory(list);
}

// ---------- ui (per-device conveniences) ----------

export function getUi() {
  const u = read('ui', null);
  return isObj(u) ? u : {};
}

export function setUi(patch) {
  return write('ui', { ...getUi(), ...patch });
}

// ---------- backup ----------

export function exportAll() {
  const data = {};
  for (const k of keys()) {
    if (k === 'ui') continue;
    const v = read(k, null);
    if (v !== null) data[k] = v;
  }
  return { app: 'day-os', type: 'backup', v: 1, exportedAt: new Date(Date.now()).toISOString(), data };
}

export function describeBackup(obj) {
  if (!isObj(obj) || obj.app !== 'day-os' || obj.type !== 'backup' || !isObj(obj.data)) {
    throw new Error('This is not a Day OS backup. It should start with {"app":"day-os","type":"backup"...');
  }
  if (obj.v !== 1) throw new Error(`Unsupported backup version: ${obj.v}`);
  const ks = Object.keys(obj.data);
  const bad = ks.filter((k) => !/^(settings|tracker|inbox|workout\.active|workout\.history|day\.\d{4}-\d{2}-\d{2})$/.test(k));
  if (bad.length) throw new Error(`Backup has unknown entries: ${bad.slice(0, 3).join(', ')}`);
  const days = ks.filter((k) => k.startsWith('day.')).length;
  const t = obj.data.tracker;
  const h = obj.data['workout.history'];
  return {
    days,
    trackerItems: isObj(t) && Array.isArray(t.items) ? t.items.length : 0,
    workouts: Array.isArray(h) ? h.length : 0,
    inbox: Array.isArray(obj.data.inbox) ? obj.data.inbox.length : 0,
    exportedAt: obj.exportedAt || null,
  };
}

export function importAll(obj) {
  describeBackup(obj); // throws if invalid
  // Write everything new first so a failure can't leave us half-empty.
  const old = keys().filter((k) => k !== 'ui');
  const incoming = Object.keys(obj.data);
  for (const k of incoming) {
    if (!write(k, obj.data[k])) throw new Error('Could not save the backup (storage full?). Nothing was removed.');
  }
  for (const k of old) if (!incoming.includes(k)) remove(k);
  return true;
}
