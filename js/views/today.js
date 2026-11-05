// views/today.js: vertical timeline of a day with a current-time line.

import { App, act, esc, icon } from '../ui.js';
import * as store from '../storage.js';
import { nowContext, sortBlocks, span } from '../planner.js';
import { addDays, fmtMins, nowMinutes, prettyDate, relDay, todayKey } from '../util.js';
import { kindChip, stateBadge } from './common.js';

let viewDate = null;

export const getViewDate = () => viewDate || todayKey();
export function setViewDate(d) {
  viewDate = d === todayKey() ? null : d;
}

export function title() {
  const d = getViewDate();
  return { title: 'Today', sub: d === todayKey() ? prettyDate(d) : `Viewing ${prettyDate(d)}` };
}

const H = (min) => Math.round(Math.min(220, Math.max(72, min * 1.15)));
const GAP_H = 34;

function nowLine(top) {
  return `<div class="now-line" style="top:${top}"><span>${new Date(Date.now()).toTimeString().slice(0, 5)}</span></div>`;
}

function timeline(day, isToday) {
  const blocks = sortBlocks(day.plan.blocks);
  const nm = nowMinutes();
  const ctx = isToday ? nowContext(day, nm) : null;
  let html = '';
  let prevEnd = null;
  let placed = !isToday;
  if (isToday && blocks.length && nm < span(blocks[0]).s) {
    html += `<div class="tl-edge">${nowLine('50%')}</div>`;
    placed = true;
  }
  for (const b of blocks) {
    const { s, e } = span(b);
    if (prevEnd != null && s - prevEnd >= 5) {
      let line = '';
      if (!placed && nm >= prevEnd && nm < s) {
        line = nowLine(`${((nm - prevEnd) / (s - prevEnd)) * 100}%`);
        placed = true;
      }
      html += `<div class="tl-gap"><span>${fmtMins(s - prevEnd)} free</span>${line}</div>`;
    }
    let line = '';
    if (!placed && nm >= s && nm < e) {
      line = nowLine(`${((nm - s) / (e - s)) * 100}%`);
      placed = true;
    }
    const isCur = ctx && ctx.current === b;
    const past = isToday && e <= nm && !b._state;
    const tasks = b.tasks && b.tasks.length ? `<span class="muted small">${(b._tasks || []).filter(Boolean).length}/${b.tasks.length} tasks</span>` : '';
    const extra = [b.trackerId ? icon('tracker', 'sm') : '', b.workout ? icon('workout', 'sm') : ''].join('');
    html += `<div class="tl-row" style="min-height:${H(e - s)}px">
      <div class="tl-time"><b>${b.start}</b><span>${b.end}</span></div>
      <button class="tl-block st-${b._state || 'none'} ${isCur ? 'cur' : ''} ${past ? 'past' : ''}" style="--k:var(--k-${b.kind})" data-act="blk.open" data-date="${day.date}" data-id="${esc(b.id)}">
        <div class="tl-top"><span class="tl-ic">${kindChip(b.kind)}</span>${stateBadge(b, isCur)}${past ? '<span class="badge mute">Not marked</span>' : ''}</div>
        <div class="tl-title">${esc(b.title)}</div>
        <div class="tl-meta">${tasks}${extra}</div>
      </button>
      ${line}
    </div>`;
    prevEnd = Math.max(prevEnd == null ? e : prevEnd, e);
  }
  if (!placed) html += `<div class="tl-edge">${nowLine('50%')}</div>`;
  return `<div class="timeline">${html}</div>`;
}

export function render() {
  const date = getViewDate();
  const today = todayKey();
  return `<div class="today-wrap">${body(date, today, date === today)}</div>`;
}

function body(date, today, isToday) {
  const day = store.getDay(date);
  const rel = relDay(date, today);
  let html = `<div class="date-nav">
    <button class="icon-btn" data-act="today.shift" data-n="-1" aria-label="Previous day">${icon('left')}</button>
    <div class="date-mid"><b>${prettyDate(date)}</b><span class="muted small">${rel || date}</span></div>
    <button class="icon-btn" data-act="today.shift" data-n="1" aria-label="Next day">${icon('right')}</button>
  </div>`;
  if (!isToday) html += `<button class="btn block ghost sm" data-act="today.shift" data-n="0">Back to today</button>`;
  if (!day || !day.plan) {
    return html + `<section class="card empty"><h2>No plan for this day.</h2>${date >= today ? `<p class="muted">Paste the day code for ${prettyDate(date)}.</p><button class="btn primary block" data-act="paste.open">${icon('paste')}<span>Paste code</span></button>` : '<p class="muted">Nothing was planned (or it\'s older than 60 days).</p>'}</section>`;
  }
  const blocks = day.plan.blocks;
  const done = blocks.filter((b) => b._state === 'done').length;
  const skipped = blocks.filter((b) => b._state === 'skipped').length;
  const moved = blocks.filter((b) => b._state === 'moved').length;
  html += `<div class="summary-line"><span><b>${done}</b>/${blocks.length} done</span>${skipped ? `<span>${skipped} skipped</span>` : ''}${moved ? `<span>${moved} moved</span>` : ''}</div>`;
  if (!blocks.length) return html + '<section class="card empty"><p class="muted">This plan has no blocks.</p></section>';
  return html + timeline(day, isToday);
}

export function signature() {
  return getViewDate() + '|' + Math.floor(nowMinutes());
}

act('today.shift', (el) => {
  const n = +el.dataset.n;
  setViewDate(n === 0 ? todayKey() : addDays(getViewDate(), n));
  App.render({ scrollTop: true });
});
