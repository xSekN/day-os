// planner.js: day codes, patch codes, block state, "running late", the
// now/next computation and the calendar (.ics) export.

import { clone, fromMin, hhmm, isDateKey, isObj, normTime, plural, toMin, tsAt } from './util.js';
import { validateItem, applyTrackerCode } from './tracker.js';
import { validateWorkout } from './workout.js';

export const KINDS = ['routine', 'school', 'focus', 'workout', 'meal', 'break', 'chore', 'appointment', 'free', 'sleep'];
export const KIND_LABELS = {
  routine: 'Routine',
  school: 'School',
  focus: 'Focus',
  workout: 'Workout',
  meal: 'Meal',
  break: 'Break',
  chore: 'Chore',
  appointment: 'Appointment',
  free: 'Free',
  sleep: 'Sleep',
};
export const STATES = ['done', 'skipped', 'moved'];
export const STATE_LABELS = { done: 'done', skipped: 'skipped', moved: 'moved to tomorrow' };

// Start/end in minutes after midnight. An end before the start means the
// block runs past midnight (like sleep 22:15-06:30).
export function span(b) {
  const s = toMin(b.start);
  let e = toMin(b.end);
  if (e < s) e += 1440;
  return { s, e };
}

export function sortBlocks(blocks) {
  return blocks
    .map((b, i) => ({ b, i }))
    .sort((x, y) => toMin(x.b.start) - toMin(y.b.start) || x.i - y.i)
    .map((x) => x.b);
}

const RUNTIME = ['_state', '_tasks'];
function stripRuntime(b) {
  const o = { ...b };
  for (const k of RUNTIME) delete o[k];
  return o;
}

// ---------- validation ----------

export function validateBlock(raw, where, errors) {
  const before = errors.length;
  if (!isObj(raw)) {
    errors.push(`${where} must be an object like {"id":"b1","start":"06:30","end":"07:25","kind":"routine","title":"..."}`);
    return null;
  }
  const label = raw.id != null && raw.id !== '' ? `${where} (id "${raw.id}")` : where;
  const b = stripRuntime(raw);
  if (raw.id == null || raw.id === '') errors.push(`${label}: missing "id"`);
  else b.id = String(raw.id);
  for (const k of ['start', 'end']) {
    if (raw[k] == null) errors.push(`${label}: missing "${k}" (24h time like "15:00")`);
    else {
      const t = normTime(String(raw[k]));
      if (!t) errors.push(`${label}: ${k} "${raw[k]}" must be a 24h time like "15:00"`);
      else b[k] = t;
    }
  }
  if (b.start && b.end && b.start === b.end && errors.length === before) errors.push(`${label}: start and end are both ${b.start}`);
  if (raw.kind == null) errors.push(`${label}: missing "kind" (one of: ${KINDS.join(', ')})`);
  else if (!KINDS.includes(raw.kind)) errors.push(`${label}: kind "${raw.kind}" must be one of: ${KINDS.join(', ')}`);
  if (typeof raw.title !== 'string' || !raw.title.trim()) errors.push(`${label}: missing "title"`);
  if (raw.tasks != null && (!Array.isArray(raw.tasks) || raw.tasks.some((t) => typeof t !== 'string'))) {
    errors.push(`${label}: "tasks" must be a list of text, like ["Read ch. 4"]`);
  }
  if (raw.trackerId != null && typeof raw.trackerId !== 'string') errors.push(`${label}: "trackerId" must be text`);
  if (raw.note != null && typeof raw.note !== 'string') errors.push(`${label}: "note" must be text`);
  if (raw.workout != null) {
    const r = validateWorkout(raw.workout, { embedded: true, where: `${label} workout` });
    if (!r.ok) errors.push(...r.errors);
    else {
      b.workout = r.value;
      if (!b.workout.session) b.workout.session = typeof raw.title === 'string' ? raw.title.trim() : 'Workout';
    }
  }
  if (errors.length > before) return null;
  if (raw.tasks == null) delete b.tasks;
  b._state = null;
  b._tasks = (b.tasks || []).map(() => false);
  return b;
}

function checkHeader(obj, type, errors) {
  if (!isObj(obj)) {
    errors.push('The code must be a JSON object.');
    return false;
  }
  if (obj.type !== type) errors.push(`"type" must be "${type}"`);
  if (obj.v != null && obj.v !== 1) errors.push(`unsupported version "v": ${JSON.stringify(obj.v)} (this app reads v: 1)`);
  return true;
}

export function validateDay(obj) {
  const errors = [];
  if (!checkHeader(obj, 'day', errors)) return { ok: false, errors };
  if (!isDateKey(obj.date)) errors.push(obj.date == null ? 'missing "date" (like "2026-11-05")' : `date "${obj.date}" must look like "2026-11-05"`);
  if (obj.top3 != null && (!Array.isArray(obj.top3) || obj.top3.some((t) => typeof t !== 'string'))) {
    errors.push('"top3" must be a list of text, like ["Submit UMass EA", "Calc HWK 30", "Pull 1"]');
  }
  const deadlines = [];
  if (obj.deadlines != null) {
    if (!Array.isArray(obj.deadlines)) errors.push('"deadlines" must be a list like [{"name":"UMass EA","due":"2026-11-05"}]');
    else
      obj.deadlines.forEach((d, i) => {
        if (!isObj(d) || typeof d.name !== 'string' || !d.name.trim()) errors.push(`deadlines[${i}]: missing "name"`);
        else if (!isDateKey(d.due)) errors.push(`deadlines[${i}] ("${d.name}"): due "${d.due}" must look like "2026-11-05"`);
        else deadlines.push({ name: d.name, due: d.due });
      });
  }
  if (obj.note != null && typeof obj.note !== 'string') errors.push('"note" must be text');
  const blocks = [];
  if (!Array.isArray(obj.blocks)) errors.push('missing "blocks" (a list of time blocks)');
  else {
    const ids = new Set();
    obj.blocks.forEach((raw, i) => {
      const b = validateBlock(raw, `blocks[${i}]`, errors);
      if (!b) return;
      if (ids.has(b.id)) errors.push(`blocks[${i}]: id "${b.id}" is used twice`);
      ids.add(b.id);
      blocks.push(b);
    });
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    value: {
      ...obj,
      v: 1,
      type: 'day',
      date: obj.date,
      top3: obj.top3 ? obj.top3.slice() : [],
      deadlines,
      note: obj.note || '',
      blocks: sortBlocks(blocks),
    },
  };
}

export function validatePatch(obj, fallbackDate) {
  const errors = [];
  if (!checkHeader(obj, 'patch', errors)) return { ok: false, errors };
  let date = obj.date;
  if (date == null) date = fallbackDate;
  else if (!isDateKey(date)) errors.push(`date "${obj.date}" must look like "2026-11-05"`);
  if (!Array.isArray(obj.ops) || !obj.ops.length) errors.push('missing "ops" (a list of changes)');
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], value: { ...obj, date, ops: obj.ops } };
}

// ---------- installing a day code ----------

function remapTasks(oldBlock, newTasks) {
  const done = new Map();
  (oldBlock.tasks || []).forEach((t, i) => done.set(t, !!(oldBlock._tasks || [])[i]));
  return (newTasks || []).map((t) => done.get(t) || false);
}

// Put a validated day code into a day record. When replacing a plan, marks
// are kept for blocks with the same id and title, and top 3 checks for the
// same text.
export function installPlan(day, plan, now = Date.now()) {
  const old = day.plan;
  const next = clone(plan);
  if (old) {
    const byId = new Map(old.blocks.map((b) => [b.id, b]));
    for (const b of next.blocks) {
      const o = byId.get(b.id);
      if (o && o.title === b.title) {
        b._state = o._state || null;
        b._tasks = remapTasks(o, b.tasks);
      }
    }
    const was = new Map((old.top3 || []).map((t, i) => [t, !!day.top3[i]]));
    day.top3 = next.top3.map((t) => was.get(t) || false);
    day.changes.push({ t: hhmm(now), text: 'day code replaced' });
  } else {
    day.top3 = next.top3.map(() => false);
  }
  day.plan = next;
  return day;
}

export function findBlock(day, id) {
  return day && day.plan ? day.plan.blocks.find((b) => b.id === id) || null : null;
}

export function countMarked(day) {
  return day && day.plan ? day.plan.blocks.filter((b) => b._state).length : 0;
}

// ---------- patches ----------

function needPlan(day) {
  if (!day.plan) throw new Error(`no plan for ${day.date} yet, paste that day code first`);
}

function needBlock(day, id) {
  needPlan(day);
  if (id == null || id === '') throw new Error('missing "id"');
  const b = day.plan.blocks.find((x) => x.id === String(id));
  if (!b) throw new Error(`no block with id "${id}"`);
  return b;
}

function needTime(v, name) {
  const t = normTime(v == null ? '' : String(v));
  if (!t) throw new Error(v == null ? `missing "${name}" (24h time like "17:30")` : `${name} "${v}" must be a 24h time like "17:30"`);
  return t;
}

function shiftBlock(b, m) {
  b.start = fromMin(toMin(b.start) + m);
  b.end = fromMin(toMin(b.end) + m);
}

function applyOp(day, tracker, op) {
  if (!isObj(op)) throw new Error('each op must be an object like {"op":"move",...}');
  switch (op.op) {
    case 'move': {
      const b = needBlock(day, op.id);
      const st = needTime(op.start, 'start');
      const { s, e } = span(b);
      b.start = st;
      b.end = fromMin(toMin(st) + (e - s));
      return `moved ${b.id} to ${st}`;
    }
    case 'resize': {
      const b = needBlock(day, op.id);
      if (op.start == null && op.end == null) throw new Error('needs "end" (and/or "start")');
      const ns = op.start != null ? needTime(op.start, 'start') : b.start;
      const ne = op.end != null ? needTime(op.end, 'end') : b.end;
      if (ns === ne) throw new Error('start and end would be the same');
      const overnight = toMin(b.end) < toMin(b.start);
      if (!overnight && toMin(ne) < toMin(ns)) throw new Error(`end ${ne} would be before start ${ns}`);
      b.start = ns;
      b.end = ne;
      return `resized ${b.id} to ${ns}-${ne}`;
    }
    case 'add': {
      needPlan(day);
      const errs = [];
      const b = validateBlock(op.block, 'block', errs);
      if (!b) throw new Error(op.block == null ? 'missing "block"' : errs.join('; '));
      if (day.plan.blocks.some((x) => x.id === b.id)) throw new Error(`a block with id "${b.id}" already exists`);
      day.plan.blocks.push(b);
      return `added ${b.id} ${b.start}-${b.end} ${b.title}`;
    }
    case 'remove': {
      const b = needBlock(day, op.id);
      day.plan.blocks = day.plan.blocks.filter((x) => x !== b);
      return `removed ${b.id}`;
    }
    case 'update': {
      const b = needBlock(day, op.id);
      if (!isObj(op.set) || !Object.keys(op.set).length) throw new Error('needs a "set" object with the fields to change');
      if ('id' in op.set && String(op.set.id) !== b.id) throw new Error('"id" can\'t be changed by update');
      const merged = { ...stripRuntime(b), ...op.set, id: b.id };
      for (const k of Object.keys(op.set)) if (op.set[k] === null) delete merged[k];
      const errs = [];
      const nb = validateBlock(merged, 'block', errs);
      if (!nb) throw new Error(errs.join('; '));
      nb._state = b._state;
      nb._tasks = remapTasks(b, nb.tasks);
      day.plan.blocks[day.plan.blocks.indexOf(b)] = nb;
      return `updated ${b.id} (${Object.keys(op.set).join(', ')})`;
    }
    case 'shiftAfter': {
      needPlan(day);
      const t = needTime(op.time, 'time');
      const m = Number(op.minutes);
      if (!Number.isInteger(m) || m === 0) throw new Error('"minutes" must be a whole number like 20 or -10');
      const list = day.plan.blocks.filter((b) => toMin(b.start) >= toMin(t));
      list.forEach((b) => shiftBlock(b, m));
      return `shifted ${plural(list.length, 'block')} at/after ${t} by ${m > 0 ? '+' : ''}${m} min`;
    }
    case 'trackerAdd': {
      const errs = [];
      const it = validateItem(op.item, 'item', errs);
      if (!it) throw new Error(op.item == null ? 'missing "item"' : errs.join('; '));
      if (tracker.items.some((x) => x.id === it.id)) throw new Error(`tracker item "${it.id}" already exists (use trackerUpdate)`);
      tracker.items = applyTrackerCode(tracker, { mode: 'merge', items: [it] }).tracker.items;
      return `tracker added ${it.id}`;
    }
    case 'trackerUpdate': {
      if (op.id == null || op.id === '') throw new Error('missing "id"');
      const cur = tracker.items.find((x) => x.id === String(op.id));
      if (!cur) throw new Error(`no tracker item with id "${op.id}"`);
      if (!isObj(op.set) || !Object.keys(op.set).length) throw new Error('needs a "set" object with the fields to change');
      if ('id' in op.set && String(op.set.id) !== cur.id) throw new Error('"id" can\'t be changed by trackerUpdate');
      const errs = [];
      const it = validateItem({ ...op.set, id: cur.id }, 'set', errs, { partial: true });
      if (!it) throw new Error(errs.join('; '));
      tracker.items = applyTrackerCode(tracker, { mode: 'merge', items: [it] }).tracker.items;
      const fields = Object.keys(op.set).filter((k) => k !== 'id');
      const bits = fields.map((f) => (f === 'status' ? `status -> ${op.set.status}` : f));
      return `tracker updated ${cur.id}: ${bits.join(', ')}`;
    }
    case 'trackerRemove': {
      if (op.id == null || op.id === '') throw new Error('missing "id"');
      if (!tracker.items.some((x) => x.id === String(op.id))) throw new Error(`no tracker item with id "${op.id}"`);
      tracker.items = tracker.items.filter((x) => x.id !== String(op.id));
      return `tracker removed ${op.id}`;
    }
    default:
      throw new Error(op.op == null ? 'missing "op"' : `unknown op "${op.op}"`);
  }
}

export const OPS = ['move', 'resize', 'add', 'remove', 'update', 'shiftAfter', 'trackerAdd', 'trackerUpdate', 'trackerRemove'];

// Apply ops in order to copies of the day and tracker. Failed ops are skipped
// and reported; every applied op is logged in day.changes for the report.
export function applyPatch(dayIn, trackerIn, patch, now = Date.now()) {
  const day = clone(dayIn);
  const tracker = clone(trackerIn);
  if (!Array.isArray(tracker.items)) tracker.items = [];
  const t = hhmm(now);
  const results = [];
  patch.ops.forEach((op, i) => {
    try {
      const desc = applyOp(day, tracker, op);
      results.push({ i, ok: true, op: op.op, desc });
      day.changes.push({ t, text: `patch: ${desc}` });
    } catch (e) {
      results.push({ i, ok: false, op: isObj(op) ? op.op : undefined, error: e.message });
    }
  });
  if (day.plan) day.plan.blocks = sortBlocks(day.plan.blocks);
  return { day, tracker, results };
}

// ---------- now / next ----------

export function nowContext(day, nowMin) {
  const sorted = day && day.plan ? sortBlocks(day.plan.blocks) : [];
  let current = null;
  for (const b of sorted) {
    const { s, e } = span(b);
    if (!b._state && s <= nowMin && nowMin < e) {
      current = b;
      break;
    }
  }
  const upcoming = sorted.filter((b) => !b._state && b !== current && span(b).s > nowMin);
  return {
    sorted,
    current,
    next: upcoming[0] || null,
    after: upcoming[1] || null,
    upcoming,
    unmarkedPast: sorted.filter((b) => !b._state && b !== current && span(b).e <= nowMin),
    allMarked: sorted.length > 0 && sorted.every((b) => b._state),
  };
}

// "Running late": shift every remaining (unmarked, not yet ended) block.
export function runLate(day, minutes, nowMin, now = Date.now()) {
  if (!day.plan) return 0;
  const list = day.plan.blocks.filter((b) => !b._state && span(b).e > nowMin);
  list.forEach((b) => shiftBlock(b, minutes));
  day.plan.blocks = sortBlocks(day.plan.blocks);
  day.changes.push({ t: hhmm(now), text: `running late +${minutes} min` });
  return list.length;
}

export function setTask(day, id, idx, val) {
  const b = findBlock(day, id);
  if (!b || !b.tasks || idx < 0 || idx >= b.tasks.length) return false;
  if (!Array.isArray(b._tasks)) b._tasks = b.tasks.map(() => false);
  b._tasks[idx] = val;
  return true;
}

// ---------- focus timer (timestamp based) ----------

export function focusInfo(day, b, now = Date.now()) {
  const { s, e } = span(b);
  const dur = (e - s) * 60000;
  const f = (day.focus && day.focus[b.id]) || { acc: 0, since: null };
  const elapsed = Math.min(dur, f.acc + (f.since ? now - f.since : 0));
  return { dur, elapsed, running: !!f.since, remaining: Math.max(0, dur - elapsed) };
}

export function focusToggle(day, b, now = Date.now()) {
  const f = day.focus[b.id] || { acc: 0, since: null };
  if (f.since) {
    f.acc += now - f.since;
    f.since = null;
  } else {
    if (focusInfo(day, b, now).remaining <= 0) f.acc = 0;
    f.since = now;
  }
  day.focus[b.id] = f;
}

export function focusReset(day, b) {
  delete day.focus[b.id];
}

export function focusStop(day, id, now = Date.now()) {
  const f = day.focus && day.focus[id];
  if (f && f.since) {
    f.acc += now - f.since;
    f.since = null;
  }
}

// ---------- calendar export ----------

function icsEsc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsFold(line) {
  // Fold at 73 characters to stay under the 75-octet limit for plain ASCII.
  const out = [];
  let rest = line;
  while (rest.length > 73) {
    out.push(rest.slice(0, 73));
    rest = ' ' + rest.slice(73);
  }
  out.push(rest);
  return out.join('\r\n');
}

function icsStamp(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
}

function icsUtc(ts) {
  return new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function buildICS(day, now = Date.now()) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Day OS//Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Day OS'];
  const blocks = day && day.plan ? sortBlocks(day.plan.blocks).filter((b) => b._state !== 'skipped' && b._state !== 'moved') : [];
  for (const b of blocks) {
    const { s, e } = span(b);
    const desc = [];
    if (b.note) desc.push(b.note);
    if (b.tasks && b.tasks.length) desc.push('Tasks: ' + b.tasks.join('; '));
    L.push('BEGIN:VEVENT');
    L.push(`UID:${day.date}-${b.id}@day-os`);
    L.push(`DTSTAMP:${icsUtc(now)}`);
    L.push(`DTSTART:${icsStamp(tsAt(day.date, s))}`);
    L.push(`DTEND:${icsStamp(tsAt(day.date, e))}`);
    L.push(`SUMMARY:${icsEsc(b.title)}`);
    if (desc.length) L.push(`DESCRIPTION:${icsEsc(desc.join('\n'))}`);
    L.push(`CATEGORIES:${icsEsc(KIND_LABELS[b.kind] || b.kind)}`);
    L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(b.title)}`, 'TRIGGER:-PT5M', 'END:VALARM');
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(icsFold).join('\r\n') + '\r\n';
}
