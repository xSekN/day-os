// tracker.js: deadlines (colleges, tests, assignments, other).
// Validates tracker codes, merges them, sorts and colours items, and
// summarises the user's own tracker edits for the end-of-day report.

import { clone, daysBetween, isDateKey, isObj, normTime, plural } from './util.js';

export const CATS = ['college', 'test', 'assignment', 'other'];
export const CAT_LABELS = { college: 'Colleges', test: 'Tests', assignment: 'Assignments', other: 'Other' };
export const STATUSES = ['not_started', 'in_progress', 'done', 'submitted'];
export const STATUS_LABELS = {
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
  submitted: 'Submitted',
};

export const isClosed = (it) => it && (it.status === 'done' || it.status === 'submitted');

// Validate one tracker item. partial=true is for updates: only fields that are
// present get checked. Returns the cleaned item (or null if it has errors).
export function validateItem(raw, where, errors, { partial = false } = {}) {
  const before = errors.length;
  if (!isObj(raw)) {
    errors.push(`${where} must be an object like {"id":"umass","title":"UMass Amherst",...}`);
    return null;
  }
  const label = raw.id != null ? `${where} (id "${raw.id}")` : where;
  const it = { ...raw };

  if (!partial || 'id' in raw) {
    if (raw.id == null || raw.id === '') errors.push(`${label}: missing "id"`);
    else it.id = String(raw.id);
  }
  if (!partial || 'title' in raw) {
    if (typeof raw.title !== 'string' || !raw.title.trim()) errors.push(`${label}: missing "title"`);
  }
  if ('cat' in raw) {
    if (!CATS.includes(raw.cat)) errors.push(`${label}: cat "${raw.cat}" must be one of: ${CATS.join(', ')}`);
  } else if (!partial) it.cat = 'other';
  if ('status' in raw) {
    if (!STATUSES.includes(raw.status)) errors.push(`${label}: status "${raw.status}" must be one of: ${STATUSES.join(', ')}`);
  } else if (!partial) it.status = 'not_started';
  if ('due' in raw && raw.due !== null && !isDateKey(raw.due)) {
    errors.push(`${label}: due "${raw.due}" must be a date like "2026-11-05"`);
  }
  if ('dueTime' in raw && raw.dueTime !== null) {
    const t = normTime(String(raw.dueTime));
    if (!t) errors.push(`${label}: dueTime "${raw.dueTime}" must be a 24h time like "23:59"`);
    else it.dueTime = t;
  }
  if ('subtasks' in raw && raw.subtasks !== null) {
    if (!Array.isArray(raw.subtasks)) errors.push(`${label}: "subtasks" must be a list like [{"t":"Submit","done":false}]`);
    else {
      it.subtasks = raw.subtasks.map((s, i) => {
        if (typeof s === 'string') return { t: s, done: false };
        if (!isObj(s) || typeof s.t !== 'string' || !s.t.trim()) {
          errors.push(`${label}: subtasks[${i}] needs a "t" text, like {"t":"Submit","done":false}`);
          return null;
        }
        return { ...s, t: s.t, done: !!s.done };
      });
    }
  }
  if ('notes' in raw && raw.notes !== null && typeof raw.notes !== 'string') errors.push(`${label}: "notes" must be text`);
  if ('meta' in raw && raw.meta !== null && !isObj(raw.meta)) errors.push(`${label}: "meta" must be an object`);
  return errors.length > before ? null : it;
}

// Validate a whole tracker code against the current tracker.
export function validateTrackerCode(obj, tracker = { items: [] }) {
  const errors = [];
  if (!isObj(obj)) return { ok: false, errors: ['The code must be a JSON object.'] };
  if (obj.type !== 'tracker') errors.push('"type" must be "tracker"');
  const mode = obj.mode == null ? 'merge' : obj.mode;
  if (mode !== 'merge' && mode !== 'replace') errors.push(`"mode" is "${obj.mode}" but must be "merge" or "replace"`);
  if (!Array.isArray(obj.items)) {
    errors.push('missing "items" (a list of tracker items)');
    return { ok: false, errors };
  }
  const existing = new Set((tracker.items || []).map((i) => i.id));
  const seen = new Set();
  const items = obj.items.map((raw, i) => {
    const where = `items[${i}]`;
    const isUpdate = mode === 'merge' && isObj(raw) && raw.id != null && existing.has(String(raw.id));
    // Updates to existing items may list only the fields that change.
    const it = validateItem(raw, where, errors, { partial: isUpdate });
    if (it && it.id != null) {
      if (seen.has(it.id)) errors.push(`${where}: id "${it.id}" appears twice`);
      seen.add(it.id);
    }
    return it;
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], value: { mode, items } };
}

// Apply a validated tracker code. Returns the new tracker plus what changed.
export function applyTrackerCode(tracker, code) {
  if (code.mode === 'replace') {
    return {
      tracker: { items: clone(code.items) },
      added: code.items.map((i) => i.id),
      updated: [],
      removed: (tracker.items || []).length,
    };
  }
  const items = clone(tracker.items || []);
  const added = [];
  const updated = [];
  for (const it of code.items) {
    const idx = items.findIndex((x) => x.id === it.id);
    if (idx === -1) {
      items.push(clone(it));
      added.push(it.id);
    } else {
      const fields = Object.keys(it).filter((k) => k !== 'id');
      items[idx] = { ...items[idx], ...clone(it) };
      updated.push({ id: it.id, fields });
    }
  }
  return { tracker: { items }, added, updated, removed: 0 };
}

export function sortItems(items) {
  return items.slice().sort((a, b) => {
    const da = a.due || '9999-99-99';
    const db = b.due || '9999-99-99';
    if (da !== db) return da < db ? -1 : 1;
    const ta = a.dueTime || '99:99';
    const tb = b.dueTime || '99:99';
    if (ta !== tb) return ta < tb ? -1 : 1;
    return String(a.title).localeCompare(String(b.title));
  });
}

// "red" if overdue or due within 3 days, "yellow" within 7, otherwise "neutral".
export function urgency(item, today) {
  if (isClosed(item)) return 'done';
  if (!item.due) return 'neutral';
  const d = daysBetween(today, item.due);
  if (d <= 3) return 'red';
  if (d <= 7) return 'yellow';
  return 'neutral';
}

export function urgencyForDate(due, today) {
  return urgency({ due, status: 'not_started' }, today);
}

// Short countdown for strips: "today", "tomorrow", "10 days", "2 days overdue".
export function dueShort(due, today) {
  if (!due) return 'no date';
  const d = daysBetween(today, due);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d < 0) return `${plural(-d, 'day')} overdue`;
  return plural(d, 'day');
}

// Next deadlines across the day code and the tracker.
export function upcomingDeadlines(plan, tracker, today, n = 3) {
  const list = [];
  const seen = new Set();
  const add = (x) => {
    const key = x.name.trim().toLowerCase() + '|' + x.due;
    if (seen.has(key)) return;
    seen.add(key);
    list.push(x);
  };
  for (const d of (plan && plan.deadlines) || []) {
    if (d && d.name && isDateKey(d.due) && d.due >= today) add({ name: d.name, due: d.due, src: 'day' });
  }
  for (const it of (tracker && tracker.items) || []) {
    if (!it.due || isClosed(it)) continue;
    add({ name: it.title, due: it.due, dueTime: it.dueTime || null, id: it.id, src: 'tracker' });
  }
  list.sort((a, b) => (a.due !== b.due ? (a.due < b.due ? -1 : 1) : (a.dueTime || '99') < (b.dueTime || '99') ? -1 : 1));
  return list.slice(0, n);
}

export function subtaskProgress(it) {
  const s = Array.isArray(it.subtasks) ? it.subtasks : [];
  return { done: s.filter((x) => x.done).length, total: s.length };
}

// ---------- the user's own edits, for the report ----------

export function logEdit(day, entry) {
  day.trackerLog.push({ ts: Date.now(), ...entry });
}

// Collapse a day's edits into report lines like:
//   umass: "Submit" checked; status -> submitted
export function summarizeLog(log) {
  const order = [];
  const byId = new Map();
  for (const e of log || []) {
    if (!e || !e.id) continue;
    if (!byId.has(e.id)) {
      byId.set(e.id, { subs: new Map(), status: null, notes: null });
      order.push(e.id);
    }
    const g = byId.get(e.id);
    if (e.k === 'sub') {
      const prev = g.subs.get(e.t);
      g.subs.set(e.t, { was: prev ? prev.was : !e.done, now: !!e.done });
    } else if (e.k === 'status') {
      g.status = { from: g.status ? g.status.from : e.from, to: e.to };
    } else if (e.k === 'notes') {
      g.notes = { from: g.notes ? g.notes.from : e.from || '', to: e.to || '' };
    }
  }
  const lines = [];
  for (const id of order) {
    const g = byId.get(id);
    const parts = [];
    for (const [t, s] of g.subs) if (s.was !== s.now) parts.push(`"${t}" ${s.now ? 'checked' : 'unchecked'}`);
    if (g.status && g.status.from !== g.status.to) parts.push(`status -> ${g.status.to}`);
    if (g.notes && g.notes.from !== g.notes.to) parts.push(`notes -> "${String(g.notes.to).replace(/\s*\n+\s*/g, ' / ')}"`);
    if (parts.length) lines.push(`${id}: ${parts.join('; ')}`);
  }
  return lines;
}
