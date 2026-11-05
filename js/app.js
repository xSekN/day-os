// app.js: boots the app: tab routing, the 4x-a-second tick that keeps
// countdowns live, tap/input delegation, heads-up banners and the service worker.

import { App, actions, beep, closeSheet, esc, icon, inputs, act, setWakeLock, sheetOpen, toast, unlockAudio, beepLog } from './ui.js';
import * as store from './storage.js';
import { nowContext, span } from './planner.js';
import { fmtClock, fmtMins, hhmm, nowMinutes, prettyDate, todayKey, tsAt } from './util.js';
import * as now from './views/now.js';
import * as today from './views/today.js';
import * as trackerView from './views/tracker-view.js';
import * as workoutView from './views/workout-view.js';
import * as more from './views/more.js';
import { anyFocusRunning, checkFocusTimers, openJot } from './views/common.js';
import { openPaste } from './views/paste.js';
import * as W from './workout.js';

const VIEWS = { now, today, tracker: trackerView, workout: workoutView, more };
const TABS = [
  ['now', 'Now', 'now'],
  ['today', 'Today', 'today'],
  ['tracker', 'Tracker', 'tracker'],
  ['workout', 'Workout', 'workout'],
  ['more', 'More', 'more'],
];

const $ = (id) => document.getElementById(id);
const scrollMem = {};
let lastSig = '';
let lastDay = todayKey();
let headsUp = null; // { key, title, startTs }

// ---------- rendering ----------

// One nav element: a floating tab bar on phones, a sidebar on desktop (CSS).
function renderShell() {
  $('tabbar').innerHTML = `
    <div class="nav-brand desk-only"><img src="./icons/icon-192.png" alt="" width="40" height="40"><div><b>Day OS</b><span>plan · train · report</span></div></div>
    ${TABS.map(
      ([id, label, ic], i) => `<button class="tab" data-act="app.go" data-tab="${id}" aria-label="${label}">${icon(ic)}<span>${label}</span><kbd class="desk-only">${i + 1}</kbd></button>`,
    ).join('')}
    <div class="nav-foot desk-only">
      <div class="nav-clock tnum" data-clock>--:--</div>
      <div class="nav-date" data-today-label></div>
      <div class="nav-keys">
        <span><kbd>Ctrl/⌘ V</kbd> paste a code</span>
        <span><kbd>P</kbd> paste box · <kbd>N</kbd> jot</span>
        <span><kbd>1</kbd>–<kbd>5</kbd> tabs · <kbd>Esc</kbd> close</span>
        <span><kbd>Enter</kbd> log a set</span>
      </div>
    </div>`;
}

function renderHeader() {
  const v = VIEWS[App.tab];
  const t = v.title ? v.title() : { title: App.tab };
  $('hdr-title').textContent = t.title;
  $('hdr-sub').textContent = t.sub || '';
  document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('on', el.dataset.tab === App.tab));
}

function renderBanners() {
  const el = $('banners');
  let html = '';
  if (headsUp) {
    html += `<div class="banner headsup" role="status">${icon('bell')}<div class="grow"><b>Heads-up:</b> ${esc(headsUp.title)} starts at ${esc(headsUp.start)} (<span data-cd="mins" data-to="${headsUp.startTs}">${fmtMins(Math.ceil((headsUp.startTs - Date.now()) / 60000))}</span>)</div><button class="icon-btn" data-act="app.dismissHeadsUp" aria-label="Dismiss">${icon('x')}</button></div>`;
  }
  if (updateReady) {
    html += `<div class="banner info">${icon('reset')}<div class="grow">A new version is ready.</div><button class="btn sm primary" data-act="app.reload">Reload</button></div>`;
  }
  el.innerHTML = html;
}

function renderWorkoutBar() {
  const el = $('wobar');
  const s = store.getActiveWorkout();
  const show = s && (s.phase === 'warmup' || s.phase === 'active') && App.tab !== 'workout';
  document.body.classList.toggle('has-wobar', !!show);
  if (!show) {
    el.innerHTML = '';
    return;
  }
  const t = W.totals(s);
  let right = `${t.done}/${t.total} sets`;
  if (s.rest) right = `Rest <b data-cd="down" data-to="${s.rest.endsAt}">${fmtClock(s.rest.endsAt - Date.now())}</b>`;
  else if (s.hold) right = `Hold <b data-cd="down" data-to="${s.hold.endsAt}">${fmtClock(s.hold.endsAt - Date.now())}</b>`;
  el.innerHTML = `<button class="wobar-in" data-act="app.toWorkout">${icon('workout')}<span class="grow"><b>${esc(s.code.session)}</b></span><span>${right}</span>${icon('right')}</button>`;
}

function render(opts = {}) {
  const v = VIEWS[App.tab];
  const main = $('main');
  const y = opts.scrollTop ? 0 : window.scrollY;
  let html;
  try {
    html = v.render();
  } catch (e) {
    console.error(e);
    html = `<section class="card err"><b>Something went wrong showing this screen.</b><div>${esc(e.message)}</div><div class="muted small">Your data is safe. Try another tab or reload.</div></section>`;
  }
  main.innerHTML = html;
  main.dataset.tab = App.tab;
  if (opts.enter) {
    main.classList.remove('enter');
    void main.offsetWidth; // restart the animation
    main.classList.add('enter');
  }
  renderHeader();
  renderBanners();
  renderWorkoutBar();
  $('fab').hidden = !(App.tab === 'now' || App.tab === 'today');
  window.scrollTo(0, y);
  lastSig = signature();
  updateCountdowns();
}

function renderTimer() {
  const box = $('wo-timer');
  const s = store.getActiveWorkout();
  if (box && App.tab === 'workout') box.innerHTML = workoutView.renderTimer(s);
  renderWorkoutBar();
  updateCountdowns();
}

function go(tab, opts = {}) {
  if (!VIEWS[tab]) return;
  if (tab !== App.tab) scrollMem[App.tab] = window.scrollY;
  const same = tab === App.tab;
  App.tab = tab;
  store.setUi({ tab });
  if (tab === 'workout' && !same) workoutView.showSession();
  render({ scrollTop: opts.scrollTop || same, enter: !same });
  if (!opts.scrollTop && !same && scrollMem[tab]) window.scrollTo(0, scrollMem[tab]);
}

Object.assign(App, { render, go, renderTimer });

function signature() {
  const v = VIEWS[App.tab];
  return App.tab + ':' + (v.signature ? v.signature() : '');
}

// ---------- live countdowns ----------

function updateCountdowns() {
  const t = Date.now();
  const clock = hhmm(t);
  document.querySelectorAll('[data-clock]').forEach((el) => el.textContent !== clock && (el.textContent = clock));
  const date = prettyDate(todayKey());
  document.querySelectorAll('[data-today-label]').forEach((el) => el.textContent !== date && (el.textContent = date));
  document.querySelectorAll('[data-cd]').forEach((el) => {
    const kind = el.dataset.cd;
    const to = +el.dataset.to;
    const from = +el.dataset.from;
    let txt = null;
    if (kind === 'down') txt = fmtClock(to - t);
    else if (kind === 'up') txt = fmtClock(t - from, { up: true });
    else if (kind === 'mins') {
      const ms = to - t;
      txt = ms <= 60000 ? fmtClock(ms) : fmtMins(Math.ceil(ms / 60000));
    } else if (kind === 'bar') el.style.width = Math.max(0, Math.min(100, ((t - from) / (to - from)) * 100)) + '%';
    else if (kind === 'bar-left') el.style.width = Math.max(0, Math.min(100, ((to - t) / (to - from)) * 100)) + '%';
    else if (kind === 'ring') {
      const c = +el.dataset.c;
      const frac = Math.max(0, Math.min(1, (t - from) / (to - from)));
      el.setAttribute('stroke-dashoffset', String(c * (1 - frac)));
    }
    if (txt !== null && el.textContent !== txt) el.textContent = txt;
  });
}

// ---------- heads-up ----------

function checkHeadsUp() {
  const set = store.getSettings();
  const date = todayKey();
  const day = store.getDay(date);
  if (headsUp && Date.now() >= headsUp.startTs) {
    headsUp = null;
    renderBanners();
  }
  if (!set.headsUpMin || !day || !day.plan) return;
  const nm = nowMinutes();
  const ctx = nowContext(day, nm);
  for (const b of ctx.upcoming) {
    const { s } = span(b);
    const left = s - nm;
    if (left > set.headsUpMin) break;
    if (left <= 0) continue;
    const key = `${b.id}@${b.start}`;
    if (day.headsUp.includes(key)) continue;
    day.headsUp.push(key);
    store.saveDay(day);
    headsUp = { key, title: b.title, start: b.start, startTs: tsAt(date, s) };
    beep('headsup');
    renderBanners();
    updateCountdowns();
    break;
  }
}

// ---------- tick ----------

function inputFocused() {
  const a = document.activeElement;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
}

function tick() {
  const t = Date.now();
  // Date rolled over while the app was open.
  const d = todayKey();
  if (d !== lastDay) {
    lastDay = d;
    store.pruneDays(d);
    if (!inputFocused()) render();
  }
  const wo = workoutView.tick(t);
  if (wo === 'full' && App.tab === 'workout' && !inputFocused()) render();
  else if (wo) renderTimer();
  if (checkFocusTimers(t) && !inputFocused()) render();
  checkHeadsUp();
  setWakeLock(workoutView.wantsWakeLock() || anyFocusRunning());
  // Re-render when the current/next block changes (once a minute at most).
  if (App.tab !== 'workout' && !inputFocused() && signature() !== lastSig) render();
  updateCountdowns();
}

// ---------- event delegation ----------

function onTap(ev) {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  // Taps inside fields shouldn't trigger the row they sit in.
  const field = ev.target.closest('input, textarea, select, label, summary');
  if (field && !field.matches('[data-act]') && el.contains(field)) return;
  if (el.disabled) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  try {
    fn(el, ev);
  } catch (e) {
    console.error(e);
    toast('Something went wrong. Your data is safe.');
  }
}

function onField(ev) {
  if (ev.type === 'keydown' && ev.key !== 'Enter') return;
  if (!ev.target || !ev.target.closest) return;
  const el = ev.target.closest('[data-input]');
  if (!el) return;
  const fn = inputs[el.dataset.input];
  if (!fn) return;
  try {
    fn(el, ev);
  } catch (e) {
    console.error(e);
  }
}

// ---------- keyboard + clipboard (desktop) ----------

function onKey(ev) {
  if (ev.key === 'Escape') {
    if (sheetOpen()) {
      ev.preventDefault();
      closeSheet();
    }
    return;
  }
  if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.isComposing) return;
  if (inputFocused() || sheetOpen()) return;
  const n = '12345'.indexOf(ev.key);
  if (n >= 0 && ev.key.length === 1) {
    ev.preventDefault();
    go(TABS[n][0]);
  } else if (ev.key === 'p' || ev.key === 'P') {
    ev.preventDefault();
    openPaste();
  } else if (ev.key === 'n' || ev.key === 'N') {
    ev.preventDefault();
    openJot();
  }
}

// Pasting a code anywhere (Ctrl/Cmd+V outside a text field) opens the
// Paste code sheet with it already checked.
function onPaste(ev) {
  const t = ev.target;
  if (t && t.closest && t.closest('input, textarea, [contenteditable="true"]')) return;
  const text = ev.clipboardData ? ev.clipboardData.getData('text') : '';
  if (!text || !text.includes('{')) return;
  ev.preventDefault();
  openPaste(text);
}

act('app.go', (el) => {
  if (sheetOpen()) closeSheet(true);
  go(el.dataset.tab);
});
act('app.toWorkout', () => go('workout'));
act('app.dismissHeadsUp', () => {
  headsUp = null;
  renderBanners();
});
act('app.reload', () => location.reload());

// ---------- service worker ----------

let updateReady = false;
const bootAt = Date.now();

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker
    .register('./sw.js', { scope: './' })
    .then((reg) => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // first install, nothing to refresh
    const s = store.getActiveWorkout();
    const busy = sheetOpen() || inputFocused() || (s && (s.phase === 'active' || s.phase === 'warmup'));
    if (Date.now() - bootAt < 10000 && !busy) location.reload();
    else {
      updateReady = true;
      renderBanners();
    }
  });
}

// ---------- boot ----------

function boot() {
  store.onStorageError(() => toast('Storage is full. Copy a backup from More, then delete old workouts.', { ms: 6000 }));
  try {
    store.pruneDays(todayKey());
  } catch {
    /* ignore */
  }
  renderShell();
  const ui = store.getUi();
  App.tab = VIEWS[ui.tab] ? ui.tab : 'now';
  document.addEventListener('click', onTap);
  document.addEventListener('input', onField);
  document.addEventListener('change', onField);
  document.addEventListener('keydown', onField);
  document.addEventListener('toggle', onField, true);
  document.addEventListener('keydown', onKey);
  document.addEventListener('paste', onPaste);
  // iOS only plays audio that starts in a user gesture: unlock on first tap.
  const unlock = () => {
    unlockAudio();
    document.removeEventListener('touchend', unlock, true);
    document.removeEventListener('click', unlock, true);
  };
  document.addEventListener('touchend', unlock, true);
  document.addEventListener('click', unlock, true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
  });
  window.addEventListener('pageshow', () => tick());
  render({ scrollTop: true });
  if (App.tab === 'workout') requestAnimationFrame(() => {
    const el = document.querySelector('.set.cur');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  setInterval(tick, 250);
  registerSW();
  // Exposed for tests and debugging.
  window.DayOS = { store, App, beepLog };
}

boot();
