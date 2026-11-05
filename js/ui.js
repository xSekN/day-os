// ui.js: shared UI plumbing: the app object, action dispatch, icons,
// bottom sheets, toasts, copy-to-clipboard, beeps and the screen wake lock.

import { esc } from './util.js';
import { getSettings } from './storage.js';

export { esc };

// Filled in by app.js (render, go, ...). Views call App.render() after changes.
export const App = {
  tab: 'now',
  render() {},
  go() {},
};

// ---------- actions ----------
// Elements with data-act="name" call actions[name](el, event) on tap.
// Inputs with data-input="name" call inputs[name](el, event) on input/change.

export const actions = Object.create(null);
export const inputs = Object.create(null);
export const act = (name, fn) => (actions[name] = fn);
export const onInput = (name, fn) => (inputs[name] = fn);

// ---------- icons (inline SVG, 24x24 stroke icons) ----------

const P = {
  now: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  today: '<rect x="4" y="4" width="16" height="17" rx="2.5"/><path d="M4 9h16M9 2.5v3M15 2.5v3M8 13h3M8 17h6"/>',
  tracker: '<path d="M5 21V4M5 4h11l-2.5 4L16 12H5"/>',
  workout: '<path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
  paste: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4V3h6v1M9 4h6v2.5H9z"/><path d="M9 12h6M9 16h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  skip: '<path d="M6 6l7 6-7 6zM16 6v12"/>',
  tomorrow: '<path d="M4 12h13M13 6l6 6-6 6"/>',
  late: '<circle cx="11" cy="13" r="7.5"/><path d="M11 9.5V13l2.5 1.5M17.5 3.5l3 3"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4.5h4.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  share: '<path d="M12 15V3M7.5 7.5L12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/>',
  note: '<path d="M5 4h10l4 4v12H5z"/><path d="M14 4v5h5M8 13h8M8 17h5"/>',
  swap: '<path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  flame: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.3 2.4-5.4 3.8-8.3.5 1.8 1.6 3 2.7 3.5.2-2.6 1.4-4.9 3.4-6.5-.3 2.6.6 4.4 1.9 6 1.3 1.6 1.7 3 1.7 5.1 0 3.7-3 6.4-7 6.4z"/>',
  // kinds
  k_routine: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  k_school: '<path d="M2.5 9L12 4.5 21.5 9 12 13.5z"/><path d="M6.5 11v4.5c1.5 1.5 3.5 2.2 5.5 2.2s4-.7 5.5-2.2V11M21.5 9v5"/>',
  k_focus: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  k_workout: '<path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11"/>',
  k_meal: '<path d="M7 3v7.5M4.5 3v4.5a2.5 2.5 0 0 0 5 0V3M7 10.5V21M17 21V3c-2.2 1.5-3 4-3 6.5V13h3"/>',
  k_break: '<path d="M4 9.5h12v4a5.5 5.5 0 0 1-5.5 5.5h-1A5.5 5.5 0 0 1 4 13.5z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H15.5M8 3.5v2.5M12 3.5v2.5"/>',
  k_chore: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M8 12.5l2.8 2.8L16.5 9"/>',
  k_appointment: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="12" cy="15" r="1.4" fill="currentColor"/>',
  k_free: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  k_sleep: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
};

export function icon(name, cls = '') {
  const body = P[name] || '';
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

export const kindIcon = (kind) => icon('k_' + kind);

// ---------- bottom sheet ----------

let sheet = null; // { render, onClose, el }

function rootEl() {
  return document.getElementById('sheet-root');
}

function fitViewport() {
  const wrap = rootEl() && rootEl().firstElementChild;
  const vv = window.visualViewport;
  if (!wrap || !vv) return;
  wrap.style.height = vv.height + 'px';
  wrap.style.top = vv.offsetTop + 'px';
}

if (typeof window !== 'undefined' && window.visualViewport) {
  window.visualViewport.addEventListener('resize', fitViewport);
  window.visualViewport.addEventListener('scroll', fitViewport);
}

// render() returns the sheet's inner HTML. Call refreshSheet() after changes.
export function openSheet(render, { onClose, cls = '', focus } = {}) {
  closeSheet(true);
  sheet = { render, onClose, cls };
  const root = rootEl();
  root.innerHTML = `<div class="sheet-wrap" data-act="sheet.backdrop"><div class="sheet ${cls}" role="dialog" aria-modal="true"><div class="sheet-grab"></div><div class="sheet-body"></div></div></div>`;
  sheet.el = root.querySelector('.sheet-body');
  sheet.el.innerHTML = render();
  document.body.classList.add('sheet-open');
  fitViewport();
  if (focus) {
    const f = root.querySelector(focus);
    if (f) f.focus();
  }
}

export function refreshSheet() {
  if (!sheet) return;
  const sc = sheet.el.parentElement.scrollTop;
  sheet.el.innerHTML = sheet.render();
  sheet.el.parentElement.scrollTop = sc;
}

export function closeSheet(silent = false) {
  if (!sheet) return;
  const s = sheet;
  sheet = null;
  rootEl().innerHTML = '';
  document.body.classList.remove('sheet-open');
  if (!silent && s.onClose) s.onClose();
}

export const sheetOpen = () => !!sheet;

act('sheet.close', () => closeSheet());
act('sheet.backdrop', (el, ev) => {
  if (ev.target === el) closeSheet();
});

export function sheetHead(title, sub = '') {
  return `<div class="sheet-head"><div><h2>${esc(title)}</h2>${sub ? `<div class="muted small">${sub}</div>` : ''}</div><button class="icon-btn" data-act="sheet.close" aria-label="Close">${icon('x')}</button></div>`;
}

// In-page confirmation (never confirm()).
export function confirmSheet({ title, body = '', yes = 'Yes', no = 'Cancel', danger = false, onYes, onNo }) {
  const id = 'c' + Math.random().toString(36).slice(2, 7);
  act(`confirm.${id}.yes`, () => {
    closeSheet(true);
    onYes && onYes();
  });
  act(`confirm.${id}.no`, () => {
    closeSheet(true);
    onNo && onNo();
  });
  openSheet(
    () => `${sheetHead(title)}${body ? `<div class="confirm-body">${body}</div>` : ''}
      <div class="stack">
        <button class="btn block ${danger ? 'danger-fill' : 'primary'}" data-act="confirm.${id}.yes">${esc(yes)}</button>
        <button class="btn block" data-act="confirm.${id}.no">${esc(no)}</button>
      </div>`,
    { onClose: onNo },
  );
}

// ---------- toast ----------

let toastTimer = null;
let toastAction = null;

export function toast(msg, { action, ms = 2600 } = {}) {
  const el = document.getElementById('toast');
  if (!el) return;
  toastAction = action || null;
  el.innerHTML = `<div class="toast-in"><span>${esc(msg)}</span>${action ? `<button class="toast-btn" data-act="toast.action">${esc(action.label)}</button>` : ''}</div>`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? Math.max(ms, 5000) : ms);
}

act('toast.action', () => {
  const a = toastAction;
  toastAction = null;
  document.getElementById('toast').classList.remove('show');
  if (a) a.fn();
});

// ---------- copy ----------

function flashButton(btn) {
  if (!btn) return;
  const old = btn.dataset.label || btn.innerHTML;
  btn.dataset.label = old;
  btn.classList.add('copied');
  btn.innerHTML = `${icon('check')}<span>Copied!</span>`;
  setTimeout(() => {
    btn.classList.remove('copied');
    btn.innerHTML = btn.dataset.label;
    delete btn.dataset.label;
  }, 1800);
}

function execCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

// Copy with navigator.clipboard, then execCommand, then a sheet with the text
// selected for a manual copy. Resolves true when it was copied for sure.
export async function copyText(text, btn, { onCopied } = {}) {
  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch {
    ok = false;
  }
  if (!ok) ok = execCopy(text);
  if (ok) {
    flashButton(btn);
    toast('Copied!');
    onCopied && onCopied();
    return true;
  }
  manualCopy(text, onCopied);
  return false;
}

function manualCopy(text, onCopied) {
  act('copy.manualDone', () => {
    closeSheet();
    onCopied && onCopied();
  });
  openSheet(
    () => `${sheetHead('Copy this text', 'Automatic copy was blocked. The text is selected: tap it, then Copy.')}
      <textarea class="code-area manual-copy" readonly>${esc(text)}</textarea>
      <button class="btn block primary" data-act="copy.manualDone">Done</button>`,
  );
  const ta = document.querySelector('.manual-copy');
  if (ta) {
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
  }
}

// ---------- sound ----------
// iOS has no vibration, so beeps use Web Audio. Audio is unlocked on the
// first tap (iOS only allows audio that starts inside a user gesture).

let ctx = null;

export function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state !== 'running') ctx.resume();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    /* no audio, that's fine */
  }
}

function tone(freq, start, dur, vol) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g);
  g.connect(ctx.destination);
  o.start(start);
  o.stop(start + dur + 0.05);
}

const PATTERNS = {
  // gentle two-note chime for heads-up
  headsup: { tones: [[660, 0, 0.35, 0.18], [880, 0.22, 0.45, 0.16]], vib: [120, 80, 120] },
  // 3 beeps at the end of rest
  rest: { tones: [[880, 0, 0.16, 0.5], [880, 0.3, 0.16, 0.5], [1320, 0.6, 0.35, 0.55]], vib: [200, 100, 200, 100, 300] },
  // single beep (switch sides, hold start)
  one: { tones: [[1046, 0, 0.2, 0.45]], vib: [150] },
  done: { tones: [[784, 0, 0.2, 0.4], [988, 0.18, 0.2, 0.4], [1318, 0.36, 0.4, 0.45]], vib: [200, 80, 200] },
};

export const beepLog = []; // for tests

export function beep(kind = 'one') {
  const s = getSettings();
  beepLog.push({ kind, at: Date.now(), sound: s.sound });
  if (!s.sound) return;
  const p = PATTERNS[kind] || PATTERNS.one;
  try {
    if (navigator.vibrate) navigator.vibrate(p.vib);
  } catch {
    /* ignore */
  }
  try {
    if (!ctx) unlockAudio();
    if (!ctx) return;
    if (ctx.state !== 'running') ctx.resume();
    const t0 = ctx.currentTime + 0.03;
    for (const [f, at, d, v] of p.tones) tone(f, t0 + at, d, v);
  } catch {
    /* ignore */
  }
}

// ---------- screen wake lock ----------

let wantWake = false;
let sentinel = null;
let pending = false;

async function acquireWake() {
  if (pending || sentinel || !wantWake) return;
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
  if (document.visibilityState !== 'visible') return;
  pending = true;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
    if (!wantWake) {
      sentinel.release().catch(() => {});
      sentinel = null;
    }
  } catch {
    sentinel = null; // unsupported or denied: fail quietly
  }
  pending = false;
}

export function setWakeLock(on) {
  wantWake = !!on;
  if (wantWake) acquireWake();
  else if (sentinel) {
    sentinel.release().catch(() => {});
    sentinel = null;
  }
}

export const wakeLockHeld = () => !!sentinel;

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (wantWake) acquireWake();
      if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
    }
  });
}

// ---------- small render helpers ----------

export function checkbox(on, label, act, data = '', extra = '') {
  return `<button class="chk ${on ? 'on' : ''}" data-act="${act}" ${data} role="checkbox" aria-checked="${on}"><span class="box">${on ? icon('check') : ''}</span><span class="chk-label">${label}</span>${extra}</button>`;
}

export function dataAttrs(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `data-${k}="${esc(v)}"`)
    .join(' ');
}
