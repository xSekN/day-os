// views/common.js: block actions and sheets shared by Now and Today.

import { App, act, beep, checkbox, closeSheet, confirmSheet, esc, icon, kindIcon, onInput, openSheet, refreshSheet, sheetHead, sheetOpen, toast } from '../ui.js';
import * as store from '../storage.js';
import { findBlock, focusInfo, focusReset, focusStop, focusToggle, KIND_LABELS, setTask, span, STATE_LABELS } from '../planner.js';
import { isClosed, logEdit } from '../tracker.js';
import { fmtClock, fmtMins, hhmm, prettyDate, todayKey, uid } from '../util.js';
import { openTrackerSheet } from './tracker-view.js';
import { startWorkoutFrom } from './workout-view.js';

export function kindChip(kind) {
  return `<span class="kind-chip" style="--k:var(--k-${kind})">${kindIcon(kind)}<span>${esc(KIND_LABELS[kind] || kind)}</span></span>`;
}

export function stateBadge(b, isCurrent) {
  if (b._state === 'done') return `<span class="badge ok">${icon('check')}Done</span>`;
  if (b._state === 'skipped') return '<span class="badge mute">Skipped</span>';
  if (b._state === 'moved') return `<span class="badge moved">${icon('tomorrow')}Tomorrow</span>`;
  if (isCurrent) return '<span class="badge now">Now</span>';
  return '';
}

export function taskList(date, b) {
  if (!b.tasks || !b.tasks.length) return '';
  return `<div class="tasks">${b.tasks
    .map((t, i) => checkbox(!!(b._tasks && b._tasks[i]), esc(t), 'blk.task', `data-date="${date}" data-id="${esc(b.id)}" data-i="${i}"`))
    .join('')}</div>`;
}

export function trackerLink(b) {
  if (!b.trackerId) return '';
  const it = store.getTracker().items.find((x) => x.id === b.trackerId);
  if (!it) return `<div class="trk-link missing">${icon('link')}<span>Tracker item "${esc(b.trackerId)}" not found</span></div>`;
  return `<button class="trk-link" data-act="trk.open" data-id="${esc(it.id)}">${icon('tracker')}<span>${esc(it.title)}</span><span class="muted">${esc(it.status.replace('_', ' '))}</span>${icon('right')}</button>`;
}

// Focus timer ring for focus blocks (timestamp based; survives the lock screen).
export function focusTimer(day, b) {
  const f = focusInfo(day, b);
  const R = 52;
  const C = 2 * Math.PI * R;
  const frac = f.dur ? f.elapsed / f.dur : 0;
  const now = Date.now();
  const startedAt = now - f.elapsed;
  const endsAt = now + f.remaining;
  const live = f.running ? `data-cd="down" data-to="${endsAt}"` : '';
  const ring = f.running ? `data-cd="ring" data-from="${startedAt}" data-to="${endsAt}" data-c="${C}"` : '';
  return `<div class="focus">
    <svg class="ring" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="${R}" class="ring-bg"/>
      <circle cx="60" cy="60" r="${R}" class="ring-fg" ${ring} stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}"/>
    </svg>
    <div class="focus-mid"><div class="focus-time" ${live}>${fmtClock(f.remaining)}</div><div class="muted small">${f.running ? 'focus' : f.elapsed ? 'paused' : 'focus timer'}</div></div>
    <div class="focus-btns">
      <button class="btn ${f.running ? '' : 'primary'}" data-act="focus.toggle" data-date="${day.date}" data-id="${esc(b.id)}">${icon(f.running ? 'pause' : 'play')}<span>${f.running ? 'Pause' : f.elapsed ? 'Resume' : 'Start'}</span></button>
      ${f.elapsed ? `<button class="btn" data-act="focus.reset" data-date="${day.date}" data-id="${esc(b.id)}">${icon('reset')}<span>Reset</span></button>` : ''}
    </div>
  </div>`;
}

function workoutButton(date, b) {
  if (b.kind !== 'workout') return '';
  if (!b.workout) return '<div class="muted small">No workout code in this block. Paste one on the Workout tab.</div>';
  const s = store.getActiveWorkout();
  const mine = s && s.source && s.source.date === date && s.source.blockId === b.id && s.phase !== 'finish';
  return `<button class="btn block primary big" data-act="blk.workout" data-date="${date}" data-id="${esc(b.id)}">${icon('workout')}<span>${mine ? 'Resume workout' : 'Start workout'}: ${esc(b.workout.session || b.title)}</span></button>`;
}

export function blockExtras(day, b) {
  return [b.note ? `<p class="block-note">${esc(b.note)}</p>` : '', taskList(day.date, b), b.kind === 'focus' && day.date === todayKey() && !b._state ? focusTimer(day, b) : '', workoutButton(day.date, b), trackerLink(b)].join('');
}

// ---------- marking blocks ----------

export function markBlock(date, id, state) {
  const day = store.getDay(date);
  const b = findBlock(day, id);
  if (!b) return;
  const prev = b._state;
  b._state = state;
  if (state) focusStop(day, id);
  store.saveDay(day);
  App.render();
  refreshSheet();
  const label = state ? STATE_LABELS[state] : 'unmarked';
  toast(`${b.title}: ${label}`, {
    action: {
      label: 'Undo',
      fn: () => {
        const d = store.getDay(date);
        const x = findBlock(d, id);
        if (x) x._state = prev;
        store.saveDay(d);
        App.render();
        refreshSheet();
      },
    },
  });
  if (state === 'done' && b.trackerId) {
    const it = store.getTracker().items.find((x) => x.id === b.trackerId);
    if (it && !isClosed(it)) askTrackerDone(date, it);
  }
}

function askTrackerDone(date, it) {
  confirmSheet({
    title: 'Mark the tracker item done too?',
    body: `<div class="trk-confirm">${icon('tracker')}<b>${esc(it.title)}</b></div>`,
    yes: 'Yes, mark it done',
    no: 'Not now',
    onYes: () => {
      const t = store.getTracker();
      const x = t.items.find((y) => y.id === it.id);
      if (!x) return;
      const from = x.status;
      x.status = 'done';
      store.saveTracker(t);
      const day = store.ensureDay(todayKey());
      logEdit(day, { id: x.id, k: 'status', from, to: 'done' });
      store.saveDay(day);
      toast(`${x.title}: done`);
      App.render();
    },
  });
}

act('blk.done', (el) => markBlock(el.dataset.date, el.dataset.id, 'done'));
act('blk.skip', (el) => markBlock(el.dataset.date, el.dataset.id, 'skipped'));
act('blk.moved', (el) => markBlock(el.dataset.date, el.dataset.id, 'moved'));
act('blk.clear', (el) => markBlock(el.dataset.date, el.dataset.id, null));

act('blk.task', (el) => {
  const day = store.getDay(el.dataset.date);
  const b = findBlock(day, el.dataset.id);
  if (!b) return;
  const i = +el.dataset.i;
  setTask(day, b.id, i, !(b._tasks && b._tasks[i]));
  store.saveDay(day);
  App.render();
  refreshSheet();
});

act('top3.toggle', (el) => {
  const day = store.getDay(el.dataset.date);
  if (!day) return;
  const i = +el.dataset.i;
  day.top3[i] = !day.top3[i];
  store.saveDay(day);
  App.render();
});

act('focus.toggle', (el) => {
  const day = store.getDay(el.dataset.date);
  const b = findBlock(day, el.dataset.id);
  if (!b) return;
  focusToggle(day, b);
  store.saveDay(day);
  App.render();
  refreshSheet();
});

act('focus.reset', (el) => {
  const day = store.getDay(el.dataset.date);
  const b = findBlock(day, el.dataset.id);
  if (!b) return;
  focusReset(day, b);
  store.saveDay(day);
  App.render();
  refreshSheet();
});

act('blk.workout', (el) => {
  const day = store.getDay(el.dataset.date);
  const b = findBlock(day, el.dataset.id);
  if (!b || !b.workout) return;
  if (sheetOpen()) closeSheet(true);
  startWorkoutFrom(b.workout, { date: day.date, blockId: b.id });
});

act('trk.open', (el) => openTrackerSheet(el.dataset.id));

// Called every tick: finish focus timers that ran out (with a beep).
export function checkFocusTimers(now = Date.now()) {
  const day = store.getDay(todayKey());
  if (!day || !day.plan) return false;
  let changed = false;
  for (const [id, f] of Object.entries(day.focus || {})) {
    if (!f.since) continue;
    const b = findBlock(day, id);
    if (!b) continue;
    const info = focusInfo(day, b, now);
    if (info.remaining <= 0) {
      const endedAt = f.since + (info.dur - f.acc);
      f.acc = info.dur;
      f.since = null;
      changed = true;
      if (now - endedAt < 5000) beep('done');
      toast(`Focus time is up: ${b.title}`);
    }
  }
  if (changed) store.saveDay(day);
  return changed;
}

export function anyFocusRunning() {
  const day = store.getDay(todayKey());
  return !!(day && Object.values(day.focus || {}).some((f) => f && f.since));
}

// ---------- block detail sheet ----------

export function openBlockSheet(date, id) {
  openSheet(() => {
    const day = store.getDay(date);
    const b = findBlock(day, id);
    if (!b) return `${sheetHead('Block not found')}<p class="muted">It may have been removed by a patch.</p>`;
    const { s, e } = span(b);
    const isToday = date === todayKey();
    const btns = b._state
      ? `<button class="btn block" data-act="blk.clear" data-date="${date}" data-id="${esc(b.id)}">${icon('reset')}<span>Clear mark (${esc(STATE_LABELS[b._state])})</span></button>`
      : `<button class="btn block primary" data-act="blk.done" data-date="${date}" data-id="${esc(b.id)}">${icon('check')}<span>Done</span></button>
         <div class="grid2">
           <button class="btn" data-act="blk.skip" data-date="${date}" data-id="${esc(b.id)}">${icon('skip')}<span>Skip</span></button>
           <button class="btn" data-act="blk.moved" data-date="${date}" data-id="${esc(b.id)}">${icon('tomorrow')}<span>Move to tomorrow</span></button>
         </div>`;
    return `${sheetHead(b.title, `${b.start}–${b.end} · ${fmtMins(e - s)}${isToday ? '' : ' · ' + prettyDate(date)}`)}
      <div class="row gap wrap">${kindChip(b.kind)}${stateBadge(b, false)}<span class="muted small">id ${esc(b.id)}</span></div>
      ${blockExtras(day, b)}
      <div class="stack">${btns}</div>`;
  });
}

act('blk.open', (el) => openBlockSheet(el.dataset.date, el.dataset.id));

// ---------- quick capture ("Jot something down") ----------

export function openJot() {
  openSheet(
    () => `${sheetHead('Jot something down', 'Goes to your inbox and into tonight\'s report.')}
      <form class="jot" onsubmit="return false">
        <input id="jot-input" class="input" type="text" enterkeyhint="done" autocomplete="off" placeholder="e.g. ask Kumar about vocab quiz" data-input="jot.key">
        <button class="btn primary" data-act="jot.save">Save</button>
      </form>`,
    { focus: '#jot-input' },
  );
}

export function addInbox(text) {
  text = String(text || '').trim();
  if (!text) return false;
  const list = store.getInbox();
  list.push({ id: uid('i'), text, date: todayKey(), t: hhmm() });
  store.saveInbox(list);
  return true;
}

act('jot.open', () => openJot());
act('jot.save', () => {
  const el = document.getElementById('jot-input');
  if (!el) return;
  if (!addInbox(el.value)) {
    el.focus();
    return;
  }
  closeSheet();
  toast('Saved to inbox');
  App.render();
});
onInput('jot.key', (el, ev) => {
  if (ev.type === 'keydown' && ev.key === 'Enter') {
    ev.preventDefault();
    document.querySelector('[data-act="jot.save"]').click();
  }
});
act('noop', () => {});
