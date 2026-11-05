// views/paste.js: the universal "Paste code" sheet. Detects the code by its
// "type", shows what will change, and applies it only on confirm.

import { App, act, closeSheet, esc, icon, kindIcon, onInput, openSheet, refreshSheet, sheetHead, toast } from '../ui.js';
import * as store from '../storage.js';
import { parseCode } from '../codes.js';
import { exampleText } from '../examples.js';
import { applyPatch, countMarked, installPlan } from '../planner.js';
import { applyTrackerCode, CAT_LABELS, isClosed } from '../tracker.js';
import * as W from '../workout.js';
import { prettyDate, relDay, todayKey } from '../util.js';
import { loadSession } from './workout-view.js';
import { setViewDate } from './today.js';

let st = { text: '', parsed: null, phase: 'input', result: null };

function reset(text = '') {
  st = { text, parsed: null, phase: 'input', result: null };
}

export function openPaste(prefill) {
  reset(prefill || '');
  if (prefill) check();
  openSheet(render, { cls: 'tall' });
}

function check() {
  const tracker = store.getTracker();
  st.parsed = parseCode(st.text, { tracker, today: todayKey() });
  st.phase = st.parsed.ok ? 'preview' : 'input';
}

function errorBox() {
  const p = st.parsed;
  if (!p || p.ok) return '';
  const list = p.errors.slice(0, 8);
  const more = p.errors.length - list.length;
  return `<div class="err" role="alert"><b>${p.type ? `This ${esc(p.type)} code has a problem:` : 'Can\'t use this code:'}</b>${list.map((e) => `<div>${esc(e)}</div>`).join('')}${more > 0 ? `<div>…and ${more} more.</div>` : ''}<div class="muted small">Nothing was changed.</div></div>`;
}

function inputView() {
  const canRead = typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.readText;
  return `${sheetHead('Paste code', 'Day, patch, tracker or workout code from Claude.')}
    ${canRead ? `<button class="btn block" data-act="paste.fromClipboard">${icon('paste')}<span>Paste from clipboard</span></button>` : ''}
    <textarea class="code-area" id="paste-text" rows="8" placeholder='{"v":1,"type":"day",...}' data-input="paste.text" spellcheck="false" autocapitalize="off" autocorrect="off" autocomplete="off">${esc(st.text)}</textarea>
    ${errorBox()}
    <button class="btn block primary big" data-act="paste.check">Check code</button>
    <div class="examples"><span class="muted small">Load example:</span>
      ${['day', 'patch', 'tracker', 'workout'].map((k) => `<button class="btn sm" data-act="paste.loadExample" data-kind="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}
    </div>`;
}

function blockLine(b) {
  return `<div class="pv-row" style="--k:var(--k-${b.kind})"><span class="pv-time">${b.start}–${b.end}</span><span class="pv-ic">${kindIcon(b.kind)}</span><span class="grow">${esc(b.title)}${b.workout ? ' <span class="muted small">(workout)</span>' : ''}${b.trackerId ? ` <span class="muted small">→ ${esc(b.trackerId)}</span>` : ''}</span></div>`;
}

function previewDay(plan) {
  const existing = store.getDay(plan.date);
  const has = existing && existing.plan;
  const rel = relDay(plan.date);
  const warn = has
    ? `<div class="warnbox"><b>You already have a plan for ${prettyDate(plan.date)}</b> (${existing.plan.blocks.length} blocks, ${countMarked(existing)} marked). Replace it? Marks on blocks with the same id and title are kept.</div>`
    : '';
  const other = plan.date !== todayKey() ? `<div class="infobox">This plan is for ${prettyDate(plan.date)}${rel ? ` (${rel.toLowerCase()})` : ''}.</div>` : '';
  return {
    body: `${warn}${other}
      <div class="pv-head"><b>${prettyDate(plan.date)}</b> · ${plan.blocks.length} blocks</div>
      ${plan.top3.length ? `<div class="pv-sub">Top 3: ${plan.top3.map(esc).join(' · ')}</div>` : ''}
      ${plan.deadlines.length ? `<div class="pv-sub">Deadlines: ${plan.deadlines.map((d) => `${esc(d.name)} (${prettyDate(d.due)})`).join(', ')}</div>` : ''}
      ${plan.note ? `<div class="pv-sub">Note: ${esc(plan.note)}</div>` : ''}
      <div class="pv-list">${plan.blocks.map(blockLine).join('')}</div>`,
    yes: has ? 'Replace plan' : 'Save plan',
    danger: !!has,
  };
}

function previewPatch(patch) {
  const day = store.ensureDay(patch.date);
  const res = applyPatch(day, store.getTracker(), patch);
  const ok = res.results.filter((r) => r.ok).length;
  const failed = res.results.length - ok;
  return {
    body: `<div class="pv-head"><b>Patch for ${prettyDate(patch.date)}</b> · ${res.results.length} change${res.results.length === 1 ? '' : 's'}</div>
      ${failed ? `<div class="warnbox">${failed} change${failed === 1 ? '' : 's'} can't be applied and will be skipped.</div>` : ''}
      <div class="ops">${res.results.map(opLine).join('')}</div>`,
    yes: ok ? `Apply ${ok} change${ok === 1 ? '' : 's'}` : null,
  };
}

function opLine(r) {
  return r.ok
    ? `<div class="op ok">${icon('check')}<span>${esc(r.desc)}</span></div>`
    : `<div class="op bad">${icon('x')}<span><b>#${r.i + 1} ${esc(r.op || 'op')}</b>: ${esc(r.error)}</span></div>`;
}

function previewTracker(code) {
  const t = store.getTracker();
  const res = applyTrackerCode(t, code);
  const byId = new Map(res.tracker.items.map((i) => [i.id, i]));
  const line = (id, extra = '') => {
    const it = byId.get(id);
    return `<div class="pv-row"><span class="pv-cat">${esc((CAT_LABELS[it.cat] || 'Other').replace(/s$/, ''))}</span><span class="grow">${esc(it.title)}${extra}</span><span class="muted small">${it.due ? prettyDate(it.due) : ''}</span></div>`;
  };
  if (code.mode === 'replace') {
    return {
      body: `<div class="warnbox"><b>This replaces your whole tracker.</b> ${t.items.length} item${t.items.length === 1 ? '' : 's'} now, ${code.items.length} after. Checked subtasks and notes on removed items are lost.</div>
        <div class="pv-list">${res.added.map((id) => line(id)).join('')}</div>`,
      yes: 'Replace tracker',
      danger: true,
    };
  }
  return {
    body: `<div class="pv-head"><b>Tracker</b> · ${res.added.length} new, ${res.updated.length} updated</div>
      ${res.added.length ? `<h4 class="pv-h">New</h4><div class="pv-list">${res.added.map((id) => line(id)).join('')}</div>` : ''}
      ${res.updated.length ? `<h4 class="pv-h">Updated</h4><div class="pv-list">${res.updated.map((u) => line(u.id, ` <span class="muted small">(${esc(u.fields.join(', '))})</span>`)).join('')}</div>` : ''}`,
    yes: 'Apply to tracker',
  };
}

function previewWorkout(code) {
  const cur = store.getActiveWorkout();
  const live = cur && (cur.phase === 'warmup' || cur.phase === 'active');
  const t = live ? W.totals(cur) : null;
  return {
    body: `${live ? `<div class="warnbox"><b>A workout is in progress</b> (${esc(cur.code.session)}, ${t.done}/${t.total} sets). Loading this one discards it.</div>` : ''}
      <div class="pv-head"><b>${esc(code.session)}</b>${code.week != null ? ` · Week ${esc(code.week)}` : ''}</div>
      <div class="stats3"><div><b>${W.countExercises(code)}</b><span>exercises</span></div><div><b>${W.countSets(code)}</b><span>sets</span></div><div><b>~${W.estimateMin(code)}</b><span>min</span></div></div>
      <div class="pv-list">${code.blocks.map((blk) => blk.exercises.map((ex, e) => `<div class="pv-row"><b class="pv-time">${esc(W.exLabel(blk, e))}</b><span class="grow">${esc(ex.name)}</span><span class="muted small">${esc(W.targetText(ex))}</span></div>`).join('')).join('')}</div>`,
    yes: live ? 'Replace workout' : 'Load workout',
    danger: !!live,
  };
}

function previewView() {
  const p = st.parsed;
  const v = { day: previewDay, patch: previewPatch, tracker: previewTracker, workout: previewWorkout }[p.type](p.value);
  return `${sheetHead('Check before applying', `${p.type[0].toUpperCase() + p.type.slice(1)} code`)}
    ${v.body}
    <div class="stack sticky-actions">
      ${v.yes ? `<button class="btn block big ${v.danger ? 'danger-fill' : 'primary'}" data-act="paste.apply">${esc(v.yes)}</button>` : '<div class="err">Nothing in this patch can be applied.</div>'}
      <button class="btn block" data-act="paste.back">Back</button>
    </div>`;
}

function resultView() {
  const r = st.result;
  return `${sheetHead(r.title)}
    ${r.body || ''}
    <button class="btn block primary big" data-act="paste.done">Done</button>`;
}

function render() {
  if (st.phase === 'preview' && st.parsed && st.parsed.ok) return previewView();
  if (st.phase === 'result') return resultView();
  return inputView();
}

// ---------- apply ----------

function apply() {
  const p = st.parsed;
  if (!p || !p.ok) return;
  const now = Date.now();
  try {
    if (p.type === 'day') {
      const day = store.ensureDay(p.value.date);
      installPlan(day, p.value, now);
      store.saveDay(day);
      closeSheet(true);
      toast(`Plan saved for ${prettyDate(p.value.date)}`);
      if (p.value.date === todayKey()) App.go('now', { scrollTop: true });
      else {
        setViewDate(p.value.date);
        App.go('today', { scrollTop: true });
      }
    } else if (p.type === 'patch') {
      const day = store.ensureDay(p.value.date);
      const res = applyPatch(day, store.getTracker(), p.value, now);
      store.saveDay(res.day);
      store.saveTracker(res.tracker);
      const failed = res.results.filter((r) => !r.ok);
      const ok = res.results.length - failed.length;
      App.render();
      if (failed.length) {
        st.phase = 'result';
        st.result = {
          title: `Applied ${ok} of ${res.results.length} changes`,
          body: `<div class="warnbox">${failed.length} change${failed.length === 1 ? ' was' : 's were'} skipped:</div><div class="ops">${failed.map(opLine).join('')}</div>`,
          go: p.value.date === todayKey() ? 'now' : 'today',
          date: p.value.date,
        };
        refreshSheet();
      } else {
        closeSheet(true);
        toast(`Patch applied: ${ok} change${ok === 1 ? '' : 's'}`);
        if (p.value.date !== todayKey()) {
          setViewDate(p.value.date);
          App.go('today');
        }
      }
    } else if (p.type === 'tracker') {
      const res = applyTrackerCode(store.getTracker(), p.value);
      store.saveTracker(res.tracker);
      closeSheet(true);
      toast(p.value.mode === 'replace' ? `Tracker replaced: ${res.tracker.items.length} items` : `Tracker: ${res.added.length} new, ${res.updated.length} updated`);
      const first = res.tracker.items.find((i) => i.id === (res.added[0] || (res.updated[0] && res.updated[0].id)));
      if (first && !isClosed(first)) store.setUi({ trackerCat: first.cat });
      App.go('tracker', { scrollTop: true });
    } else if (p.type === 'workout') {
      closeSheet(true);
      loadSession(p.value, null);
      toast(`Workout loaded: ${p.value.session}`);
    }
  } catch (e) {
    // Should never happen, but never lose data or crash on a bad code.
    st.phase = 'input';
    st.parsed = { ok: false, type: p.type, errors: [`Couldn't apply this code: ${e.message}`] };
    refreshSheet();
  }
}

act('paste.open', () => openPaste());
act('paste.example', (el) => openPaste(exampleText(el.dataset.kind)));
onInput('paste.text', (el) => {
  st.text = el.value;
});
act('paste.check', () => {
  const ta = document.getElementById('paste-text');
  if (ta) st.text = ta.value;
  check();
  refreshSheet();
});
act('paste.back', () => {
  st.phase = 'input';
  st.parsed = null;
  refreshSheet();
});
act('paste.apply', apply);
act('paste.done', () => {
  const r = st.result;
  closeSheet(true);
  if (r && r.go === 'today') {
    setViewDate(r.date);
    App.go('today');
  }
});
act('paste.loadExample', (el) => {
  st.text = exampleText(el.dataset.kind);
  check();
  refreshSheet();
});
act('paste.fromClipboard', async () => {
  try {
    const t = await navigator.clipboard.readText();
    st.text = t || '';
    check();
  } catch {
    st.parsed = { ok: false, errors: ['Couldn\'t read the clipboard. Press and hold in the box below, then tap Paste.'] };
  }
  refreshSheet();
});
