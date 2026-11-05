// workout.js: workout codes, the in-progress session engine, and LIFT LOG v1.
// The session is plain JSON so it can be saved after every tap and resumed
// exactly where it was left. Every timer is an absolute timestamp.

import { clone, dateKey, fmtNum, isDateKey, isObj, oneLine, slug, uid } from './util.js';

export const EX_TYPES = ['reps', 'time', 'bodyweight'];
export const TAGS = ['Too easy', 'Just right', 'Too hard', 'Pain'];
export const SWITCH_MS = 5000; // pause between sides on timed holds

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// ---------- validation ----------

export function validateWorkout(raw, { embedded = false, where = 'workout' } = {}) {
  const errors = [];
  const W = embedded ? `${where}: ` : '';
  if (!isObj(raw)) return { ok: false, errors: [`${where} must be a workout object`] };
  if (!embedded && raw.type !== 'workout') errors.push('"type" must be "workout"');
  if (embedded && raw.type != null && raw.type !== 'workout') errors.push(`${W}"type" must be "workout"`);
  if (raw.v != null && raw.v !== 1) errors.push(`${W}unsupported version "v": ${JSON.stringify(raw.v)} (expected 1)`);
  if (raw.session != null && typeof raw.session !== 'string') errors.push(`${W}"session" must be text, like "Push 1"`);
  if (!embedded && (typeof raw.session !== 'string' || !raw.session.trim())) errors.push('missing "session" (the workout name, like "Push 1")');
  if (raw.date != null && !isDateKey(raw.date)) errors.push(`${W}date "${raw.date}" must look like "2026-11-05"`);
  if (raw.notes != null && typeof raw.notes !== 'string') errors.push(`${W}"notes" must be text`);

  const warmup = [];
  if (raw.warmup != null) {
    if (!Array.isArray(raw.warmup)) errors.push(`${W}"warmup" must be a list`);
    else
      raw.warmup.forEach((w, i) => {
        if (typeof w === 'string' && w.trim()) warmup.push({ name: w });
        else if (isObj(w) && typeof w.name === 'string' && w.name.trim()) warmup.push({ name: w.name, detail: w.detail != null ? String(w.detail) : '' });
        else errors.push(`${W}warmup[${i}] needs a "name"`);
      });
  }

  const blocks = [];
  if (!Array.isArray(raw.blocks) || !raw.blocks.length) {
    errors.push(`${W}missing "blocks" (a list of exercise blocks)`);
  } else {
    const ids = new Set();
    raw.blocks.forEach((blk, bi) => {
      const bw = `${W}blocks[${bi}]`;
      if (!isObj(blk)) {
        errors.push(`${bw} must be an object with "exercises"`);
        return;
      }
      const label = blk.label != null && String(blk.label).trim() ? String(blk.label).trim() : LETTERS[bi] || `B${bi + 1}`;
      if (!Array.isArray(blk.exercises) || !blk.exercises.length) {
        errors.push(`${bw} (${label}): missing "exercises"`);
        return;
      }
      if (blk.rounds != null && !(Number.isInteger(blk.rounds) && blk.rounds >= 1)) errors.push(`${bw} (${label}): "rounds" must be a whole number of at least 1`);
      if (blk.restSec != null && !(typeof blk.restSec === 'number' && blk.restSec >= 0)) errors.push(`${bw} (${label}): "restSec" must be a number of seconds`);
      const rounds = Number.isInteger(blk.rounds) && blk.rounds >= 1 ? blk.rounds : null;
      const exercises = [];
      blk.exercises.forEach((ex, ei) => {
        const ew = `${bw}.exercises[${ei}]`;
        if (!isObj(ex)) {
          errors.push(`${ew} must be an object`);
          return;
        }
        const name = typeof ex.name === 'string' ? ex.name.trim() : '';
        if (!name) errors.push(`${ew}: missing "name"`);
        const type = ex.type == null ? 'reps' : ex.type;
        if (!EX_TYPES.includes(type)) errors.push(`${ew} (${name}): type "${ex.type}" must be one of: ${EX_TYPES.join(', ')}`);
        if (ex.sets != null && !(Number.isInteger(ex.sets) && ex.sets >= 1)) errors.push(`${ew} (${name}): "sets" must be a whole number of at least 1`);
        if (ex.reps == null || (typeof ex.reps !== 'string' && typeof ex.reps !== 'number')) {
          errors.push(`${ew} (${name}): missing "reps" (like "6-10"${type === 'time' ? ', or seconds like "30-45"' : ''})`);
        }
        let weight = ex.weight == null ? null : ex.weight;
        if (typeof weight === 'string' && weight.trim() !== '' && Number.isFinite(Number(weight))) weight = Number(weight);
        if (weight !== null && typeof weight !== 'number' && typeof weight !== 'string') errors.push(`${ew} (${name}): "weight" must be a number, null, or a short note`);
        if (ex.cues != null && !Array.isArray(ex.cues) && typeof ex.cues !== 'string') errors.push(`${ew} (${name}): "cues" must be a list of text`);
        let id = ex.id != null && String(ex.id).trim() ? String(ex.id) : slug(name);
        while (ids.has(id)) id += '-2';
        ids.add(id);
        exercises.push({
          ...ex,
          id,
          name,
          type,
          sets: Number.isInteger(ex.sets) && ex.sets >= 1 ? ex.sets : rounds || 3,
          reps: ex.reps == null ? '' : String(ex.reps),
          weight,
          unit: typeof ex.unit === 'string' && ex.unit.trim() ? ex.unit.trim() : 'lb',
          perHand: !!ex.perHand,
          perSide: !!ex.perSide,
          tempo: ex.tempo != null && String(ex.tempo).trim() ? String(ex.tempo) : '',
          cues: Array.isArray(ex.cues) ? ex.cues.map(String) : typeof ex.cues === 'string' && ex.cues ? [ex.cues] : [],
          last: ex.last != null && String(ex.last).trim() ? String(ex.last) : '',
        });
      });
      const maxSets = Math.max(1, ...exercises.map((e) => e.sets));
      blocks.push({
        ...blk,
        label,
        rounds: rounds || maxSets,
        restSec: typeof blk.restSec === 'number' && blk.restSec >= 0 ? Math.round(blk.restSec) : 60,
        exercises,
      });
    });
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    value: {
      ...raw,
      v: 1,
      type: 'workout',
      session: typeof raw.session === 'string' ? raw.session.trim() : '',
      notes: typeof raw.notes === 'string' ? raw.notes : '',
      warmup,
      blocks,
    },
  };
}

// ---------- display helpers ----------

export function exLabel(block, e) {
  return block.exercises.length > 1 ? `${block.label}${e + 1}` : block.label;
}

// Highest number in a rep/seconds target: "6-10" -> "10", "AMRAP" -> "".
export function repTop(reps) {
  const nums = String(reps == null ? '' : reps).match(/\d+(?:\.\d+)?/g);
  if (!nums) return '';
  return fmtNum(Math.max(...nums.map(Number)));
}

export function countSets(code) {
  return code.blocks.reduce((n, b) => n + b.exercises.reduce((m, e) => m + e.sets, 0), 0);
}

export function countExercises(code) {
  return code.blocks.reduce((n, b) => n + b.exercises.length, 0);
}

// Rough duration in minutes: work time per set, short transitions, block rest.
export function estimateMin(code) {
  let sec = (code.warmup || []).length * 60;
  code.blocks.forEach((blk, bi) => {
    const R = Math.max(...blk.exercises.map((e) => e.sets));
    for (let r = 0; r < R; r++) {
      const parts = blk.exercises.filter((e) => e.sets > r);
      for (const ex of parts) sec += ex.type === 'time' ? (Number(repTop(ex.reps)) || 30) * (ex.perSide ? 2 : 1) + 15 : 45;
      sec += Math.max(0, parts.length - 1) * 15;
      const last = bi === code.blocks.length - 1 && r === R - 1;
      if (!last) sec += blk.restSec;
    }
  });
  return Math.max(1, Math.round(sec / 60));
}

function weightNote(ex) {
  if (typeof ex.weight === 'number') return `${fmtNum(ex.weight)} ${ex.unit}${ex.perHand ? '/hand' : ''}`;
  if (typeof ex.weight === 'string' && ex.weight.trim()) return ex.weight.trim();
  return ex.type === 'bodyweight' ? 'bodyweight' : '';
}

// UI target, e.g. "4 x 6-10 @ 40 lb/hand", "3 x 30-45s each side".
export function targetText(ex) {
  let s = ex.type === 'time' ? `${ex.sets} x ${ex.reps}s` : `${ex.sets} x ${ex.reps}`;
  const w = ex.type === 'time' ? (typeof ex.weight === 'number' || (typeof ex.weight === 'string' && ex.weight) ? weightNote(ex) : '') : weightNote(ex);
  if (w) s += ` @ ${w}`;
  if (ex.perSide) s += ' each side';
  return s;
}

export function needsWeight(ex) {
  return ex.type === 'reps' && ex.weight === null;
}

// ---------- session ----------

function prefillW(ex) {
  return typeof ex.weight === 'number' ? fmtNum(ex.weight) : '';
}

export function newSession(codeIn, { source = null } = {}) {
  const code = clone(codeIn);
  return {
    id: uid('w'),
    code,
    source, // { date, blockId } when started from a day block
    phase: 'preview', // preview | warmup | active | finish
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    date: null,
    warmup: (code.warmup || []).map(() => false),
    ex: code.blocks.map((blk) =>
      blk.exercises.map((ex) => ({
        sets: Array.from({ length: ex.sets }, () => ({ w: prefillW(ex), r: repTop(ex.reps), done: false, at: null, we: false })),
        tags: [],
        note: '',
        skipped: false,
        swap: null,
      })),
    ),
    cur: { b: 0, e: 0, r: 0 },
    viewB: null,
    rest: null,
    hold: null,
    flash: null,
    feel: null,
    bw: '',
    note: '',
  };
}

export function startSession(s, now = Date.now()) {
  s.startedAt = now;
  // A workout started from a day block attaches its log to that day.
  s.date = s.source && s.source.date ? s.source.date : dateKey(new Date(now));
  s.phase = s.code.warmup && s.code.warmup.length ? 'warmup' : 'active';
  s.cur = nextPending(s, null) || { b: 0, e: 0, r: 0 };
}

export function endWarmup(s) {
  s.phase = 'active';
}

// All set slots in workout order: block by block, round by round, A1 then A2.
export function slots(s) {
  const out = [];
  s.code.blocks.forEach((blk, b) => {
    const R = Math.max(...blk.exercises.map((e) => e.sets));
    for (let r = 0; r < R; r++) blk.exercises.forEach((ex, e) => ex.sets > r && out.push({ b, e, r }));
  });
  return out;
}

const same = (a, b) => !!a && !!b && a.b === b.b && a.e === b.e && a.r === b.r;

export function isPending(s, sl) {
  const st = s.ex[sl.b] && s.ex[sl.b][sl.e];
  return !!st && !st.skipped && !!st.sets[sl.r] && !st.sets[sl.r].done;
}

// Next set still to do after `from` (wrapping around), or null when all done.
export function nextPending(s, from) {
  const all = slots(s);
  const i = from ? all.findIndex((x) => same(x, from)) : -1;
  for (let k = 0; k < all.length; k++) {
    const sl = all[(i + 1 + k + all.length) % all.length];
    if (isPending(s, sl)) return sl;
  }
  return null;
}

export function totals(s) {
  let done = 0;
  let total = 0;
  s.code.blocks.forEach((blk, b) =>
    blk.exercises.forEach((ex, e) => {
      const st = s.ex[b][e];
      const d = st.sets.filter((x) => x.done).length;
      done += d;
      total += st.skipped ? d : st.sets.length;
    }),
  );
  return { done, total };
}

export function setValue(s, b, e, r, field, val) {
  const set = s.ex[b][e].sets[r];
  if (!set) return;
  set[field] = String(val).trim();
  if (field === 'w') set.we = true;
}

// What the check button needs before it can log a set (null when ready).
export function missingInput(s, b, e, r) {
  const ex = s.code.blocks[b].exercises[e];
  const set = s.ex[b][e].sets[r];
  if (ex.type === 'time') return set.r === '' || !Number.isFinite(Number(set.r)) ? 'r' : null;
  if (set.r === '' || !Number.isFinite(Number(set.r))) return 'r';
  if (ex.type === 'reps' && (set.w === '' || !Number.isFinite(Number(set.w)))) {
    // A non-numeric weight note (like "red band") doesn't need a number.
    if (typeof ex.weight === 'string' && ex.weight && !s.ex[b][e].swap) return null;
    return 'w';
  }
  return null;
}

// Log one set. If it's the current set, advance the superset/straight-set flow:
// A1 -> A2 (no rest) -> rest -> A1 set 2 ... Returns { rest, allDone }.
export function logSet(s, b, e, r, now = Date.now()) {
  const st = s.ex[b][e];
  const set = st.sets[r];
  if (!set) return { rest: false, allDone: false };
  set.done = true;
  set.at = now;
  // Carry a changed weight forward to later sets the user hasn't touched.
  for (let k = r + 1; k < st.sets.length; k++) {
    const o = st.sets[k];
    if (!o.done && !o.we) o.w = set.w;
  }
  if (s.hold && s.hold.b === b && s.hold.e === e && s.hold.r === r) s.hold = null;
  const here = { b, e, r };
  if (!same(s.cur, here)) {
    if (!isPending(s, s.cur)) s.cur = nextPending(s, s.cur) || s.cur;
    return { rest: false, allDone: !nextPending(s, null) };
  }
  const nxt = nextPending(s, here);
  s.viewB = null;
  if (!nxt) {
    s.rest = null;
    return { rest: false, allDone: true };
  }
  s.cur = nxt;
  if (nxt.b === b && nxt.r === r) return { rest: false, allDone: false }; // superset: straight to A2
  const sec = s.code.blocks[b].restSec;
  if (sec > 0) {
    s.rest = { startedAt: now, endsAt: now + sec * 1000, total: sec * 1000 };
    return { rest: true, allDone: false };
  }
  return { rest: false, allDone: false };
}

export function unlogSet(s, b, e, r) {
  const set = s.ex[b][e].sets[r];
  if (!set) return;
  set.done = false;
  set.at = null;
}

export function jumpTo(s, b, e, r) {
  if (!s.ex[b] || !s.ex[b][e] || !s.ex[b][e].sets[r]) return;
  s.cur = { b, e, r };
  s.viewB = null;
}

export function viewBlock(s, b) {
  if (!s.code.blocks[b]) return;
  s.viewB = b;
  // Move the cursor to the first open set in that block, if there is one.
  const first = slots(s).find((sl) => sl.b === b && isPending(s, sl));
  if (first) {
    s.cur = first;
    s.viewB = null;
  }
}

export function skipExercise(s, b, e, on = true) {
  const st = s.ex[b][e];
  st.skipped = on;
  if (s.hold && s.hold.b === b && s.hold.e === e) s.hold = null;
  if (on && s.cur.b === b && s.cur.e === e) s.cur = nextPending(s, s.cur) || s.cur;
  if (!on && !isPending(s, s.cur)) s.cur = nextPending(s, s.cur) || s.cur;
}

export function swapExercise(s, b, e, name) {
  const st = s.ex[b][e];
  const ex = s.code.blocks[b].exercises[e];
  name = String(name || '').trim();
  st.swap = name || null;
  for (const set of st.sets) {
    if (set.done) continue;
    set.w = name ? '' : prefillW(ex);
    set.we = false;
  }
}

export function toggleTag(s, b, e, tag) {
  const st = s.ex[b][e];
  const i = st.tags.indexOf(tag);
  if (i >= 0) st.tags.splice(i, 1);
  else st.tags.push(tag);
}

// ---------- timers ----------

export function adjustRest(s, deltaMs, now = Date.now()) {
  if (!s.rest) return;
  s.rest.endsAt = Math.max(now, s.rest.endsAt + deltaMs);
  s.rest.total = Math.max(1000, s.rest.endsAt - s.rest.startedAt);
}

export function skipRest(s) {
  s.rest = null;
}

export function startHold(s, b, e, r, now = Date.now()) {
  const ex = s.code.blocks[b].exercises[e];
  const set = s.ex[b][e].sets[r];
  const target = Math.max(1, Math.round(Number(set.r) || Number(repTop(ex.reps)) || 30));
  s.cur = { b, e, r };
  s.viewB = null;
  s.rest = null;
  s.hold = { b, e, r, phase: ex.perSide ? 'side1' : 'hold', target, startedAt: now, endsAt: now + target * 1000, first: null, perSide: !!ex.perSide };
}

export function cancelHold(s) {
  s.hold = null;
}

function finishHold(s, secs, at) {
  const h = s.hold;
  s.hold = null;
  s.ex[h.b][h.e].sets[h.r].r = String(secs);
  return logSet(s, h.b, h.e, h.r, at);
}

// "Stop" on a running hold: log what was held (or move to side 2).
export function stopHold(s, now = Date.now()) {
  const h = s.hold;
  if (!h) return null;
  const held = Math.max(1, Math.min(h.target, Math.round((now - h.startedAt) / 1000)));
  if (h.phase === 'switch') {
    Object.assign(h, { phase: 'side2', startedAt: now, endsAt: now + h.target * 1000 });
    return { type: 'holdGo' };
  }
  if (h.phase === 'side1') {
    Object.assign(h, { first: held, phase: 'switch', startedAt: now, endsAt: now + SWITCH_MS });
    return { type: 'holdSide' };
  }
  const secs = h.first != null ? Math.min(h.first, held) : held;
  return { type: 'holdDone', ...finishHold(s, secs, now) };
}

// Advance rest and hold timers to `now`. Returns events so the UI can beep.
// `late` is how long ago the event really happened (no beeps for stale ones).
export function tickTimers(s, now = Date.now()) {
  const events = [];
  let guard = 0;
  while (s.hold && now >= s.hold.endsAt && guard++ < 10) {
    const h = s.hold;
    const at = h.endsAt;
    if (h.phase === 'side1') {
      Object.assign(h, { first: h.target, phase: 'switch', startedAt: at, endsAt: at + SWITCH_MS });
      events.push({ type: 'holdSide', late: now - at });
    } else if (h.phase === 'switch') {
      Object.assign(h, { phase: 'side2', startedAt: at, endsAt: at + h.target * 1000 });
      events.push({ type: 'holdGo', late: now - at });
    } else {
      const secs = h.first != null ? Math.min(h.first, h.target) : h.target;
      const res = finishHold(s, secs, at);
      events.push({ type: 'holdDone', late: now - at, ...res });
    }
  }
  if (s.rest && now >= s.rest.endsAt) {
    const at = s.rest.endsAt;
    s.rest = null;
    s.flash = { until: at + 5000 };
    events.push({ type: 'restDone', late: now - at });
  }
  if (s.flash && now >= s.flash.until) s.flash = null;
  return events;
}

// "A1 set 2, 40 lb x 10"
export function setText(s, sl) {
  if (!sl) return '';
  const blk = s.code.blocks[sl.b];
  const ex = blk.exercises[sl.e];
  const st = s.ex[sl.b][sl.e];
  const set = st.sets[sl.r];
  const head = `${exLabel(blk, sl.e)} set ${sl.r + 1}`;
  if (ex.type === 'time') return `${head}, ${set.r || repTop(ex.reps) || '?'}s${ex.perSide ? ' each side' : ''}`;
  let w;
  if (set.w !== '' && Number.isFinite(Number(set.w))) w = `${fmtNum(set.w)} ${ex.unit}`;
  else if (ex.type === 'bodyweight') w = 'BW';
  else if (typeof ex.weight === 'string' && ex.weight && !st.swap) w = ex.weight;
  else w = 'find your weight';
  return `${head}, ${w} x ${set.r || '?'}`;
}

export function finishSession(s, now = Date.now()) {
  s.finishedAt = now;
  s.phase = 'finish';
  s.rest = null;
  s.hold = null;
  s.flash = null;
  if (!s.date) s.date = dateKey(new Date(s.startedAt || now));
}

export function durationMin(s, now = Date.now()) {
  if (!s.startedAt) return 0;
  return Math.max(0, Math.round(((s.finishedAt || now) - s.startedAt) / 60000));
}

// ---------- LIFT LOG v1 ----------

function logTarget(ex) {
  let t;
  if (ex.type === 'time') t = `${ex.sets}x${ex.reps}s`;
  else {
    t = `${ex.sets}x${ex.reps}`;
    if (typeof ex.weight === 'number') t += ` @${fmtNum(ex.weight)}`;
    else if (typeof ex.weight === 'string' && ex.weight.trim()) t += ` @${ex.weight.trim()}`;
    else if (ex.type === 'bodyweight') t += ' @bodyweight';
  }
  return `[target ${t}]`;
}

function logSetValue(ex, set) {
  if (!set.done) return '-';
  if (ex.type === 'time') return `${fmtNum(set.r)}s`;
  const w = set.w !== '' && Number.isFinite(Number(set.w)) ? fmtNum(set.w) : ex.type === 'bodyweight' || (typeof ex.weight === 'string' && ex.weight) ? 'BW' : '?';
  return `${w}x${set.r !== '' ? fmtNum(set.r) : '?'}`;
}

function tagNote(st) {
  let out = '';
  if (st.tags && st.tags.length) out += ` | tag: ${st.tags.map((t) => t.toLowerCase()).join(', ')}`;
  if (st.note && st.note.trim()) out += ` | note: ${oneLine(st.note)}`;
  return out;
}

export function buildLiftLog(s, now = Date.now()) {
  const c = s.code;
  const head = [`Session: ${c.session}`, `Date: ${s.date || dateKey(new Date(s.startedAt || now))}`];
  if (c.week != null && String(c.week).trim() !== '') head.push(`Week: ${c.week}`);
  head.push(`Duration: ${durationMin(s, now)} min`);
  if (s.feel) head.push(`Feel: ${s.feel}/5`);
  const bw = String(s.bw || '').trim();
  if (bw && Number.isFinite(Number(bw)) && Number(bw) > 0) head.push(`Bodyweight: ${fmtNum(bw)} lb`);
  const regular = [];
  const skipped = [];
  const swapped = [];
  c.blocks.forEach((blk, b) =>
    blk.exercises.forEach((ex, e) => {
      const st = s.ex[b][e];
      const label = exLabel(blk, e);
      const doneCount = st.sets.filter((x) => x.done).length;
      if (st.skipped && doneCount === 0) {
        skipped.push(`SKIPPED: ${label} ${ex.name}${st.swap ? ` -> ${st.swap}` : ''}${tagNote(st)}`);
        return;
      }
      const sets = st.sets.map((set) => logSetValue(ex, set)).join(', ');
      if (st.swap) {
        swapped.push(`SWAPPED: ${label} ${ex.name} -> ${st.swap}: ${sets}${tagNote(st)}`);
        return;
      }
      regular.push(`${label} ${ex.name} ${logTarget(ex)}${ex.perSide ? ' (each side)' : ''}: ${sets}${tagNote(st)}`);
    }),
  );
  const lines = ['LIFT LOG v1', head.join(' | '), ...regular, ...skipped, ...swapped];
  if (s.note && s.note.trim()) lines.push(`Session note: ${oneLine(s.note)}`);
  return lines.join('\n');
}

// Compact record kept in workout history (and read by the day report).
export function historyEntry(s, now = Date.now()) {
  const t = totals(s);
  return {
    id: s.id,
    date: s.date,
    session: s.code.session,
    week: s.code.week != null ? s.code.week : null,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt || now,
    durationMin: durationMin(s, now),
    done: t.done,
    total: t.total,
    feel: s.feel || null,
    source: s.source || null,
    log: buildLiftLog(s, now),
    ex: s.code.blocks.flatMap((blk, b) =>
      blk.exercises.map((ex, e) => {
        const st = s.ex[b][e];
        return { id: ex.id, name: st.swap || ex.name, swapped: !!st.swap, sets: st.sets.filter((x) => x.done).map((x) => logSetValue(ex, x)).join(', ') };
      }),
    ),
  };
}

// "Last time" from local history when the code doesn't include one.
export function lastFromHistory(history, exId, beforeId) {
  for (const h of history) {
    if (h.id === beforeId) continue;
    const x = (h.ex || []).find((y) => y.id === exId && !y.swapped && y.sets);
    if (x) return x.sets;
  }
  return '';
}
