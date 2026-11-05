// views/tracker-view.js: Colleges | Tests | Assignments | Other.

import { App, act, checkbox, esc, icon, onInput, openSheet, refreshSheet, sheetHead } from '../ui.js';
import * as store from '../storage.js';
import { CAT_LABELS, CATS, dueShort, isClosed, logEdit, sortItems, STATUS_LABELS, STATUSES, subtaskProgress, urgency } from '../tracker.js';
import { prettyDate, todayKey } from '../util.js';

export function title() {
  const n = store.getTracker().items.filter((i) => !isClosed(i)).length;
  return { title: 'Tracker', sub: `${n} open` };
}

function currentCat() {
  const c = store.getUi().trackerCat;
  return CATS.includes(c) ? c : 'college';
}

function metaLine(it) {
  const m = it.meta || {};
  const bits = [];
  if (it.cat === 'college') {
    if (m.plan) bits.push(`Plan: ${m.plan}`);
    if (m.decision) bits.push(`Decision: ${m.decision}`);
  } else if (it.cat === 'test' && m.topics) {
    bits.push(`Topics: ${Array.isArray(m.topics) ? m.topics.join(', ') : m.topics}`);
  }
  return bits.length ? `<div class="trk-meta">${bits.map(esc).join(' · ')}</div>` : '';
}

function dueLine(it, today) {
  if (!it.due) return '<span class="muted">No due date</span>';
  return `${prettyDate(it.due)}${it.dueTime ? ' · ' + it.dueTime : ''}`;
}

function card(it, today) {
  const u = urgency(it, today);
  const p = subtaskProgress(it);
  return `<button class="card trk u-${u}" data-act="trk.open" data-id="${esc(it.id)}">
    <div class="row between top">
      <div class="trk-title">${esc(it.title)}</div>
      ${it.due ? `<span class="cd u-${u}">${esc(dueShort(it.due, today))}</span>` : ''}
    </div>
    <div class="row gap wrap small">
      <span class="muted">${dueLine(it, today)}</span>
      <span class="pill s-${it.status}">${esc(STATUS_LABELS[it.status] || it.status)}</span>
      ${p.total ? `<span class="prog">${icon('check', 'sm')}${p.done}/${p.total}</span>` : ''}
    </div>
    ${metaLine(it)}
    ${it.notes ? `<div class="trk-notes">${esc(it.notes)}</div>` : ''}
  </button>`;
}

export function render() {
  const today = todayKey();
  const items = store.getTracker().items;
  const cat = currentCat();
  const counts = Object.fromEntries(CATS.map((c) => [c, items.filter((i) => i.cat === c && !isClosed(i)).length]));
  let html = `<div class="seg" role="tablist">${CATS.map(
    (c) => `<button class="seg-btn ${c === cat ? 'on' : ''}" data-act="trk.cat" data-cat="${c}" role="tab" aria-selected="${c === cat}">${CAT_LABELS[c]}${counts[c] ? `<span class="seg-n">${counts[c]}</span>` : ''}</button>`,
  ).join('')}</div>`;
  const mine = sortItems(items.filter((i) => i.cat === cat));
  const open = mine.filter((i) => !isClosed(i));
  const closed = mine.filter(isClosed);
  if (!mine.length) {
    html += `<section class="card empty"><h2>No ${CAT_LABELS[cat].toLowerCase()} yet.</h2><p class="muted">Tracker codes from Claude show up here.</p>
      <button class="btn primary block" data-act="paste.open">${icon('paste')}<span>Paste code</span></button>
      ${items.length ? '' : '<button class="btn block ghost" data-act="paste.example" data-kind="tracker">Load example tracker</button>'}</section>`;
    return html;
  }
  html += open.map((it) => card(it, today)).join('');
  if (!open.length) html += '<p class="muted center pad">Everything here is done.</p>';
  if (closed.length) {
    const ui = store.getUi();
    html += `<details class="completed" ${ui.trkCompletedOpen ? 'open' : ''} data-input="trk.completedToggle"><summary>Completed <span class="muted">(${closed.length})</span>${icon('down')}</summary>${closed.map((it) => card(it, today)).join('')}</details>`;
  }
  return html;
}

act('trk.cat', (el) => {
  store.setUi({ trackerCat: el.dataset.cat });
  App.render({ scrollTop: true });
});

onInput('trk.completedToggle', (el, ev) => {
  if (ev.type === 'toggle') store.setUi({ trkCompletedOpen: el.open });
});

// ---------- detail sheet ----------

let notesAtOpen = '';

export function openTrackerSheet(id) {
  const it0 = store.getTracker().items.find((x) => x.id === id);
  notesAtOpen = it0 ? it0.notes || '' : '';
  openSheet(
    () => {
      const today = todayKey();
      const it = store.getTracker().items.find((x) => x.id === id);
      if (!it) return `${sheetHead('Not found')}<p class="muted">This tracker item no longer exists.</p>`;
      const u = urgency(it, today);
      const m = it.meta || {};
      const metaRows = Object.entries(m)
        .map(([k, v]) => `<div class="kv"><span class="muted">${esc(k === 'plan' ? 'Plan' : k === 'decision' ? 'Decision' : k === 'topics' ? 'Topics' : k)}</span><span>${esc(Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : v)}</span></div>`)
        .join('');
      return `${sheetHead(it.title, `${CAT_LABELS[it.cat] || 'Other'} · id ${esc(it.id)}`)}
        <div class="row gap wrap">${it.due ? `<span class="cd u-${u}">${esc(dueShort(it.due, today))}</span><span>${dueLine(it, today)}</span>` : '<span class="muted">No due date</span>'}</div>
        <h3 class="sec-title">Status</h3>
        <div class="status-grid">${STATUSES.map((s) => `<button class="btn pill-btn s-${s} ${it.status === s ? 'on' : ''}" data-act="trk.status" data-id="${esc(it.id)}" data-s="${s}">${STATUS_LABELS[s]}</button>`).join('')}</div>
        ${
          it.subtasks && it.subtasks.length
            ? `<h3 class="sec-title">Subtasks <span class="muted">${subtaskProgress(it).done}/${it.subtasks.length}</span></h3>${it.subtasks
                .map((s, i) => checkbox(!!s.done, esc(s.t), 'trk.sub', `data-id="${esc(it.id)}" data-i="${i}"`))
                .join('')}`
            : ''
        }
        ${metaRows ? `<h3 class="sec-title">Details</h3>${metaRows}` : ''}
        <h3 class="sec-title">Notes</h3>
        <textarea class="input notes" rows="3" placeholder="Add a note" data-input="trk.notes" data-id="${esc(it.id)}">${esc(it.notes || '')}</textarea>`;
    },
    { onClose: () => saveNotesLog(id) },
  );
}

function saveNotesLog(id) {
  const it = store.getTracker().items.find((x) => x.id === id);
  if (!it) return;
  const now = it.notes || '';
  if (now !== notesAtOpen) {
    const day = store.ensureDay(todayKey());
    logEdit(day, { id, k: 'notes', from: notesAtOpen, to: now });
    store.saveDay(day);
    notesAtOpen = now;
  }
  App.render();
}

act('trk.status', (el) => {
  const t = store.getTracker();
  const it = t.items.find((x) => x.id === el.dataset.id);
  if (!it || it.status === el.dataset.s) return;
  const from = it.status;
  it.status = el.dataset.s;
  store.saveTracker(t);
  const day = store.ensureDay(todayKey());
  logEdit(day, { id: it.id, k: 'status', from, to: it.status });
  store.saveDay(day);
  refreshSheet();
  App.render();
});

act('trk.sub', (el) => {
  const t = store.getTracker();
  const it = t.items.find((x) => x.id === el.dataset.id);
  if (!it || !it.subtasks) return;
  const s = it.subtasks[+el.dataset.i];
  if (!s) return;
  s.done = !s.done;
  store.saveTracker(t);
  const day = store.ensureDay(todayKey());
  logEdit(day, { id: it.id, k: 'sub', t: s.t, done: s.done });
  store.saveDay(day);
  refreshSheet();
  App.render();
});

onInput('trk.notes', (el, ev) => {
  const t = store.getTracker();
  const it = t.items.find((x) => x.id === el.dataset.id);
  if (!it) return;
  it.notes = el.value;
  store.saveTracker(t);
  if (ev.type === 'change') saveNotesLog(it.id);
});
