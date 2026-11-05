// views/now.js: the home screen. The current block big, up next, top 3,
// deadlines, quick actions and "running late".

import { App, act, checkbox, copyText, esc, icon, toast } from '../ui.js';
import * as store from '../storage.js';
import { nowContext, runLate, span } from '../planner.js';
import { dueShort, upcomingDeadlines, urgencyForDate } from '../tracker.js';
import { addDays, fmtClock, fmtMins, nowMinutes, prettyDate, todayKey, toMin, tsAt } from '../util.js';
import { blockExtras, kindChip } from './common.js';
import { reportFor, markCopied } from './more.js';

export const WIND_DOWN = toMin('21:45');
let lateOpen = false;

export function title() {
  return { title: 'Now', sub: prettyDate(todayKey()) };
}

function windDown(day) {
  const copied = day && day.reportCopiedAt;
  return `<section class="banner wind">
    ${icon('moon')}
    <div class="grow"><b>Wind down.</b> ${copied ? 'Report copied.' : 'Copy today\'s report?'}</div>
    <button class="btn ${copied ? '' : 'primary'} sm" data-act="now.copyReport" data-date="${todayKey()}">${icon('copy')}<span>${copied ? 'Copy again' : 'Copy report'}</span></button>
  </section>`;
}

function deadlineStrip(plan, today) {
  const list = upcomingDeadlines(plan, store.getTracker(), today, 3);
  if (!list.length) return '';
  return `<section class="strip-wrap"><h3 class="sec-title">Deadlines</h3><div class="strip">${list
    .map((d) => {
      const u = urgencyForDate(d.due, today);
      const attrs = d.id ? `data-act="trk.open" data-id="${esc(d.id)}"` : '';
      return `<button class="dl u-${u}" ${attrs}><span class="dl-name">${esc(d.name)}</span><span class="dl-when">${esc(dueShort(d.due, today))}</span></button>`;
    })
    .join('')}</div></section>`;
}

function top3Card(day) {
  const t = (day.plan && day.plan.top3) || [];
  if (!t.length) return '';
  const n = t.filter((_, i) => day.top3[i]).length;
  return `<section class="card"><div class="row between"><h3 class="sec-title flush">Top 3</h3><span class="muted small">${n}/${t.length}</span></div>${t
    .map((x, i) => checkbox(!!day.top3[i], esc(x), 'top3.toggle', `data-date="${day.date}" data-i="${i}"`))
    .join('')}</section>`;
}

function lateRow() {
  if (!lateOpen) return '';
  return `<div class="late-row">${[5, 10, 15, 30].map((m) => `<button class="btn" data-act="now.lateBy" data-m="${m}">+${m}</button>`).join('')}</div>
    <div class="muted small center">Shifts every remaining block and logs it.</div>`;
}

function actionRow(day, b) {
  const d = `data-date="${day.date}" data-id="${esc(b.id)}"`;
  return `<div class="hero-actions">
    <button class="btn primary big block" data-act="blk.done" ${d}>${icon('check')}<span>Done</span></button>
    <div class="grid3">
      <button class="btn tall" data-act="blk.skip" ${d}>${icon('skip')}<span>Skip</span></button>
      <button class="btn tall" data-act="blk.moved" ${d}>${icon('tomorrow')}<span>Move to tomorrow</span></button>
      <button class="btn tall ${lateOpen ? 'on' : ''}" data-act="now.late">${icon('late')}<span>Running late</span></button>
    </div>
    ${lateRow()}
  </div>`;
}

function heroCurrent(day, b) {
  const { s, e } = span(b);
  const startTs = tsAt(day.date, s);
  const endTs = tsAt(day.date, e);
  const now = Date.now();
  const pct = Math.min(100, Math.max(0, ((now - startTs) / (endTs - startTs)) * 100));
  return `<section class="card hero" style="--k:var(--k-${b.kind})">
    <div class="row between"><span class="row gap">${kindChip(b.kind)}<span class="live"><i></i>Live</span></span><span class="muted tnum">${b.start}–${b.end}</span></div>
    <h2 class="hero-title">${esc(b.title)}</h2>
    <div class="hero-time"><span class="big-num" data-cd="down" data-to="${endTs}">${fmtClock(endTs - now)}</span><span class="muted">left</span></div>
    <div class="bar"><i data-cd="bar" data-from="${startTs}" data-to="${endTs}" style="width:${pct}%"></i></div>
    ${blockExtras(day, b)}
    ${actionRow(day, b)}
  </section>`;
}

function heroIdle(day, ctx) {
  const n = ctx.next;
  if (!n) {
    const done = ctx.sorted.filter((b) => b._state === 'done').length;
    return `<section class="card hero idle">
      <h2 class="hero-title">${ctx.sorted.length ? 'That\'s the day.' : 'Empty plan'}</h2>
      <p class="muted">${ctx.sorted.length ? `${done} of ${ctx.sorted.length} blocks done.` : 'This plan has no blocks.'} Generate the report from More, or copy it here.</p>
      <button class="btn primary block" data-act="now.copyReport" data-date="${day.date}">${icon('copy')}<span>Copy today's report</span></button>
    </section>`;
  }
  const startTs = tsAt(day.date, span(n).s);
  return `<section class="card hero idle" style="--k:var(--k-${n.kind})">
    <div class="row between"><span class="muted">Free until ${n.start}</span>${kindChip(n.kind)}</div>
    <h2 class="hero-title"><span class="muted">Next:</span> ${esc(n.title)}</h2>
    <div class="hero-time stack-label"><span class="muted">starts in</span><span class="big-num" data-cd="down" data-to="${startTs}">${fmtClock(startTs - Date.now())}</span></div>
    <div class="hero-actions"><div class="grid2">
      <button class="btn" data-act="blk.open" data-date="${day.date}" data-id="${esc(n.id)}">${icon('note')}<span>Details</span></button>
      <button class="btn ${lateOpen ? 'on' : ''}" data-act="now.late">${icon('late')}<span>Running late</span></button>
    </div>${lateRow()}</div>
  </section>`;
}

function upNext(day, b, label = 'Up next') {
  const startTs = tsAt(day.date, span(b).s);
  return `<button class="card upnext" style="--k:var(--k-${b.kind})" data-act="blk.open" data-date="${day.date}" data-id="${esc(b.id)}">
    <div class="upnext-l"><div class="muted small">${label} · ${b.start}</div><div class="upnext-title">${esc(b.title)}</div></div>
    <div class="upnext-r"><span class="muted small">in</span><b data-cd="mins" data-to="${startTs}">${fmtMins(Math.ceil((startTs - Date.now()) / 60000))}</b></div>
  </button>`;
}

function emptyState(today) {
  const y = addDays(today, -1);
  const yd = store.getDay(y);
  const remind = yd && yd.plan && !yd.reportCopiedAt
    ? `<section class="banner warn">${icon('bell')}<div class="grow">Yesterday's report wasn't copied.</div><button class="btn sm primary" data-act="now.copyReport" data-date="${y}">${icon('copy')}<span>Copy it</span></button></section>`
    : '';
  return `${remind}<section class="card empty">
    <div class="empty-ic">${icon('paste')}</div>
    <h2>No plan yet.</h2>
    <p class="muted">Paste today's day code.</p>
    <button class="btn primary block big" data-act="paste.open">${icon('paste')}<span>Paste code</span></button>
    <button class="btn block ghost" data-act="paste.example" data-kind="day">Load example day</button>
  </section>`;
}

// Desktop side column: how the day is going.
function dayStats(day, ctx) {
  const total = ctx.sorted.length;
  const done = ctx.sorted.filter((b) => b._state === 'done').length;
  const left = ctx.sorted.filter((b) => !b._state).length;
  const t3 = (day.plan.top3 || []).length;
  const t3done = (day.plan.top3 || []).filter((_, i) => day.top3[i]).length;
  const R = 34;
  const C = 2 * Math.PI * R;
  const frac = total ? done / total : 0;
  return `<section class="card day-stats desk-only">
    <svg class="mini-ring" viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="${R}" class="ring-bg"/><circle cx="42" cy="42" r="${R}" class="ring-fg acc" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}"/></svg>
    <div class="ds-nums">
      <div><b>${done}</b><span>/${total} blocks done</span></div>
      ${t3 ? `<div><b>${t3done}</b><span>/${t3} top 3</span></div>` : ''}
      <div><b>${left}</b><span> still to go</span></div>
    </div>
  </section>`;
}

// Desktop side column: the rest of today at a glance.
function agenda(day, ctx, nm) {
  const rest = ctx.sorted.filter((b) => span(b).e > nm).slice(0, 10);
  if (!rest.length) return '';
  return `<section class="card agenda desk-only"><div class="row between"><h3 class="sec-title flush">Rest of today</h3><button class="btn ghost sm" data-act="app.go" data-tab="today">Timeline${icon('right')}</button></div>
    ${rest
      .map((b) => {
        const cur = ctx.current === b;
        return `<button class="ag-row ${cur ? 'cur' : ''} ${b._state ? 'st-' + b._state : ''}" style="--k:var(--k-${b.kind})" data-act="blk.open" data-date="${day.date}" data-id="${esc(b.id)}">
          <span class="ag-time tnum">${b.start}</span><span class="ag-dot"></span><span class="ag-title">${esc(b.title)}</span>${cur ? '<span class="badge now">Now</span>' : b._state ? `<span class="badge mute">${esc(b._state === 'moved' ? 'tomorrow' : b._state)}</span>` : ''}
        </button>`;
      })
      .join('')}
  </section>`;
}

export function render() {
  const today = todayKey();
  const day = store.getDay(today);
  const nm = nowMinutes();
  let html = '';
  if (nm >= WIND_DOWN) html += windDown(day);
  if (!day || !day.plan) {
    return html + `<div class="now-grid"><div class="now-main">${emptyState(today)}</div><div class="now-side">${deadlineStrip(null, today)}</div></div>`;
  }
  const ctx = nowContext(day, nm);
  let main = '';
  if (day.plan.note) main += `<div class="day-note">${icon('note')}<span>${esc(day.plan.note)}</span></div>`;
  main += ctx.current ? heroCurrent(day, ctx.current) : heroIdle(day, ctx);
  if (ctx.current && ctx.next) main += upNext(day, ctx.next);
  else if (!ctx.current && ctx.after) main += upNext(day, ctx.after, 'After that');
  let side = dayStats(day, ctx);
  side += top3Card(day);
  side += deadlineStrip(day.plan, today);
  if (ctx.unmarkedPast.length) {
    side += `<button class="hint" data-act="app.go" data-tab="today">${icon('today')}<span>${ctx.unmarkedPast.length} earlier block${ctx.unmarkedPast.length > 1 ? 's' : ''} not marked</span>${icon('right')}</button>`;
  }
  side += agenda(day, ctx, nm);
  return `${html}<div class="now-grid"><div class="now-main">${main}</div><div class="now-side">${side}</div></div>`;
}

// Used by the tick loop to know when to re-render.
export function signature() {
  const day = store.getDay(todayKey());
  const nm = nowMinutes();
  if (!day || !day.plan) return 'none' + (nm >= WIND_DOWN);
  const c = nowContext(day, nm);
  return [c.current && c.current.id, c.next && c.next.id, c.unmarkedPast.length, nm >= WIND_DOWN].join('|');
}

act('now.late', () => {
  lateOpen = !lateOpen;
  App.render();
});

act('now.lateBy', (el) => {
  const m = +el.dataset.m;
  const day = store.getDay(todayKey());
  if (!day) return;
  const n = runLate(day, m, nowMinutes());
  store.saveDay(day);
  lateOpen = false;
  App.render();
  toast(`Shifted ${n} block${n === 1 ? '' : 's'} by +${m} min`);
});

act('now.copyReport', (el) => {
  const date = el.dataset.date;
  copyText(reportFor(date), el, { onCopied: () => markCopied(date) });
});
