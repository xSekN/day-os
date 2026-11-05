// views/more.js: inbox, end-of-day report, calendar export, backup/restore,
// settings and day history.

import { App, act, beep, checkbox, closeSheet, copyText, esc, icon, onInput, openSheet, sheetHead, toast } from '../ui.js';
import * as store from '../storage.js';
import { buildDayReport } from '../report.js';
import { buildICS } from '../planner.js';
import { prettyDate, relDay, todayKey } from '../util.js';
import { addInbox } from './common.js';
import { setViewDate } from './today.js';

export const APP_VERSION = '1.0.0';

let showReport = false;
let restoreOpen = false;
let restoreText = '';
let restoreInfo = null;
let restoreError = '';

export function title() {
  return { title: 'More', sub: '' };
}

// ---------- report ----------

export function reportFor(date) {
  const day = store.ensureDay(date);
  const inbox = store.getInbox().filter((i) => i.date === date);
  const logs = store
    .getWorkoutHistory()
    .filter((h) => h.date === date)
    .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0))
    .map((h) => h.log);
  return buildDayReport(day, { inbox, workoutLogs: logs });
}

export function markCopied(date) {
  const day = store.ensureDay(date);
  day.reportCopiedAt = Date.now();
  store.saveDay(day);
  App.render();
}

function reportCard(date) {
  const day = store.getDay(date);
  const copied = day && day.reportCopiedAt;
  return `<section class="card" id="report">
    <div class="row between"><h3 class="sec-title flush">End-of-day report</h3>${copied ? `<span class="badge ok">${icon('check')}Copied</span>` : ''}</div>
    <p class="muted small">${prettyDate(date)}. Paste it back to Claude tonight.</p>
    <label class="lbl" for="day-note">Day note (optional)</label>
    <textarea class="input" id="day-note" rows="2" placeholder="e.g. tired after school" data-input="more.dayNote" data-date="${date}">${esc((day && day.note) || '')}</textarea>
    <div class="grid2">
      <button class="btn" data-act="more.toggleReport">${icon('note')}<span>${showReport ? 'Hide' : 'Preview'}</span></button>
      <button class="btn primary" data-act="more.copyReport" data-date="${date}">${icon('copy')}<span>Copy report</span></button>
    </div>
    ${showReport ? `<pre class="log" id="report-pre">${esc(reportFor(date))}</pre>` : ''}
  </section>`;
}

act('more.toggleReport', () => {
  showReport = !showReport;
  App.render();
});

act('more.copyReport', (el) => {
  const date = el.dataset.date;
  copyText(reportFor(date), el, { onCopied: () => markCopied(date) });
});

onInput('more.dayNote', (el) => {
  const day = store.ensureDay(el.dataset.date);
  day.note = el.value;
  store.saveDay(day);
  const pre = document.getElementById('report-pre');
  if (pre) pre.textContent = reportFor(day.date);
  const pre2 = document.getElementById('hist-report');
  if (pre2) pre2.textContent = reportFor(day.date);
});

// ---------- inbox ----------

function inboxCard() {
  const items = store.getInbox().slice().reverse();
  const today = todayKey();
  return `<section class="card">
    <div class="row between"><h3 class="sec-title flush">Inbox</h3><span class="muted small">${items.length} item${items.length === 1 ? '' : 's'}</span></div>
    <form class="jot" onsubmit="return false">
      <input class="input" id="inbox-input" type="text" enterkeyhint="done" autocomplete="off" placeholder="Quick capture" data-input="more.inboxKey">
      <button class="btn primary" data-act="more.inboxAdd">${icon('plus')}</button>
    </form>
    ${items.length ? `<div class="inbox">${items
      .map(
        (i) => `<div class="inbox-row"><div class="grow"><div>${esc(i.text)}</div><div class="muted small">${i.date === today ? 'Today' : prettyDate(i.date)}${i.t ? ' · ' + i.t : ''}</div></div>
        <button class="icon-btn" data-act="more.inboxDel" data-id="${esc(i.id)}" aria-label="Delete">${icon('x')}</button></div>`,
      )
      .join('')}</div>` : '<p class="muted small">Things you jot down land here and go into that day\'s report.</p>'}
  </section>`;
}

act('more.inboxAdd', () => {
  const el = document.getElementById('inbox-input');
  if (!el || !addInbox(el.value)) return;
  App.render();
  const again = document.getElementById('inbox-input');
  if (again) again.focus();
});

onInput('more.inboxKey', (el, ev) => {
  if (ev.type === 'keydown' && ev.key === 'Enter') {
    ev.preventDefault();
    document.querySelector('[data-act="more.inboxAdd"]').click();
  }
});

act('more.inboxDel', (el) => {
  const list = store.getInbox();
  const item = list.find((i) => i.id === el.dataset.id);
  store.saveInbox(list.filter((i) => i.id !== el.dataset.id));
  App.render();
  if (item)
    toast('Deleted', {
      action: {
        label: 'Undo',
        fn: () => {
          store.saveInbox([...store.getInbox(), item].sort((a, b) => (a.date + (a.t || '') < b.date + (b.t || '') ? -1 : 1)));
          App.render();
        },
      },
    });
});

// ---------- calendar ----------

function calendarCard(date) {
  const day = store.getDay(date);
  const has = day && day.plan && day.plan.blocks.length;
  const canShare = typeof navigator !== 'undefined' && navigator.canShare && typeof File !== 'undefined';
  return `<section class="card">
    <h3 class="sec-title flush">Export today to Calendar</h3>
    <p class="muted small">${has ? `${day.plan.blocks.length} blocks as an .ics file, each with a 5-minute alert. Skipped and moved blocks are left out.` : 'No plan for today yet.'}</p>
    <div class="grid2">
      <button class="btn" data-act="more.icsDownload" ${has ? '' : 'disabled'}>${icon('download')}<span>Download .ics</span></button>
      <button class="btn" data-act="more.icsCopy" ${has ? '' : 'disabled'}>${icon('copy')}<span>Copy .ics</span></button>
    </div>
    ${canShare && has ? `<button class="btn block ghost" data-act="more.icsShare">${icon('share')}<span>Share to Calendar</span></button>` : ''}
  </section>`;
}

function icsFile() {
  const date = todayKey();
  const text = buildICS(store.getDay(date));
  return { text, name: `day-os-${date}.ics` };
}

act('more.icsDownload', () => {
  const { text, name } = icsFile();
  try {
    const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast('Downloading .ics. If nothing opens, use Copy .ics.');
  } catch {
    copyText(text);
  }
});

act('more.icsCopy', (el) => copyText(icsFile().text, el));

act('more.icsShare', async () => {
  const { text, name } = icsFile();
  try {
    const file = new File([text], name, { type: 'text/calendar' });
    if (navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: name });
    else copyText(text);
  } catch (e) {
    if (e && e.name !== 'AbortError') copyText(text);
  }
});

// ---------- backup ----------

function backupCard() {
  return `<section class="card">
    <h3 class="sec-title flush">Backup</h3>
    <p class="muted small">Everything (plans, tracker, inbox, workouts, settings) as one JSON.</p>
    <div class="grid2">
      <button class="btn" data-act="more.backupCopy">${icon('copy')}<span>Copy all data</span></button>
      <button class="btn ${restoreOpen ? 'on' : ''}" data-act="more.restoreToggle">${icon('reset')}<span>Restore from backup</span></button>
    </div>
    ${
      restoreOpen
        ? `<div class="restore">
      <textarea class="code-area" rows="4" placeholder='Paste a backup: {"app":"day-os","type":"backup",...}' data-input="more.restoreText" spellcheck="false" autocapitalize="off" autocorrect="off">${esc(restoreText)}</textarea>
      ${restoreError ? `<div class="err">${esc(restoreError)}</div>` : ''}
      ${
        restoreInfo
          ? `<div class="warnbox"><b>Replace all data with this backup?</b><br>${restoreInfo.exportedAt ? `Made ${esc(new Date(restoreInfo.exportedAt).toLocaleString())}. ` : ''}${restoreInfo.days} days, ${restoreInfo.trackerItems} tracker items, ${restoreInfo.workouts} workouts, ${restoreInfo.inbox} inbox items. Your current data will be overwritten.</div>
             <div class="grid2"><button class="btn" data-act="more.restoreCancel">Cancel</button><button class="btn danger-fill" data-act="more.restoreGo">Restore</button></div>`
          : '<button class="btn block primary" data-act="more.restoreCheck">Check backup</button>'
      }
    </div>`
        : ''
    }
  </section>`;
}

act('more.backupCopy', (el) => copyText(JSON.stringify(store.exportAll()), el));
act('more.restoreToggle', () => {
  restoreOpen = !restoreOpen;
  restoreInfo = null;
  restoreError = '';
  App.render();
});
onInput('more.restoreText', (el) => {
  restoreText = el.value;
  restoreInfo = null;
});
act('more.restoreCheck', () => {
  const ta = document.querySelector('[data-input="more.restoreText"]');
  if (ta) restoreText = ta.value;
  restoreError = '';
  restoreInfo = null;
  try {
    if (!restoreText.trim()) throw new Error('Paste the backup text first.');
    let obj;
    try {
      obj = JSON.parse(restoreText.trim());
    } catch {
      throw new Error('This is not valid JSON. Copy the whole backup again (it is one long line).');
    }
    restoreInfo = store.describeBackup(obj);
  } catch (e) {
    restoreError = e.message;
  }
  App.render();
});
act('more.restoreCancel', () => {
  restoreInfo = null;
  App.render();
});
act('more.restoreGo', () => {
  try {
    store.importAll(JSON.parse(restoreText.trim()));
    store.resetCache();
    restoreOpen = false;
    restoreText = '';
    restoreInfo = null;
    App.render({ scrollTop: true });
    toast('Backup restored');
  } catch (e) {
    restoreError = e.message;
    restoreInfo = null;
    App.render();
  }
});

// ---------- settings ----------

function settingsCard() {
  const s = store.getSettings();
  return `<section class="card">
    <h3 class="sec-title flush">Settings</h3>
    ${checkbox(s.sound, '<b>Sound</b> <span class="muted small">beeps for rest, holds and heads-up (vibrates where supported)</span>', 'more.sound')}
    <div class="lbl">Heads-up before the next block</div>
    <div class="seg small">${[0, 2, 5, 10, 15].map((m) => `<button class="seg-btn ${s.headsUpMin === m ? 'on' : ''}" data-act="more.headsUp" data-m="${m}">${m ? m + ' min' : 'Off'}</button>`).join('')}</div>
    <button class="btn block ghost" data-act="more.testSound">${icon('bell')}<span>Test sound</span></button>
  </section>`;
}

act('more.sound', () => {
  const s = store.getSettings();
  s.sound = !s.sound;
  store.saveSettings(s);
  App.render();
});
act('more.headsUp', (el) => {
  const s = store.getSettings();
  s.headsUpMin = +el.dataset.m;
  store.saveSettings(s);
  App.render();
});
act('more.testSound', () => beep('rest'));

// ---------- history ----------

function historyCard() {
  const today = todayKey();
  const keys = store.listDayKeys().filter((k) => k <= today).reverse();
  const rows = keys
    .map((k) => {
      const d = store.getDay(k);
      if (!d) return '';
      const blocks = d.plan ? d.plan.blocks : [];
      const done = blocks.filter((b) => b._state === 'done').length;
      const wo = store.getWorkoutHistory().filter((h) => h.date === k).length;
      const bits = [blocks.length ? `${done}/${blocks.length} done` : 'no plan', wo ? `${wo} workout${wo > 1 ? 's' : ''}` : '', d.reportCopiedAt ? 'report copied' : ''].filter(Boolean);
      return `<button class="list-row" data-act="more.day" data-date="${k}"><span class="grow"><b>${prettyDate(k)}${relDay(k, today) ? ` <span class="muted">· ${relDay(k, today)}</span>` : ''}</b><span class="muted small">${bits.join(' · ')}</span></span>${icon('right')}</button>`;
    })
    .join('');
  return `<section class="card"><h3 class="sec-title flush">History</h3>${rows ? `<div class="list flush">${rows}</div>` : '<p class="muted small">Past days show up here (kept for 60 days).</p>'}</section>`;
}

act('more.day', (el) => {
  const date = el.dataset.date;
  openSheet(() => {
    const d = store.ensureDay(date);
    return `${sheetHead(prettyDate(date, { year: true }), d.reportCopiedAt ? 'Report copied' : 'Report not copied')}
      <button class="btn block" data-act="more.viewDay" data-date="${date}">${icon('today')}<span>View in Today</span></button>
      <label class="lbl" for="hist-note">Day note</label>
      <textarea class="input" id="hist-note" rows="2" data-input="more.dayNote" data-date="${date}">${esc(d.note || '')}</textarea>
      <pre class="log" id="hist-report">${esc(reportFor(date))}</pre>
      <button class="btn block primary big" data-act="more.copyReport" data-date="${date}">${icon('copy')}<span>Copy report</span></button>`;
  });
});

act('more.viewDay', (el) => {
  closeSheet(true);
  setViewDate(el.dataset.date);
  App.go('today', { scrollTop: true });
});

// ---------- render ----------

export function render() {
  const date = todayKey();
  return `${reportCard(date)}${inboxCard()}${calendarCard(date)}${backupCard()}${settingsCard()}${historyCard()}
    <p class="muted small center pad">Day OS ${APP_VERSION} · works offline · data stays on this phone</p>`;
}
