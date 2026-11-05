// End-to-end test in headless Chromium with iPhone emulation and a mocked clock.
// Run: node tests/e2e.mjs   (screenshots go to $SHOTS or a temp folder)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { serve } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'dayos-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const TZ = '-05:00'; // America/New_York in November
const T = (hm) => new Date(`2026-11-05T${hm}:00${TZ}`);

const server = await serve(0);
const BASE = `http://127.0.0.1:${server.address().port}/day-os/`;
const browser = await chromium.launch();
const { defaultBrowserType, ...iphone } = devices['iPhone 13'];
const ctx = await browser.newContext({ ...iphone, timezoneId: 'America/New_York', permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let step = 0;
const results = [];
async function shot(name, opts = {}) {
  step++;
  const file = path.join(SHOTS, `${String(step).padStart(2, '0')}-${name}.png`);
  await page.waitForTimeout(150);
  await page.screenshot({ path: file, ...opts });
  return file;
}
async function check(name, fn) {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').slice(0, 6).join('\n')]);
  }
}
const tap = (sel) => page.locator(sel).first().click();
const clip = () => page.evaluate(() => navigator.clipboard.readText());
const store = (key) => page.evaluate((k) => JSON.parse(localStorage.getItem('dayos.' + k)), key);
async function at(hm) {
  await page.clock.setSystemTime(T(hm));
  await page.waitForTimeout(400); // let the 250 ms tick re-render
}
async function pasteCode(text) {
  await tap('.paste-btn');
  await page.fill('#paste-text', text);
  await tap('[data-act="paste.check"]');
}

await page.clock.install({ time: T('06:00') });
await page.goto(BASE);
await page.waitForSelector('.tabbar .tab');

// ---------- empty state + invalid codes ----------
await check('empty state says No plan yet', async () => {
  assert.match(await page.textContent('#main'), /No plan yet\.\s*Paste today's day code\./);
});
await shot('now-empty');

await check('invalid JSON shows where and why', async () => {
  await pasteCode('{\n  "v": 1,\n  "type": "day"\n  "date": "2026-11-05"\n}');
  const t = await page.textContent('.err');
  assert.match(t, /not valid JSON/);
  assert.match(t, /comma missing/);
  assert.match(t, /line 4/);
  assert.match(t, /Nothing was changed/);
});
await shot('paste-error-json');
await check('unknown type and bad fields', async () => {
  await page.fill('#paste-text', '{"v":1,"type":"week"}');
  await tap('[data-act="paste.check"]');
  assert.match(await page.textContent('.err'), /Unknown type "week"/);
  await page.fill('#paste-text', JSON.stringify({ v: 1, type: 'day', date: '2026-11-05', blocks: [{ id: 'b1', start: '3pm', end: '16:00', kind: 'nap', title: 'X' }] }));
  await tap('[data-act="paste.check"]');
  const t = await page.textContent('.err');
  assert.match(t, /start "3pm" must be a 24h time/);
  assert.match(t, /kind "nap" must be one of/);
  await page.fill('#paste-text', 'hello');
  await tap('[data-act="paste.check"]');
  assert.match(await page.textContent('.err'), /not valid JSON/);
});
await shot('paste-error-fields');
await tap('[data-act="sheet.close"]');
await check('bad paste changed nothing', async () => {
  assert.equal(await store('day.2026-11-05'), null);
});

// ---------- tracker example ----------
await tap('.paste-btn');
await tap('[data-act="paste.loadExample"][data-kind="tracker"]');
await shot('paste-preview-tracker');
await tap('[data-act="paste.apply"]');
await page.waitForTimeout(300);
await check('tracker merged and shown', async () => {
  const t = await store('tracker');
  assert.equal(t.items.length, 10);
  assert.equal(await page.locator('.card.trk').count() >= 2, true);
});
await tap('[data-act="trk.cat"][data-cat="college"]');
await shot('tracker-colleges');
await tap('[data-act="trk.cat"][data-cat="test"]');
await shot('tracker-tests');
await tap('[data-act="trk.cat"][data-cat="assignment"]');
await check('assignment colours: overdue red, 7 days yellow', async () => {
  assert.equal(await page.locator('.card.trk.u-red').count(), 2); // overdue lab + calc due tomorrow
  assert.equal(await page.locator('.card.trk.u-yellow').count(), 1); // essay in 7 days
});
await shot('tracker-assignments');
await tap('[data-act="trk.cat"][data-cat="other"]');
await shot('tracker-other');

// ---------- day example ----------
await tap('.paste-btn');
await tap('[data-act="paste.loadExample"][data-kind="day"]');
await shot('paste-preview-day');
await tap('[data-act="paste.apply"]');
await page.waitForTimeout(300);
await check('day plan saved, Now shows next block before 6:30', async () => {
  const d = await store('day.2026-11-05');
  assert.equal(d.plan.blocks.length, 13);
  assert.match(await page.textContent('.hero'), /Next:\s*Wake up, breakfast, hip routine/);
});
await shot('now-0600-before-day');

await check('pasting the same date asks before replacing', async () => {
  await tap('.paste-btn');
  await tap('[data-act="paste.loadExample"][data-kind="day"]');
  assert.match(await page.textContent('.warnbox'), /already have a plan/);
  assert.equal((await page.textContent('[data-act="paste.apply"]')).trim(), 'Replace plan');
});
await shot('paste-replace-warning');
await tap('[data-act="paste.back"]');
await tap('[data-act="sheet.close"]');

await at('06:45');
await check('06:45 current block is wake up', async () => {
  assert.match(await page.textContent('.hero-title'), /Wake up/);
  assert.match(await page.textContent('.upnext'), /Leave for school/);
});
await shot('now-0645');
await tap('.hero [data-act="blk.done"]');
await page.waitForTimeout(200);
await check('Done marks block and offers undo', async () => {
  const d = await store('day.2026-11-05');
  assert.equal(d.plan.blocks.find((b) => b.id === 'b1')._state, 'done');
  assert.match(await page.textContent('#toast'), /Undo/);
});
await tap('[data-act="top3.toggle"][data-i="0"]');

await at('10:00');
await shot('now-1000-school');

await at('15:20');
await check('15:20 focus block with tasks and focus timer', async () => {
  assert.match(await page.textContent('.hero-title'), /UMass supplement/);
  assert.equal(await page.locator('.hero .chk').count(), 3);
  assert.equal(await page.locator('.hero .focus').count(), 1);
  assert.match(await page.textContent('.strip'), /UMass Amherst|UMass EA/);
});
await tap('[data-act="focus.toggle"]');
await page.waitForTimeout(1200);
await page.locator('.hero .focus').scrollIntoViewIfNeeded();
await shot('now-1520-focus');
await page.evaluate(() => window.scrollTo(0, 0));
await check('running late +15 shifts remaining blocks and logs it', async () => {
  await tap('[data-act="now.late"]');
  await shot('now-running-late');
  await tap('[data-act="now.lateBy"][data-m="15"]');
  await page.waitForTimeout(200);
  const d = await store('day.2026-11-05');
  const g = (id) => d.plan.blocks.find((b) => b.id === id);
  assert.equal(g('b6').start, '15:15');
  assert.equal(g('b7').start, '16:25');
  assert.equal(g('b1').start, '06:30');
  assert.equal(g('b5').start, '14:35');
  assert.deepEqual(d.changes.at(-1), { t: '15:20', text: 'running late +15 min' });
});

// complete the tracker-linked block
await at('16:05');
await check('complete a block linked to a tracker item', async () => {
  for (const i of [0, 1, 2]) await tap(`.hero [data-act="blk.task"][data-i="${i}"]`);
  await tap('.hero [data-act="blk.done"]');
  await page.waitForSelector('.sheet');
  assert.match(await page.textContent('.sheet'), /Mark the tracker item done too\?/);
  await shot('tracker-done-prompt');
  await tap('.sheet .btn.primary');
  await page.waitForTimeout(200);
  const t = await store('tracker');
  assert.equal(t.items.find((i) => i.id === 'umass').status, 'done');
  const d = await store('day.2026-11-05');
  assert.equal(d.trackerLog.at(-1).to, 'done');
});

// ---------- patch ----------
await check('example patch previews and applies', async () => {
  await tap('.paste-btn');
  await tap('[data-act="paste.loadExample"][data-kind="patch"]');
  assert.equal(await page.locator('.op.ok').count(), 6);
  await shot('paste-preview-patch');
  await tap('[data-act="paste.apply"]');
  await page.waitForTimeout(200);
  const d = await store('day.2026-11-05');
  assert.equal(d.plan.blocks.find((b) => b.id === 'b7').start, '16:30');
  assert.ok(d.plan.blocks.find((b) => b.id === 'b14'));
  assert.ok(d.changes.some((c) => c.text === 'patch: moved b7 to 16:30'));
});
await check('patch with a bad op applies the rest and lists failures', async () => {
  await pasteCode(JSON.stringify({ v: 1, type: 'patch', date: '2026-11-05', ops: [{ op: 'remove', id: 'b99' }, { op: 'update', id: 'b10', set: { title: 'Pack bag + lunch' } }] }));
  assert.equal(await page.locator('.op.bad').count(), 1);
  assert.match(await page.textContent('.op.bad'), /no block with id "b99"/);
  await tap('[data-act="paste.apply"]');
  await page.waitForTimeout(200);
  assert.match(await page.textContent('.sheet'), /Applied 1 of 2 changes/);
  await shot('patch-result-failures');
  await tap('[data-act="paste.done"]');
  const d = await store('day.2026-11-05');
  assert.equal(d.plan.blocks.find((b) => b.id === 'b10').title, 'Pack bag + lunch');
});

await check('heads-up banner + sound before next block', async () => {
  await at('16:26');
  await page.waitForTimeout(300);
  assert.match(await page.textContent('#banners'), /Heads-up: Push 1 starts at 16:30/);
  const beeps = await page.evaluate(() => window.DayOS.beepLog.map((b) => b.kind));
  assert.ok(beeps.includes('headsup'));
});
await shot('now-headsup');

// ---------- inbox ----------
await check('jot something down from the + button', async () => {
  await tap('#fab');
  await page.fill('#jot-input', 'ask Kumar about vocab quiz');
  await shot('jot-sheet');
  await tap('[data-act="jot.save"]');
  const inbox = await store('inbox');
  assert.equal(inbox[0].text, 'ask Kumar about vocab quiz');
});

// ---------- Today ----------
await tap('.tab[data-tab="today"]');
await page.waitForTimeout(200);
await check('today timeline shows states and the current-time line', async () => {
  assert.equal(await page.locator('.tl-block').count(), 14);
  assert.equal(await page.locator('.now-line').count(), 1);
  assert.ok((await page.locator('.tl-block.st-done').count()) >= 2);
});
await shot('today-timeline');
await page.locator('.now-line').scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, -200));
await shot('today-now-line');
await tap('.tl-block[data-id="b14"]');
await shot('today-block-sheet');
await tap('.sheet [data-act="blk.moved"]');
await tap('[data-act="sheet.close"]');
await tap('[data-act="today.shift"][data-n="1"]');
await shot('today-tomorrow-empty');
await tap('[data-act="today.shift"][data-n="0"]');

// ---------- workout from the day block ----------
await tap('.tab[data-tab="now"]');
await at('16:31');
await check('workout block on Now starts the workout flow', async () => {
  assert.match(await page.textContent('.hero'), /Start workout: Push 1/);
  await shot('now-workout-block');
  await tap('.hero [data-act="blk.workout"]');
  await page.waitForTimeout(200);
  assert.match(await page.textContent('#main'), /Workout preview/);
  assert.match(await page.textContent('.stats3'), /8\s*exercises\s*25\s*total sets/);
});
await shot('workout-preview');
await tap('[data-act="wo.start"]');
await check('warm-up checklist', async () => {
  assert.match(await page.textContent('#main'), /Warm-up/);
  await tap('[data-act="wo.wu"][data-i="0"]');
});
await shot('workout-warmup');
await tap('[data-act="wo.wuDone"] >> nth=1');
await page.waitForTimeout(200);
await shot('workout-a-start');

const row = (b, e, r) => `.set[data-b="${b}"][data-e="${e}"][data-r="${r}"]`;
const checkSet = (b, e, r) => tap(`${row(b, e, r)} [data-act="wo.check"]`);
await check('superset: A1 -> A2 without rest, then rest with next-up', async () => {
  assert.equal(await page.inputValue(`${row(0, 0, 0)} input[data-f="w"]`), '40');
  assert.equal(await page.inputValue(`${row(0, 0, 0)} input[data-f="r"]`), '10');
  await checkSet(0, 0, 0);
  assert.equal(await page.locator('.timer-panel.rest').count(), 0);
  assert.equal(await page.locator(`${row(0, 1, 0)}.cur`).count(), 1);
  await checkSet(0, 1, 0);
  assert.equal(await page.locator('.timer-panel.rest').count(), 1);
  assert.match(await page.textContent('.timer-panel'), /Next up: A1 set 2, 40 lb x 10/);
  assert.match(await page.textContent('.tp-digits'), /1:1[45]/);
});
await shot('workout-rest');
await check('rest -15 / +15', async () => {
  const s0 = (await store('workout.active')).rest.endsAt;
  await tap('[data-act="wo.rest"][data-d="15"]');
  const s1 = (await store('workout.active')).rest.endsAt;
  assert.equal(s1 - s0, 15000);
  await tap('[data-act="wo.rest"][data-d="-15"]');
  await tap('[data-act="wo.rest"][data-d="-15"]');
  assert.equal((await store('workout.active')).rest.endsAt - s0, -15000);
});
await check('reload mid-rest resumes exactly where it was', async () => {
  const before = await store('workout.active');
  await page.reload();
  await page.waitForSelector('.timer-panel.rest');
  const after = await store('workout.active');
  assert.equal(after.rest.endsAt, before.rest.endsAt);
  assert.deepEqual(after.cur, before.cur);
});
await check('rest ends with 3 beeps after the phone was locked', async () => {
  await page.evaluate(() => (window.DayOS.beepLog.length = 0));
  await page.clock.runFor(61000);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.timer-panel.rest').count(), 0);
  const beeps = await page.evaluate(() => window.DayOS.beepLog.map((b) => b.kind));
  assert.ok(beeps.includes('rest'), JSON.stringify(beeps));
});
await shot('workout-go');
await check('changed weight carries to later sets; tags and note', async () => {
  await page.fill(`${row(0, 0, 1)} input[data-f="w"]`, '45');
  await page.fill(`${row(0, 0, 1)} input[data-f="r"]`, '9');
  await checkSet(0, 0, 1);
  assert.equal(await page.inputValue(`${row(0, 0, 2)} input[data-f="w"]`), '45');
  await tap('[data-act="wo.tag"][data-b="0"][data-e="0"][data-t="Just right"]');
  await tap('[data-act="wo.ed"][data-b="0"][data-e="0"][data-k="note"]');
  await page.fill('#ex-note', 'felt strong');
  await tap('[data-act="wo.noteSave"]');
  await tap('[data-act="wo.tag"][data-b="0"][data-e="1"][data-t="Too easy"]');
});
await check('log the rest of block A, skipping rests', async () => {
  for (const [e, r] of [[1, 1], [0, 2], [1, 2], [0, 3], [1, 3]]) {
    await checkSet(0, e, r);
    if (await page.locator('[data-act="wo.restSkip"]').count()) await tap('[data-act="wo.restSkip"]');
  }
  assert.equal(await page.locator('.chip.done').count(), 1);
});
await shot('workout-b-block');
await check('bodyweight sets and swap (asks for the name in-page)', async () => {
  await checkSet(1, 0, 0);
  await tap('[data-act="wo.ed"][data-b="1"][data-e="1"][data-k="swap"]');
  await page.fill('#ex-swap', 'Rear delt flyes');
  await shot('workout-swap');
  await tap('[data-act="wo.swapSave"]');
  assert.match(await page.textContent('#ex-1-1'), /Rear delt flyes/);
  await page.fill(`${row(1, 1, 0)} input[data-f="w"]`, '10');
  await checkSet(1, 1, 0);
  for (const [e, r] of [[0, 1], [1, 1], [0, 2], [1, 2]]) {
    if (await page.locator('[data-act="wo.restSkip"]').count()) await tap('[data-act="wo.restSkip"]');
    await checkSet(1, e, r);
  }
  if (await page.locator('[data-act="wo.restSkip"]').count()) await tap('[data-act="wo.restSkip"]');
});
await check('find-your-weight exercise needs a weight before logging', async () => {
  assert.equal(await page.inputValue(`${row(2, 0, 0)} input[data-f="w"]`), '');
  await checkSet(2, 0, 0);
  assert.match(await page.textContent('#toast'), /Enter the weight you used/);
  await shot('workout-find-weight');
  await page.fill(`${row(2, 0, 0)} input[data-f="w"]`, '25');
  await checkSet(2, 0, 0);
  assert.equal(await page.inputValue(`${row(2, 0, 1)} input[data-f="w"]`), '25');
});
await check('timed hold each side counts down, beeps, logs seconds', async () => {
  await page.evaluate(() => (window.DayOS.beepLog.length = 0));
  await tap(`${row(2, 1, 0)} [data-act="wo.hold"]`);
  assert.match(await page.textContent('.timer-panel.hold'), /Side 1 of 2/);
  await page.clock.runFor(10000);
  await shot('workout-hold');
  await page.clock.runFor(36000); // side 1 done -> switch
  await page.waitForTimeout(300);
  assert.match(await page.textContent('.timer-panel'), /Switch sides/);
  await page.clock.runFor(5500); // side 2 starts
  await page.waitForTimeout(300);
  assert.match(await page.textContent('.timer-panel'), /Side 2 of 2/);
  await page.clock.runFor(46000);
  await page.waitForTimeout(400);
  const s = await store('workout.active');
  assert.equal(s.ex[2][1].sets[0].done, true);
  assert.equal(s.ex[2][1].sets[0].r, '45');
  const beeps = await page.evaluate(() => window.DayOS.beepLog.map((b) => b.kind));
  assert.ok(beeps.filter((b) => b === 'one').length >= 3, JSON.stringify(beeps));
});
await check('log remaining C sets (typing hold seconds by hand)', async () => {
  if (await page.locator('[data-act="wo.restSkip"]').count()) await tap('[data-act="wo.restSkip"]');
  await checkSet(2, 0, 1);
  await page.fill(`${row(2, 1, 1)} input[data-f="r"]`, '40');
  await checkSet(2, 1, 1);
  if (await page.locator('[data-act="wo.restSkip"]').count()) await tap('[data-act="wo.restSkip"]');
  await checkSet(2, 0, 2);
  await page.fill(`${row(2, 1, 2)} input[data-f="r"]`, '35');
  await checkSet(2, 1, 2);
  if (await page.locator('[data-act="wo.restSkip"]').count()) await tap('[data-act="wo.restSkip"]');
});
await check('skip exercise and jump to a set', async () => {
  await tap('[data-act="wo.skip"][data-b="3"][data-e="0"]');
  assert.match(await page.textContent('#ex-3-0'), /Skipped/);
  await checkSet(3, 1, 0);
  if (await page.locator('[data-act="wo.restSkip"]').count()) await tap('[data-act="wo.restSkip"]');
  await tap('[data-act="wo.block"][data-b="0"]');
  await tap(`${row(0, 0, 0)} .set-n`);
  assert.equal(await page.locator(`${row(0, 0, 0)}.cur`).count(), 1);
  await tap('[data-act="wo.block"][data-b="3"]');
});
await shot('workout-d-block');
await check('finish: stats, rating, bodyweight, note, log format', async () => {
  await page.clock.setSystemTime(T('17:29'));
  await tap('[data-act="wo.finishAsk"]');
  assert.match(await page.textContent('.sheet'), /1 set not logged/);
  await tap('.sheet .btn.primary');
  await page.waitForTimeout(200);
  assert.match(await page.textContent('#main'), /Push 1 done/);
  await tap('[data-act="wo.feel"][data-v="4"]');
  await page.fill('#wo-bw', '152');
  await page.fill('#wo-note', 'hip felt fine');
  await shot('workout-finish');
  await tap('[data-act="wo.copyLog"]');
  const log = await clip();
  const lines = log.split('\n');
  assert.equal(lines[0], 'LIFT LOG v1');
  assert.match(lines[1], /^Session: Push 1 \| Date: 2026-11-05 \| Week: 1 \| Duration: \d+ min \| Feel: 4\/5 \| Bodyweight: 152 lb$/);
  assert.equal(lines[2], 'A1 Flat DB bench press [target 4x6-10 @40]: 40x10, 45x9, 45x10, 45x10 | tag: just right | note: felt strong');
  assert.equal(lines[3], 'A2 Lateral raises [target 4x12-20 @15]: 15x20, 15x20, 15x20, 15x20 | tag: too easy');
  assert.equal(lines[4], 'B1 Feet-elevated push-ups [target 3x8-15 @bodyweight]: BWx15, BWx15, BWx15');
  assert.equal(lines[5], 'C1 Seated DB Arnold press [target 3x8-12]: 25x12, 25x12, 25x12');
  assert.equal(lines[6], 'C2 Side plank [target 3x30-45s] (each side): 45s, 40s, 35s');
  assert.equal(lines[7], 'D2 Dead bug [target 2x6-8 @bodyweight] (each side): BWx8, -');
  assert.equal(lines[8], 'SKIPPED: D1 Band triceps pushdown');
  assert.equal(lines[9], 'SWAPPED: B2 Band pull-aparts -> Rear delt flyes: 10x20, 10x20, 10x20');
  assert.equal(lines[10], 'Session note: hip felt fine');
  assert.equal(lines.length, 11);
});
await check('finishing marks the day block done and saves history', async () => {
  await tap('[data-act="wo.close"]');
  const d = await store('day.2026-11-05');
  assert.equal(d.plan.blocks.find((b) => b.id === 'b7')._state, 'done');
  const h = await store('workout.history');
  assert.equal(h.length, 1);
  assert.match(await page.textContent('#main'), /History/);
});
await shot('workout-home-history');

// ---------- report ----------
await tap('.tab[data-tab="more"]');
await check('end-of-day report matches the spec', async () => {
  await page.fill('#day-note', 'tired after school');
  await tap('[data-act="more.toggleReport"]');
  await shot('more-report');
  await tap('[data-act="more.copyReport"]');
  const r = await clip();
  const parts = r.split('\n\nLIFT LOG v1\n');
  assert.equal(parts.length, 2, 'lift log appended after a blank line');
  const L = parts[0].split('\n');
  assert.equal(L[0], 'DAY OS REPORT v1');
  assert.equal(L[1], 'Date: 2026-11-05 | Top 3: 1/3 done');
  assert.equal(L[2], 'TOP 3: [x] Submit UMass EA | [ ] Calc HWK 30 | [ ] Push 1');
  assert.equal(L[3], 'BLOCKS:');
  assert.ok(L.includes('[done] 06:30-07:25 Wake up, breakfast, hip routine'));
  assert.ok(L.includes('[done] 15:15-16:20 UMass supplement | tasks 3/3'), L.join('\n'));
  assert.ok(L.includes('[done] 16:30-17:30 Push 1'));
  assert.ok(L.includes('[moved to tomorrow] 19:00-19:30 APES notes | open tasks: Read ch. 4'));
  assert.ok(L.includes('[not marked] 17:40-18:25 Calc HWK 30 | open tasks: Problems 1-20, Check answers, Review notes'), L.join('\n'));
  const ci = L.indexOf('CHANGES:');
  assert.equal(L[ci + 1], '15:20 running late +15 min');
  assert.equal(L[ci + 2], '16:05 patch: resized b6 to 15:15-16:20');
  assert.ok(L.includes('16:05 patch: moved b7 to 16:30'));
  assert.ok(L.includes('16:05 patch: updated b10 (title)'));
  const ti = L.indexOf('TRACKER:');
  assert.equal(L[ti + 1], 'umass: status -> done');
  const ii = L.indexOf('INBOX:');
  assert.equal(L[ii + 1], '- ask Kumar about vocab quiz');
  assert.equal(L.at(-1), 'DAY NOTE: tired after school');
  assert.ok(L.every((l) => !/\d:\d\d-/.test(l) || /\b\d\d:\d\d-\d\d:\d\d\b/.test(l)), '24h HH:MM');
  const d = await store('day.2026-11-05');
  assert.ok(d.reportCopiedAt);
});

// ---------- calendar ----------
await check('ics download and copy', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), tap('[data-act="more.icsDownload"]')]);
  assert.equal(dl.suggestedFilename(), 'day-os-2026-11-05.ics');
  const p = await dl.path();
  const ics = fs.readFileSync(p, 'utf8');
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /TRIGGER:-PT5M/);
  await tap('[data-act="more.icsCopy"]');
  assert.match(await clip(), /BEGIN:VEVENT/);
});

// ---------- backup / restore ----------
await check('backup then restore brings everything back', async () => {
  await tap('[data-act="more.backupCopy"]');
  const backup = await clip();
  const obj = JSON.parse(backup);
  assert.equal(obj.type, 'backup');
  // wreck some data
  await page.evaluate(() => {
    localStorage.setItem('dayos.inbox', '[]');
    localStorage.setItem('dayos.tracker', '{"items":[]}');
  });
  await page.reload();
  await page.waitForSelector('.tabbar .tab');
  await tap('[data-act="more.restoreToggle"]');
  await page.fill('[data-input="more.restoreText"]', '{"oops": true}');
  await tap('[data-act="more.restoreCheck"]');
  assert.match(await page.textContent('.restore .err'), /not a Day OS backup/);
  await page.fill('[data-input="more.restoreText"]', backup);
  await tap('[data-act="more.restoreCheck"]');
  assert.match(await page.textContent('.warnbox'), /Replace all data/);
  await shot('more-restore-confirm');
  await tap('[data-act="more.restoreGo"]');
  await page.waitForTimeout(200);
  assert.equal((await store('tracker')).items.length, 10);
  assert.equal((await store('inbox')).length, 1);
});
await page.evaluate(() => window.scrollTo(0, 0));
await shot('more-top');
await page.locator('text=Settings').first().scrollIntoViewIfNeeded();
await shot('more-settings');
await page.locator('h3:has-text("History")').first().scrollIntoViewIfNeeded();
await shot('more-history');

// ---------- tracker detail ----------
await tap('.tab[data-tab="tracker"]');
await tap('[data-act="trk.cat"][data-cat="college"]');
await shot('tracker-completed-section');
await check('tracker detail: subtasks, status, notes', async () => {
  await tap('.card.trk[data-id="cu-boulder"]');
  await tap('.sheet [data-act="trk.sub"][data-i="0"]');
  await tap('.sheet [data-act="trk.status"][data-s="in_progress"]');
  await page.fill('.sheet textarea', 'Ask counselor for rec');
  await shot('tracker-detail');
  await tap('[data-act="sheet.close"]');
  const t = await store('tracker');
  const it = t.items.find((i) => i.id === 'cu-boulder');
  assert.equal(it.subtasks[0].done, true);
  assert.equal(it.status, 'in_progress');
  assert.equal(it.notes, 'Ask counselor for rec');
});

// ---------- evening ----------
await tap('.tab[data-tab="now"]');
await at('21:50');
await check('wind-down banner from 9:45 PM', async () => {
  assert.match(await page.textContent('.banner.wind'), /Wind down\./);
});
await shot('now-2150-wind-down');

// ---------- standalone workout + workout tab ----------
await tap('.tab[data-tab="workout"]');
await check('standalone workout paste validates', async () => {
  await page.fill('[data-input="wo.pasteText"]', '{"v":1,"type":"workout","session":"X","blocks":[]}');
  await tap('[data-act="wo.load"]');
  assert.match(await page.textContent('#main .err'), /missing "blocks"/);
  await tap('[data-act="wo.example"]');
  assert.match(await page.textContent('#main'), /Workout preview/);
  await tap('[data-act="wo.discard"]');
});

// ---------- offline ----------
await check('works offline after first load (service worker)', async () => {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('.tabbar .tab', { timeout: 5000 });
  assert.match(await page.textContent('#hdr-title'), /Now|Today|Tracker|Workout|More/);
  await ctx.setOffline(false);
});

// ---------- small phone layout ----------
const { defaultBrowserType: _d, ...seDev } = devices['iPhone SE'];
const se = await browser.newContext({ ...seDev, timezoneId: 'America/New_York' });
const p2 = await se.newPage();
p2.on('pageerror', (e) => errors.push('SE: ' + e.message));
await p2.clock.install({ time: T('16:35') });
await p2.goto(BASE);
await p2.evaluate(async (data) => {
  for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
}, await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]))));
await p2.reload();
await p2.waitForSelector('.tabbar .tab');
await check('no horizontal overflow on a 320px-wide phone (iPhone SE 1st gen)', async () => {
  for (const tab of ['now', 'today', 'tracker', 'workout', 'more']) {
    await p2.locator(`.tab[data-tab="${tab}"]`).click();
    await p2.waitForTimeout(150);
    const [w, vw] = await p2.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert.ok(w <= vw, `${tab} scrollWidth ${w} > ${vw}`);
    step++;
    await p2.screenshot({ path: path.join(SHOTS, `${String(step).padStart(2, '0')}-se-${tab}.png`) });
  }
  await p2.locator('.tab[data-tab="workout"]').click();
  await p2.locator('[data-act="wo.example"]').click();
  await p2.locator('[data-act="wo.start"]').click();
  await p2.locator('[data-act="wo.wuDone"]').first().click();
  await p2.waitForTimeout(150);
  const [w, vw] = await p2.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(w <= vw, `workout scrollWidth ${w} > ${vw}`);
  step++;
  await p2.screenshot({ path: path.join(SHOTS, `${String(step).padStart(2, '0')}-se-workout-active.png`) });
  await p2.locator('.set[data-b="0"][data-e="0"][data-r="0"] .check').click();
  await p2.locator('.set[data-b="0"][data-e="1"][data-r="0"] .check').click();
  await p2.waitForTimeout(600);
  assert.equal(await p2.locator('.timer-panel.rest').isVisible(), true);
  step++;
  await p2.screenshot({ path: path.join(SHOTS, `${String(step).padStart(2, '0')}-se-workout-rest.png`) });
});

await check('no page errors', async () => {
  assert.deepEqual(errors, []);
});

await browser.close();
server.close();

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2].replace(/\n/g, '\n    ') : '');
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed. Screenshots: ${SHOTS}`);
process.exit(failed ? 1 : 0);
