// views/workout-view.js: start screen, preview, warm-up, the live workout
// (supersets, rest timer, timed holds) and the finish screen.

import { App, act, beep, checkbox, confirmSheet, copyText, esc, icon, onInput, openSheet, sheetHead, toast, closeSheet } from '../ui.js';
import * as store from '../storage.js';
import * as W from '../workout.js';
import { parseCode } from '../codes.js';
import { exampleWorkout } from '../examples.js';
import { findBlock } from '../planner.js';
import { fmtClock, hhmm, prettyDate, todayKey } from '../util.js';

let home = false; // show the start screen even while a session exists
let editor = null; // { b, e, kind: 'note' | 'swap' }
let pasteText = '';
let pasteErrors = [];

const getS = () => store.getActiveWorkout();
const save = (s) => store.saveActiveWorkout(s);
const live = (s) => s && (s.phase === 'warmup' || s.phase === 'active');

export function title() {
  const s = getS();
  if (s && !home && s.phase !== 'preview') return { title: 'Workout', sub: s.code.session };
  return { title: 'Workout', sub: s && live(s) ? 'In progress' : '' };
}

export function showSession() {
  home = false;
}

// ---------- loading ----------

export function loadSession(code, source = null) {
  const s = W.newSession(code, { source });
  if (!s.code.session) s.code.session = 'Workout';
  save(s);
  home = false;
  editor = null;
  App.go('workout', { scrollTop: true });
}

// Start a workout (asks first if another one is in progress).
export function startWorkoutFrom(code, source) {
  const cur = getS();
  if (cur && source && cur.source && cur.source.date === source.date && cur.source.blockId === source.blockId && cur.phase !== 'finish') {
    home = false;
    App.go('workout');
    return;
  }
  if (live(cur)) {
    const t = W.totals(cur);
    confirmSheet({
      title: 'Replace the workout in progress?',
      body: `<p><b>${esc(cur.code.session)}</b>: ${t.done}/${t.total} sets logged. It will be discarded.</p>`,
      yes: 'Replace it',
      no: 'Keep it',
      danger: true,
      onYes: () => loadSession(code, source),
    });
    return;
  }
  loadSession(code, source);
}

function todayWorkoutBlock() {
  const day = store.getDay(todayKey());
  if (!day || !day.plan) return null;
  const list = day.plan.blocks.filter((b) => b.kind === 'workout' && b.workout);
  return list.find((b) => !b._state) || list[0] || null;
}

// ---------- start screen ----------

function homeScreen() {
  const s = getS();
  let html = '';
  if (s) {
    const t = W.totals(s);
    if (live(s)) {
      html += `<section class="card hero" style="--k:var(--k-workout)">
        <div class="muted small">In progress</div>
        <h2 class="hero-title">${esc(s.code.session)}</h2>
        <div class="muted">${t.done}/${t.total} sets · started ${hhmm(s.startedAt)}</div>
        <button class="btn primary block big" data-act="wo.show">${icon('play')}<span>Resume workout</span></button>
        <button class="btn block ghost danger" data-act="wo.discard">Discard workout</button>
      </section>`;
    } else if (s.phase === 'preview') {
      html += `<section class="card"><div class="muted small">Loaded</div><h2>${esc(s.code.session)}</h2>
        <div class="grid2"><button class="btn primary" data-act="wo.show">Open</button><button class="btn" data-act="wo.discard">Remove</button></div></section>`;
    } else if (s.phase === 'finish') {
      html += `<section class="card"><div class="muted small">Finished, not closed</div><h2>${esc(s.code.session)}</h2>
        <button class="btn primary block" data-act="wo.show">Open finish screen</button></section>`;
    }
  }
  const tb = todayWorkoutBlock();
  if (tb && !(s && s.source && s.source.blockId === tb.id && s.source.date === todayKey() && s.phase !== 'finish')) {
    html += `<button class="card start-today" data-act="blk.workout" data-date="${todayKey()}" data-id="${esc(tb.id)}" style="--k:var(--k-workout)">
      <span class="st-ic">${icon('workout')}</span>
      <span class="grow"><span class="muted small">${tb.start}–${tb.end}${tb._state ? ' · ' + tb._state : ''}</span><b>Start today's workout: ${esc(tb.workout.session || tb.title)}</b></span>${icon('right')}
    </button>`;
  }
  html += `<div class="wo-home"><div class="wo-home-l">`;
  html += `<section class="card">
    <h3 class="sec-title flush">Paste a workout code</h3>
    <textarea class="code-area" rows="4" placeholder='{"v":1,"type":"workout",...}' data-input="wo.pasteText" spellcheck="false" autocapitalize="off" autocorrect="off">${esc(pasteText)}</textarea>
    ${pasteErrors.length ? `<div class="err">${pasteErrors.map((e) => `<div>${esc(e)}</div>`).join('')}</div>` : ''}
    <div class="grid2"><button class="btn primary" data-act="wo.load">Load workout</button><button class="btn" data-act="wo.example">Load example</button></div>
  </section>`;
  html += `</div><div class="wo-home-r">`;
  const hist = store.getWorkoutHistory();
  html += `<h3 class="sec-title pad-x">History</h3>`;
  if (!hist.length) html += '<p class="muted pad-x">Finished workouts show up here.</p>';
  else
    html += `<div class="list">${hist
      .slice(0, 50)
      .map(
        (h) => `<button class="list-row" data-act="wo.hist" data-id="${esc(h.id)}">
        <span class="grow"><b>${esc(h.session)}</b><span class="muted small">${prettyDate(h.date)} · ${h.durationMin} min · ${h.done}/${h.total} sets${h.feel ? ` · feel ${h.feel}/5` : ''}</span></span>${icon('right')}</button>`,
      )
      .join('')}</div>`;
  html += `</div></div>`;
  return html;
}

// ---------- preview + warm-up ----------

function previewScreen(s) {
  const c = s.code;
  return `<section class="card">
      <div class="muted small">Workout preview</div>
      <h2 class="wo-name">${esc(c.session)}</h2>
      <div class="muted">${[c.week != null ? `Week ${esc(c.week)}` : '', c.date ? prettyDate(c.date) : ''].filter(Boolean).join(' · ')}</div>
      <div class="stats3">
        <div><b>${W.countExercises(c)}</b><span>exercises</span></div>
        <div><b>${W.countSets(c)}</b><span>total sets</span></div>
        <div><b>~${W.estimateMin(c)}</b><span>min</span></div>
      </div>
      ${c.notes ? `<div class="wo-notes">${esc(c.notes)}</div>` : ''}
    </section>
    ${c.warmup.length ? `<section class="card"><h3 class="sec-title flush">Warm-up</h3>${c.warmup.map((w) => `<div class="pv-line"><span>${esc(w.name)}</span><span class="muted">${esc(w.detail || '')}</span></div>`).join('')}</section>` : ''}
    <section class="card">${c.blocks
      .map(
        (blk) => `<div class="pv-block"><div class="pv-label">${esc(blk.label)}</div><div class="grow">
          <div class="muted small">${blk.exercises.length > 1 ? 'Superset' : 'Straight sets'} · rest ${blk.restSec}s</div>
          ${blk.exercises.map((ex, e) => `<div class="pv-ex"><b>${esc(W.exLabel(blk, e))}</b> ${esc(ex.name)}<div class="muted small">${esc(W.targetText(ex))}</div></div>`).join('')}
        </div></div>`,
      )
      .join('')}</section>
    <div class="stack pad">
      <button class="btn primary block big" data-act="wo.start">${icon('play')}<span>Start workout</span></button>
      <button class="btn block" data-act="wo.discard">Cancel</button>
    </div>`;
}

function topBar(s) {
  const t = W.totals(s);
  const pct = t.total ? (t.done / t.total) * 100 : 0;
  return `<div class="wo-top">
    <div class="row between">
      <button class="icon-btn" data-act="wo.home" aria-label="Workout menu">${icon('left')}</button>
      <div class="grow wo-top-mid"><div class="wo-sess">${esc(s.code.session)}</div>
        <div class="muted small"><span data-cd="up" data-from="${s.startedAt}">${fmtClock(Date.now() - s.startedAt, { up: true })}</span> · ${t.done}/${t.total} sets</div></div>
      ${s.phase === 'active' ? '<button class="btn sm" data-act="wo.finishAsk">Finish</button>' : ''}
    </div>
    <div class="bar thin"><i style="width:${pct}%"></i></div>
  </div>`;
}

function warmupScreen(s) {
  const c = s.code;
  return `${topBar(s)}<section class="card"><h2>Warm-up</h2>${c.warmup
    .map((w, i) => checkbox(!!s.warmup[i], `<b>${esc(w.name)}</b>${w.detail ? ` <span class="muted">${esc(w.detail)}</span>` : ''}`, 'wo.wu', `data-i="${i}"`))
    .join('')}</section>
    <div class="grid2 pad"><button class="btn" data-act="wo.wuDone">Skip</button><button class="btn primary" data-act="wo.wuDone">Done</button></div>`;
}

// ---------- live workout ----------

function bar(from, to) {
  const now = Date.now();
  const pct = Math.max(0, Math.min(100, ((to - now) / Math.max(1, to - from)) * 100));
  return `<div class="bar"><i data-cd="bar-left" data-from="${from}" data-to="${to}" style="width:${pct}%"></i></div>`;
}

export function renderTimer(s) {
  if (!s || s.phase !== 'active') return '';
  if (s.hold) {
    const h = s.hold;
    const blk = s.code.blocks[h.b];
    const ex = blk.exercises[h.e];
    const label = { hold: 'Hold', side1: 'Side 1 of 2', switch: 'Switch sides', side2: 'Side 2 of 2' }[h.phase];
    const btn = { hold: 'Stop & log', side1: 'Next side', switch: 'Start side 2', side2: 'Stop & log' }[h.phase];
    return `<div class="timer-panel hold ${h.phase === 'switch' ? 'switch' : ''}">
      <div class="tp-row"><span class="tp-label">${label}</span><span class="muted">${esc(W.exLabel(blk, h.e))} ${esc(s.ex[h.b][h.e].swap || ex.name)} · set ${h.r + 1}</span></div>
      <div class="tp-digits" data-cd="down" data-to="${h.endsAt}">${fmtClock(h.endsAt - Date.now())}</div>
      ${bar(h.startedAt, h.endsAt)}
      <div class="grid2"><button class="btn" data-act="wo.holdCancel">Cancel</button><button class="btn primary" data-act="wo.holdStop">${btn}</button></div>
    </div>`;
  }
  if (s.rest) {
    return `<div class="timer-panel rest">
      <div class="tp-row"><span class="tp-label">Rest</span></div>
      <div class="tp-digits" data-cd="down" data-to="${s.rest.endsAt}">${fmtClock(s.rest.endsAt - Date.now())}</div>
      ${bar(s.rest.startedAt, s.rest.endsAt)}
      <div class="tp-next">Next up: <b>${esc(W.setText(s, s.cur))}</b></div>
      <div class="grid3"><button class="btn" data-act="wo.rest" data-d="-15">-15s</button><button class="btn" data-act="wo.rest" data-d="15">+15s</button><button class="btn primary" data-act="wo.restSkip">Skip</button></div>
    </div>`;
  }
  if (!W.nextPending(s, null)) {
    return `<div class="timer-panel go"><div class="tp-row"><span class="tp-label">All sets logged</span></div>
      <button class="btn primary block big" data-act="wo.finish">${icon('check')}<span>Finish workout</span></button></div>`;
  }
  if (s.flash) {
    return `<div class="timer-panel go"><div class="tp-digits">GO</div><div class="tp-next"><b>${esc(W.setText(s, s.cur))}</b></div></div>`;
  }
  return '';
}

function setRow(s, b, e, r) {
  const blk = s.code.blocks[b];
  const ex = blk.exercises[e];
  const st = s.ex[b][e];
  const set = st.sets[r];
  const cur = s.cur.b === b && s.cur.e === e && s.cur.r === r;
  const d = `data-b="${b}" data-e="${e}" data-r="${r}"`;
  const cls = `set ${cur ? 'cur' : ''} ${set.done ? 'done' : ''}`;
  const check = `<button class="check ${set.done ? 'on' : ''}" data-act="wo.check" ${d} aria-label="${set.done ? 'Undo set' : 'Log set'} ${r + 1}">${icon('check')}</button>`;
  if (ex.type === 'time') {
    const holding = s.hold && s.hold.b === b && s.hold.e === e && s.hold.r === r;
    return `<div class="${cls} time" data-act="wo.jump" ${d}>
      <span class="set-n">${r + 1}</span>
      <label class="fld"><input class="num" type="text" inputmode="numeric" pattern="[0-9]*" value="${esc(set.r)}" placeholder="${esc(W.repTop(ex.reps) || 'sec')}" data-input="wo.val" data-f="r" ${d} aria-label="Seconds set ${r + 1}"><span>sec</span></label>
      <button class="btn hold-btn ${holding ? 'on' : ''}" data-act="wo.hold" ${d} ${set.done || holding ? 'disabled' : ''}>${icon('play')}<span>${holding ? 'Holding' : 'Start'}</span></button>
      ${check}
    </div>`;
  }
  let ph = '?';
  if (ex.type === 'bodyweight') ph = 'BW';
  else if (typeof ex.weight === 'string' && ex.weight && !st.swap) ph = '-';
  return `<div class="${cls}" data-act="wo.jump" ${d}>
    <span class="set-n">${r + 1}</span>
    <label class="fld"><input class="num" type="text" inputmode="decimal" value="${esc(set.w)}" placeholder="${ph}" data-input="wo.val" data-f="w" ${d} aria-label="Weight set ${r + 1}"><span>${esc(ex.unit)}</span></label>
    <span class="x">×</span>
    <label class="fld"><input class="num" type="text" inputmode="numeric" pattern="[0-9]*" value="${esc(set.r)}" placeholder="${esc(W.repTop(ex.reps) || 'reps')}" data-input="wo.val" data-f="r" ${d} aria-label="Reps set ${r + 1}"><span>reps</span></label>
    ${check}
  </div>`;
}

function exSection(s, b, e) {
  const blk = s.code.blocks[b];
  const ex = blk.exercises[e];
  const st = s.ex[b][e];
  const d = `data-b="${b}" data-e="${e}"`;
  const isCur = s.cur.b === b && s.cur.e === e;
  const last = ex.last || W.lastFromHistory(store.getWorkoutHistory(), ex.id, s.id);
  const ed = editor && editor.b === b && editor.e === e ? editor.kind : null;
  let editorHtml = '';
  if (ed === 'note') {
    editorHtml = `<div class="ex-editor"><textarea class="input" id="ex-note" rows="2" placeholder="Note for this exercise">${esc(st.note)}</textarea>
      <div class="grid2"><button class="btn" data-act="wo.edCancel">Cancel</button><button class="btn primary" data-act="wo.noteSave" ${d}>Save note</button></div></div>`;
  } else if (ed === 'swap') {
    editorHtml = `<div class="ex-editor"><label class="muted small" for="ex-swap">Replacement exercise</label><input class="input" id="ex-swap" type="text" autocomplete="off" placeholder="e.g. Rear delt flyes" value="${esc(st.swap || '')}">
      <div class="grid2"><button class="btn" data-act="wo.edCancel">Cancel</button><button class="btn primary" data-act="wo.swapSave" ${d}>Swap</button></div>
      ${st.swap ? `<button class="btn block ghost" data-act="wo.swapUndo" ${d}>Undo swap (back to ${esc(ex.name)})</button>` : ''}</div>`;
  }
  return `<div class="ex ${isCur ? 'cur' : ''} ${st.skipped ? 'skipped' : ''}" id="ex-${b}-${e}">
    <div class="ex-head"><span class="ex-label">${esc(W.exLabel(blk, e))}</span>
      <div class="grow"><div class="ex-name">${esc(st.swap || ex.name)}</div>${st.swap ? `<div class="muted small">swapped from ${esc(ex.name)}</div>` : ''}
      <div class="ex-target">${esc(W.targetText(ex))}</div></div></div>
    ${ex.tempo ? `<div class="ex-line"><span class="muted">Tempo</span><b>${esc(ex.tempo)}</b></div>` : ''}
    ${last && !st.swap ? `<div class="ex-line"><span class="muted">Last time</span><span>${esc(last)}</span></div>` : ''}
    ${ex.cues.length ? `<details class="cues"><summary>Cues ${icon('down')}</summary><ul>${ex.cues.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></details>` : ''}
    ${W.needsWeight(ex) || (st.swap && ex.type === 'reps') ? `<div class="find">${icon('flame', 'sm')}<span><b>Find your weight.</b> Enter what you use; later sets copy it.</span></div>` : ''}
    ${st.skipped ? `<div class="skipped-note"><span>Skipped</span><button class="btn sm" data-act="wo.unskip" ${d}>Undo</button></div>` : `<div class="sets">${st.sets.map((_, r) => setRow(s, b, e, r)).join('')}</div>`}
    <div class="tags">${W.TAGS.map((t) => `<button class="tag ${st.tags.includes(t) ? 'on' : ''} ${t === 'Pain' ? 'pain' : ''}" data-act="wo.tag" data-t="${t}" ${d}>${t}</button>`).join('')}</div>
    ${st.note && ed !== 'note' ? `<div class="ex-note">${icon('note', 'sm')}<span>${esc(st.note)}</span></div>` : ''}
    <div class="grid3 tools">
      <button class="btn sm ${ed === 'note' ? 'on' : ''}" data-act="wo.ed" data-k="note" ${d}>${icon('note')}<span>Note</span></button>
      <button class="btn sm" data-act="${st.skipped ? 'wo.unskip' : 'wo.skip'}" ${d}>${icon('skip')}<span>${st.skipped ? 'Unskip' : 'Skip'}</span></button>
      <button class="btn sm ${ed === 'swap' ? 'on' : ''}" data-act="wo.ed" data-k="swap" ${d}>${icon('swap')}<span>Swap</span></button>
    </div>
    ${editorHtml}
  </div>`;
}

function blockDone(s, b) {
  return s.ex[b].every((st) => st.skipped || st.sets.every((x) => x.done));
}

function activeScreen(s) {
  const b = s.viewB != null ? s.viewB : s.cur.b;
  const blk = s.code.blocks[b];
  const chips = `<div class="chips">${s.code.blocks
    .map((x, i) => `<button class="chip ${i === b ? 'on' : ''} ${blockDone(s, i) ? 'done' : ''}" data-act="wo.block" data-b="${i}">${esc(x.label)}${blockDone(s, i) ? icon('check', 'sm') : ''}</button>`)
    .join('')}</div>`;
  const nav = `<div class="grid2 pad">
    <button class="btn" data-act="wo.block" data-b="${b - 1}" ${b === 0 ? 'disabled' : ''}>${icon('left')}<span>Prev block</span></button>
    <button class="btn" data-act="wo.block" data-b="${b + 1}" ${b === s.code.blocks.length - 1 ? 'disabled' : ''}><span>Next block</span>${icon('right')}</button>
  </div>`;
  return `${topBar(s)}<div id="wo-timer" class="wo-timer">${renderTimer(s)}</div>${chips}
    <section class="card wo-block">
      <div class="row between"><h3 class="flush">${esc(blk.label)} · ${blk.exercises.length > 1 ? (blk.exercises.length === 2 ? 'Superset' : 'Circuit') : 'Straight sets'}</h3><span class="muted small">rest ${blk.restSec}s</span></div>
      <div class="ex-list n${blk.exercises.length}">${blk.exercises.map((_, e) => exSection(s, b, e)).join('')}</div>
    </section>
    ${nav}
    ${s.code.notes ? `<div class="wo-notes pad-x">${esc(s.code.notes)}</div>` : ''}`;
}

// ---------- finish ----------

function finishScreen(s) {
  const t = W.totals(s);
  const skipped = [];
  s.code.blocks.forEach((blk, b) => blk.exercises.forEach((ex, e) => s.ex[b][e].skipped && skipped.push(`${W.exLabel(blk, e)} ${ex.name}`)));
  return `<section class="card">
      <div class="muted small">${prettyDate(s.date)}</div>
      <h2 class="wo-name">${esc(s.code.session)} done</h2>
      <div class="stats3">
        <div><b>${W.durationMin(s)}</b><span>min</span></div>
        <div><b>${t.done}/${t.total}</b><span>sets</span></div>
        <div><b>${skipped.length}</b><span>skipped</span></div>
      </div>
      ${skipped.length ? `<div class="muted small">Skipped: ${skipped.map(esc).join(', ')}</div>` : ''}
    </section>
    <section class="card">
      <h3 class="sec-title flush">How did it feel?</h3>
      <div class="rate">${[1, 2, 3, 4, 5].map((v) => `<button class="rate-btn ${s.feel === v ? 'on' : ''}" data-act="wo.feel" data-v="${v}">${v}</button>`).join('')}</div>
      <div class="rate-legend muted small"><span>rough</span><span>great</span></div>
      <label class="lbl" for="wo-bw">Bodyweight (lb, optional)</label>
      <input class="input" id="wo-bw" type="text" inputmode="decimal" value="${esc(s.bw)}" placeholder="e.g. 152" data-input="wo.bw">
      <label class="lbl" for="wo-note">Note (optional)</label>
      <textarea class="input" id="wo-note" rows="2" placeholder="How was it?" data-input="wo.note">${esc(s.note)}</textarea>
    </section>
    <section class="card">
      <h3 class="sec-title flush">Workout log</h3>
      <pre class="log" id="wo-log">${esc(W.buildLiftLog(s))}</pre>
      <button class="btn primary block big" data-act="wo.copyLog">${icon('copy')}<span>Copy log</span></button>
    </section>
    <div class="stack pad">
      <button class="btn block" data-act="wo.close">${icon('check')}<span>Done</span></button>
      <button class="btn block ghost" data-act="wo.reopen">Back to workout</button>
    </div>`;
}

function saveHistory(s) {
  store.upsertWorkout(W.historyEntry(s));
}

export function render() {
  const s = getS();
  if (!s || home) return homeScreen();
  if (s.phase === 'preview') return previewScreen(s);
  if (s.phase === 'warmup') return warmupScreen(s);
  if (s.phase === 'active') return activeScreen(s);
  if (s.phase === 'finish') return finishScreen(s);
  return homeScreen();
}

export function isLiveView() {
  const s = getS();
  return !!s && !home && s.phase === 'active';
}

export function wantsWakeLock() {
  const s = getS();
  return live(s);
}

function timerIsSticky() {
  const el = document.getElementById('wo-timer');
  return !!el && getComputedStyle(el).position === 'sticky';
}

// After logging a set: show the rest timer if it can't stay pinned, else the next set.
function afterLog(res) {
  if (res && res.rest && !timerIsSticky()) window.scrollTo({ top: 0, behavior: 'smooth' });
  else scrollToCur();
}

function scrollToCur() {
  requestAnimationFrame(() => {
    const el = document.querySelector('.set.cur');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

const nums = (el) => ({ b: +el.dataset.b, e: +el.dataset.e, r: +el.dataset.r });

// ---------- actions ----------

act('wo.show', () => {
  home = false;
  App.render({ scrollTop: true });
  scrollToCur();
});
act('wo.home', () => {
  home = true;
  App.render({ scrollTop: true });
});

act('wo.discard', () => {
  const s = getS();
  if (!s) return;
  const doIt = () => {
    save(null);
    home = false;
    App.render({ scrollTop: true });
    toast('Workout removed');
  };
  if (s.phase === 'preview') return doIt();
  const t = W.totals(s);
  confirmSheet({ title: 'Discard this workout?', body: `<p>${esc(s.code.session)}: ${t.done}/${t.total} sets logged. This can't be undone.</p>`, yes: 'Discard', no: 'Keep it', danger: true, onYes: doIt });
});

act('wo.start', () => {
  const s = getS();
  if (!s) return;
  W.startSession(s);
  save(s);
  App.render({ scrollTop: true });
});

act('wo.wu', (el) => {
  const s = getS();
  const i = +el.dataset.i;
  s.warmup[i] = !s.warmup[i];
  save(s);
  App.render();
});

act('wo.wuDone', () => {
  const s = getS();
  W.endWarmup(s);
  save(s);
  App.render({ scrollTop: true });
});

act('wo.jump', (el) => {
  const s = getS();
  const { b, e, r } = nums(el);
  if (s.cur.b === b && s.cur.e === e && s.cur.r === r) return;
  W.jumpTo(s, b, e, r);
  save(s);
  App.render();
});

act('wo.block', (el) => {
  const s = getS();
  const b = +el.dataset.b;
  if (!s.code.blocks[b]) return;
  W.viewBlock(s, b);
  editor = null;
  save(s);
  App.render();
  scrollToCur();
});

onInput('wo.val', (el, ev) => {
  const s = getS();
  if (!s) return;
  const { b, e, r } = nums(el);
  W.setValue(s, b, e, r, el.dataset.f, el.value);
  const row = el.closest('.set');
  if (row) row.classList.remove('need');
  save(s);
  // Enter logs the set (keyboard on desktop, "Go" on some phone keyboards).
  if (ev.type === 'keydown' && ev.key === 'Enter') {
    ev.preventDefault();
    const btn = row && row.querySelector('[data-act="wo.check"]');
    if (btn && !btn.classList.contains('on')) {
      el.blur();
      btn.click();
    }
  }
});

act('wo.check', (el) => {
  const s = getS();
  const { b, e, r } = nums(el);
  const set = s.ex[b][e].sets[r];
  if (!set) return;
  if (set.done) {
    W.unlogSet(s, b, e, r);
    save(s);
    App.render();
    return;
  }
  // Pick up values straight from the inputs (covers autofill without input events).
  const row = el.closest('.set');
  if (row) row.querySelectorAll('input[data-f]').forEach((inp) => W.setValue(s, b, e, r, inp.dataset.f, inp.value));
  const miss = W.missingInput(s, b, e, r);
  if (miss) {
    if (row) {
      row.classList.add('need');
      const inp = row.querySelector(`input[data-f="${miss}"]`);
      if (inp) inp.focus();
    }
    toast(miss === 'w' ? 'Enter the weight you used' : s.code.blocks[b].exercises[e].type === 'time' ? 'Enter the seconds held' : 'Enter your reps');
    save(s);
    return;
  }
  const res = W.logSet(s, b, e, r);
  save(s);
  App.render();
  if (res.allDone) toast('All sets logged. Tap Finish workout.');
  afterLog(res);
});

act('wo.rest', (el) => {
  const s = getS();
  W.adjustRest(s, +el.dataset.d * 1000);
  save(s);
  App.renderTimer();
});

act('wo.restSkip', () => {
  const s = getS();
  W.skipRest(s);
  save(s);
  App.renderTimer();
});

act('wo.hold', (el) => {
  const s = getS();
  const { b, e, r } = nums(el);
  const row = el.closest('.set');
  const inp = row && row.querySelector('input[data-f="r"]');
  if (inp && inp.value) W.setValue(s, b, e, r, 'r', inp.value);
  W.startHold(s, b, e, r);
  save(s);
  beep('one');
  App.render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

act('wo.holdStop', () => {
  const s = getS();
  const ev = W.stopHold(s);
  save(s);
  if (ev && ev.type === 'holdDone') {
    App.render();
    scrollToCur();
  } else App.renderTimer();
});

act('wo.holdCancel', () => {
  const s = getS();
  W.cancelHold(s);
  save(s);
  App.render();
});

act('wo.tag', (el) => {
  const s = getS();
  W.toggleTag(s, +el.dataset.b, +el.dataset.e, el.dataset.t);
  save(s);
  App.render();
});

act('wo.skip', (el) => {
  const s = getS();
  W.skipExercise(s, +el.dataset.b, +el.dataset.e, true);
  save(s);
  App.render();
});

act('wo.unskip', (el) => {
  const s = getS();
  W.skipExercise(s, +el.dataset.b, +el.dataset.e, false);
  save(s);
  App.render();
});

act('wo.ed', (el) => {
  const b = +el.dataset.b;
  const e = +el.dataset.e;
  const k = el.dataset.k;
  editor = editor && editor.b === b && editor.e === e && editor.kind === k ? null : { b, e, kind: k };
  App.render();
  const f = document.getElementById(k === 'note' ? 'ex-note' : 'ex-swap');
  if (f) f.focus();
});

act('wo.edCancel', () => {
  editor = null;
  App.render();
});

act('wo.noteSave', (el) => {
  const s = getS();
  const ta = document.getElementById('ex-note');
  s.ex[+el.dataset.b][+el.dataset.e].note = ta ? ta.value.trim() : '';
  editor = null;
  save(s);
  App.render();
});

act('wo.swapSave', (el) => {
  const s = getS();
  const inp = document.getElementById('ex-swap');
  const name = inp ? inp.value.trim() : '';
  if (!name) {
    if (inp) inp.focus();
    toast('Type the replacement exercise');
    return;
  }
  W.swapExercise(s, +el.dataset.b, +el.dataset.e, name);
  editor = null;
  save(s);
  App.render();
  toast(`Swapped to ${name}`);
});

act('wo.swapUndo', (el) => {
  const s = getS();
  W.swapExercise(s, +el.dataset.b, +el.dataset.e, null);
  editor = null;
  save(s);
  App.render();
});

act('wo.finishAsk', () => {
  const s = getS();
  const t = W.totals(s);
  const left = t.total - t.done;
  if (!left) return finish();
  confirmSheet({ title: 'Finish the workout now?', body: `<p>${left} set${left === 1 ? '' : 's'} not logged. They'll show as "-" in the log.</p>`, yes: 'Finish workout', no: 'Keep going', onYes: finish });
});

function finish() {
  const s = getS();
  W.finishSession(s);
  save(s);
  saveHistory(s);
  if (s.source) {
    const day = store.getDay(s.source.date);
    const b = findBlock(day, s.source.blockId);
    if (b && !b._state) {
      b._state = 'done';
      store.saveDay(day);
    }
  }
  editor = null;
  App.render({ scrollTop: true });
  beep('done');
}
act('wo.finish', finish);

act('wo.feel', (el) => {
  const s = getS();
  const v = +el.dataset.v;
  s.feel = s.feel === v ? null : v;
  save(s);
  saveHistory(s);
  App.render();
});

function updateFinishText(s) {
  save(s);
  saveHistory(s);
  const pre = document.getElementById('wo-log');
  if (pre) pre.textContent = W.buildLiftLog(s);
}

onInput('wo.bw', (el) => {
  const s = getS();
  s.bw = el.value.trim();
  updateFinishText(s);
});

onInput('wo.note', (el) => {
  const s = getS();
  s.note = el.value;
  updateFinishText(s);
});

act('wo.copyLog', (el) => {
  const s = getS();
  copyText(W.buildLiftLog(s), el);
});

act('wo.close', () => {
  const s = getS();
  if (s) saveHistory(s);
  save(null);
  home = false;
  App.render({ scrollTop: true });
});

act('wo.reopen', () => {
  const s = getS();
  s.phase = 'active';
  s.finishedAt = null;
  save(s);
  App.render({ scrollTop: true });
});

onInput('wo.pasteText', (el) => {
  pasteText = el.value;
});

act('wo.load', () => {
  const ta = document.querySelector('[data-input="wo.pasteText"]');
  if (ta) pasteText = ta.value;
  const r = parseCode(pasteText);
  if (!r.ok) {
    pasteErrors = r.errors;
    App.render();
    return;
  }
  if (r.type !== 'workout') {
    pasteErrors = [`That's a ${r.type} code. Use the Paste code button (top right) for day, patch and tracker codes.`];
    App.render();
    return;
  }
  pasteErrors = [];
  pasteText = '';
  startWorkoutFrom(r.value, null);
});

act('wo.example', () => {
  pasteErrors = [];
  startWorkoutFrom(W.validateWorkout(exampleWorkout()).value, null);
});

act('wo.hist', (el) => {
  const id = el.dataset.id;
  let confirmDel = false;
  act('wo.histCopy', (b) => {
    const h = store.getWorkoutHistory().find((x) => x.id === id);
    if (h) copyText(h.log, b);
  });
  act('wo.histDel', () => {
    if (!confirmDel) {
      confirmDel = true;
      const btn = document.querySelector('[data-act="wo.histDel"]');
      if (btn) btn.innerHTML = `${icon('trash')}<span>Tap again to delete</span>`;
      return;
    }
    store.saveWorkoutHistory(store.getWorkoutHistory().filter((x) => x.id !== id));
    closeSheet();
    App.render();
    toast('Workout deleted');
  });
  openSheet(() => {
    const h = store.getWorkoutHistory().find((x) => x.id === id);
    if (!h) return sheetHead('Not found');
    return `${sheetHead(h.session, `${prettyDate(h.date)} · ${h.durationMin} min · ${h.done}/${h.total} sets`)}
      <pre class="log">${esc(h.log)}</pre>
      <button class="btn primary block big" data-act="wo.histCopy">${icon('copy')}<span>Copy log</span></button>
      <button class="btn block ghost danger" data-act="wo.histDel">${icon('trash')}<span>Delete</span></button>`;
  });
});

// Tick: advance rest/hold timers; returns what changed so app.js can redraw.
export function tick(now = Date.now()) {
  const s = getS();
  if (!s || s.phase !== 'active' || !(s.rest || s.hold || s.flash)) return null;
  const hadFlash = !!s.flash;
  const events = W.tickTimers(s, now);
  if (!events.length) {
    if (hadFlash && !s.flash) {
      save(s);
      return 'timer'; // the "GO" banner just expired
    }
    return null;
  }
  save(s);
  for (const ev of events) {
    if (ev.late > 3000) continue;
    if (ev.type === 'restDone') beep('rest');
    else if (ev.type === 'holdSide' || ev.type === 'holdGo') beep('one');
    else if (ev.type === 'holdDone') beep(ev.rest ? 'one' : 'done');
  }
  return events.some((e) => e.type === 'holdDone') ? 'full' : 'timer';
}
