// Unit tests for parsers, patch ops and both output formats.
// Run: node --test tests/unit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCode, cleanText, locateJsonError } from '../js/codes.js';
import { applyPatch, installPlan, runLate, nowContext, buildICS, span, validateDay } from '../js/planner.js';
import { applyTrackerCode, summarizeLog, urgency, dueShort, upcomingDeadlines, validateTrackerCode } from '../js/tracker.js';
import * as W from '../js/workout.js';
import { buildDayReport } from '../js/report.js';
import { exampleDay, examplePatch, exampleTracker, exampleWorkout } from '../js/examples.js';
import * as store from '../js/storage.js';
import { newDay } from '../js/storage.js';
import { tsAt, toMin } from '../js/util.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const D = '2026-11-05';
const at = (hm) => tsAt(D, toMin(hm));

function dayWithExample() {
  const r = parseCode(JSON.stringify(exampleDay(D)));
  assert.equal(r.ok, true, r.errors && r.errors.join('\n'));
  return installPlan(newDay(D), r.value, at('06:00'));
}

// ---------- parsing ----------

test('detects each code type', () => {
  assert.equal(parseCode(JSON.stringify(exampleDay(D))).type, 'day');
  assert.equal(parseCode(JSON.stringify(examplePatch(D))).type, 'patch');
  assert.equal(parseCode(JSON.stringify(exampleTracker(D))).type, 'tracker');
  assert.equal(parseCode(JSON.stringify(exampleWorkout(D))).type, 'workout');
  for (const f of [exampleDay, examplePatch, exampleTracker, exampleWorkout]) {
    const r = parseCode(JSON.stringify(f(D)));
    assert.equal(r.ok, true, r.errors && r.errors.join('\n'));
  }
});

test('clear errors for bad input', () => {
  assert.match(parseCode('').errors[0], /Nothing pasted/);
  assert.match(parseCode('{"v":1}').errors[0], /Missing "type"/);
  assert.match(parseCode('{"type":"week"}').errors[0], /Unknown type "week"/);
  assert.match(parseCode('{"type":"day","v":2}').errors[0], /Unsupported version/);
  const cut = JSON.stringify(exampleDay(D)).slice(0, 200);
  assert.match(parseCode(cut).errors[0], /ends too early/);
  const missingComma = '{\n "type": "day"\n "date": "2026-11-05"\n}';
  const e = parseCode(missingComma).errors[0];
  assert.match(e, /comma missing/);
  assert.match(e, /line 3/);
  const bad = parseCode(JSON.stringify({ v: 1, type: 'day', date: '2026-11-05', blocks: [{ id: 'b1', start: '3pm', end: '16:00', kind: 'nap', title: 'x' }] }));
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((x) => /start "3pm" must be a 24h time/.test(x)));
  assert.ok(bad.errors.some((x) => /kind "nap" must be one of/.test(x)));
  assert.match(parseCode('{"app":"day-os","type":"backup","v":1,"data":{}}').errors[0], /backup/);
});

test('cleans smart quotes and code fences', () => {
  const smart = '```json\n{\u201Cv\u201D: 1, \u201Ctype\u201D: \u201Cpatch\u201D, \u201Cdate\u201D: \u201C2026-11-05\u201D, \u201Cops\u201D: [{\u201Cop\u201D:\u201Cremove\u201D,\u201Cid\u201D:\u201Cb1\u201D}]}\n```';
  const r = parseCode(smart);
  assert.equal(r.ok, true, r.errors && r.errors.join('\n'));
  assert.equal(r.type, 'patch');
  assert.equal(cleanText('here you go: {"a":1} thanks'), '{"a":1}');
  assert.equal(locateJsonError('{"a":1}'), null);
});

test('day code: duplicate ids and missing fields', () => {
  const r = validateDay({ v: 1, type: 'day', date: D, blocks: [
    { id: 'a', start: '06:00', end: '07:00', kind: 'routine', title: 'x' },
    { id: 'a', start: '07:00', end: '08:00', kind: 'routine', title: 'y' },
    { id: 'c', start: '08:00', end: '09:00', kind: 'routine' },
  ] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /used twice/.test(e)));
  assert.ok(r.errors.some((e) => /missing "title"/.test(e)));
});

test('overnight block spans midnight', () => {
  assert.deepEqual(span({ start: '22:15', end: '06:30' }), { s: 1335, e: 1830 });
});

// ---------- patch ops ----------

test('patch ops apply in order, failures skipped and reported, changes logged', () => {
  const day = dayWithExample();
  const tracker = applyTrackerCode({ items: [] }, parseCode(JSON.stringify(exampleTracker(D))).value).tracker;
  const patch = {
    v: 1, type: 'patch', date: D,
    ops: [
      { op: 'move', id: 'b7', start: '17:30' },
      { op: 'resize', id: 'b6', end: '16:20' },
      { op: 'add', block: { id: 'b20', start: '19:00', end: '19:30', kind: 'focus', title: 'APES notes' } },
      { op: 'remove', id: 'b99' },
      { op: 'update', id: 'b6', set: { title: 'UMass supplement + submit', tasks: ['Submit'] } },
      { op: 'shiftAfter', time: '18:00', minutes: 20 },
      { op: 'trackerAdd', item: { id: 'new1', cat: 'test', title: 'Spanish quiz', due: '2026-11-09' } },
      { op: 'trackerUpdate', id: 'umass', set: { status: 'submitted' } },
      { op: 'trackerRemove', id: 'old-item' },
      { op: 'teleport', id: 'b1' },
    ],
  };
  const res = applyPatch(day, tracker, patch, at('16:05'));
  const fails = res.results.filter((r) => !r.ok);
  assert.deepEqual(fails.map((f) => f.i), [3, 8, 9]);
  assert.match(fails[0].error, /no block with id "b99"/);
  assert.match(fails[2].error, /unknown op "teleport"/);
  const b7 = res.day.plan.blocks.find((b) => b.id === 'b7');
  assert.equal(b7.start, '17:30');
  assert.equal(b7.end, '18:30'); // move keeps duration... then shiftAfter 18:00 doesn't touch a 17:30 start
  const b6 = res.day.plan.blocks.find((b) => b.id === 'b6');
  assert.equal(b6.end, '16:20');
  assert.equal(b6.title, 'UMass supplement + submit');
  assert.deepEqual(b6.tasks, ['Submit']);
  const b9 = res.day.plan.blocks.find((b) => b.id === 'b9');
  assert.equal(b9.start, '18:35'); // 18:15 + 20
  const b13 = res.day.plan.blocks.find((b) => b.id === 'b13');
  assert.equal(b13.start, '22:35');
  assert.equal(b13.end, '06:50');
  assert.equal(res.tracker.items.find((i) => i.id === 'umass').status, 'submitted');
  assert.ok(res.tracker.items.find((i) => i.id === 'new1'));
  assert.equal(res.day.changes[0].t, '16:05');
  assert.equal(res.day.changes[0].text, 'patch: moved b7 to 17:30');
  assert.equal(res.day.changes.length, 7);
  // original untouched (preview is a dry run)
  assert.equal(day.plan.blocks.find((b) => b.id === 'b7').start, '16:10');
});

test('example patch applies cleanly', () => {
  const day = dayWithExample();
  const tracker = applyTrackerCode({ items: [] }, parseCode(JSON.stringify(exampleTracker(D))).value).tracker;
  const res = applyPatch(day, tracker, examplePatch(D), at('14:00'));
  assert.ok(res.results.every((r) => r.ok), JSON.stringify(res.results));
});

test('patch without a plan: block ops fail, tracker ops still apply', () => {
  const res = applyPatch(newDay(D), { items: [{ id: 'x', title: 'X', cat: 'other', status: 'not_started' }] }, {
    ops: [{ op: 'move', id: 'b1', start: '10:00' }, { op: 'trackerUpdate', id: 'x', set: { status: 'done' } }],
  }, at('09:00'));
  assert.equal(res.results[0].ok, false);
  assert.match(res.results[0].error, /no plan/);
  assert.equal(res.results[1].ok, true);
});

test('running late shifts remaining blocks only and logs it', () => {
  const day = dayWithExample();
  day.plan.blocks.find((b) => b.id === 'b1')._state = 'done';
  const n = runLate(day, 15, toMin('15:20'), at('15:20'));
  const get = (id) => day.plan.blocks.find((b) => b.id === id);
  assert.equal(get('b1').start, '06:30'); // done, untouched
  assert.equal(get('b5').start, '14:35'); // already ended, untouched
  assert.equal(get('b6').start, '15:15'); // current, shifted
  assert.equal(get('b7').start, '16:25');
  assert.ok(n >= 8);
  assert.deepEqual(day.changes.at(-1), { t: '15:20', text: 'running late +15 min' });
});

test('now context', () => {
  const day = dayWithExample();
  let c = nowContext(day, toMin('15:30'));
  assert.equal(c.current.id, 'b6');
  assert.equal(c.next.id, 'b7');
  c = nowContext(day, toMin('16:05'));
  assert.equal(c.current, null);
  assert.equal(c.next.id, 'b7');
  c = nowContext(day, toMin('23:00'));
  assert.equal(c.current.id, 'b13');
  c = nowContext(day, toMin('06:00'));
  assert.equal(c.next.id, 'b1');
});

test('day code replacement keeps marks for matching blocks', () => {
  const day = dayWithExample();
  day.plan.blocks.find((b) => b.id === 'b1')._state = 'done';
  day.top3[0] = true;
  const again = parseCode(JSON.stringify(exampleDay(D))).value;
  installPlan(day, again, at('12:00'));
  assert.equal(day.plan.blocks.find((b) => b.id === 'b1')._state, 'done');
  assert.equal(day.top3[0], true);
  assert.equal(day.changes.at(-1).text, 'day code replaced');
});

// ---------- tracker ----------

test('tracker merge, replace, colours, countdowns', () => {
  const code = validateTrackerCode(exampleTracker(D)).value;
  let t = applyTrackerCode({ items: [] }, code).tracker;
  assert.equal(t.items.length, 10);
  const upd = validateTrackerCode({ v: 1, type: 'tracker', mode: 'merge', items: [{ id: 'umass', status: 'submitted' }, { id: 'new', title: 'New', cat: 'other' }] }, t);
  assert.equal(upd.ok, true, upd.errors.join('\n'));
  const r = applyTrackerCode(t, upd.value);
  assert.deepEqual(r.added, ['new']);
  assert.equal(r.updated[0].id, 'umass');
  assert.equal(r.tracker.items.find((i) => i.id === 'umass').title, 'UMass Amherst');
  const bad = validateTrackerCode({ v: 1, type: 'tracker', mode: 'merge', items: [{ id: 'zz', status: 'nope' }] }, t);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /missing "title"/.test(e)));
  assert.ok(bad.errors.some((e) => /status "nope"/.test(e)));
  const rep = applyTrackerCode(t, { mode: 'replace', items: [{ id: 'only', title: 'Only', cat: 'other', status: 'not_started' }] });
  assert.equal(rep.tracker.items.length, 1);
  assert.equal(urgency({ due: '2026-11-04', status: 'in_progress' }, D), 'red');
  assert.equal(urgency({ due: '2026-11-08', status: 'in_progress' }, D), 'red');
  assert.equal(urgency({ due: '2026-11-12', status: 'in_progress' }, D), 'yellow');
  assert.equal(urgency({ due: '2026-11-13', status: 'in_progress' }, D), 'neutral');
  assert.equal(dueShort('2026-11-05', D), 'today');
  assert.equal(dueShort('2026-11-15', D), '10 days');
  assert.equal(dueShort('2026-11-06', D), 'tomorrow');
  assert.equal(dueShort('2026-11-03', D), '2 days overdue');
  const dl = upcomingDeadlines(exampleDay(D), t, D, 3);
  assert.equal(dl.length, 3);
  assert.equal(dl[0].due <= dl[1].due, true);
});

test('tracker log summary', () => {
  const lines = summarizeLog([
    { id: 'umass', k: 'sub', t: 'Submit', done: true },
    { id: 'umass', k: 'sub', t: 'Transcript sent', done: true },
    { id: 'umass', k: 'sub', t: 'Transcript sent', done: false },
    { id: 'umass', k: 'status', from: 'in_progress', to: 'done' },
    { id: 'umass', k: 'status', from: 'done', to: 'submitted' },
  ]);
  assert.deepEqual(lines, ['umass: "Submit" checked; status -> submitted']);
});

// ---------- workout engine ----------

function exampleSession() {
  const code = W.validateWorkout(exampleWorkout(D)).value;
  const s = W.newSession(code);
  W.startSession(s, at('16:10'));
  return s;
}

test('workout code validation', () => {
  const r = W.validateWorkout({ v: 1, type: 'workout', session: 'X', blocks: [{ exercises: [{ name: 'Squat', type: 'jump', sets: 0 }] }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /type "jump"/.test(e)));
  assert.ok(r.errors.some((e) => /"sets" must be/.test(e)));
  assert.ok(r.errors.some((e) => /missing "reps"/.test(e)));
  const code = W.validateWorkout(exampleWorkout(D)).value;
  assert.equal(W.countExercises(code), 8);
  assert.equal(W.countSets(code), 25);
  assert.ok(W.estimateMin(code) > 20);
  assert.equal(W.targetText(code.blocks[0].exercises[0]), '4 x 6-10 @ 40 lb/hand');
  assert.equal(W.targetText(code.blocks[2].exercises[1]), '3 x 30-45s each side');
  assert.equal(W.targetText(code.blocks[1].exercises[0]), '3 x 8-15 @ bodyweight');
});

test('superset flow: A1 -> A2 -> rest -> A1 set 2, sets differ from rounds', () => {
  const s = exampleSession();
  assert.equal(s.phase, 'warmup');
  W.endWarmup(s);
  assert.deepEqual(s.cur, { b: 0, e: 0, r: 0 });
  assert.equal(s.ex[0][0].sets[0].w, '40');
  assert.equal(s.ex[0][0].sets[0].r, '10');
  let ev = W.logSet(s, 0, 0, 0, at('16:15'));
  assert.equal(ev.rest, false);
  assert.deepEqual(s.cur, { b: 0, e: 1, r: 0 });
  ev = W.logSet(s, 0, 1, 0, at('16:16'));
  assert.equal(ev.rest, true);
  assert.equal(s.rest.endsAt - s.rest.startedAt, 75000);
  assert.deepEqual(s.cur, { b: 0, e: 0, r: 1 });
  assert.equal(W.setText(s, s.cur), 'A1 set 2, 40 lb x 10');
  // changed weight carries forward
  W.setValue(s, 0, 0, 1, 'w', '45');
  W.logSet(s, 0, 0, 1, at('16:18'));
  assert.equal(s.ex[0][0].sets[2].w, '45');
  // block D: D2 has 2 sets, D1 has 3
  const sl = W.slots(s).filter((x) => x.b === 3);
  assert.deepEqual(sl.map((x) => `${x.e}${x.r}`), ['00', '10', '01', '11', '02']);
});

test('rest timer adjust, skip, done event', () => {
  const s = exampleSession();
  W.endWarmup(s);
  W.logSet(s, 0, 0, 0, at('16:15'));
  W.logSet(s, 0, 1, 0, at('16:16'));
  const t0 = s.rest.endsAt;
  W.adjustRest(s, 15000, at('16:16'));
  assert.equal(s.rest.endsAt, t0 + 15000);
  W.adjustRest(s, -15000, at('16:16'));
  const ev = W.tickTimers(s, t0 + 500);
  assert.equal(ev[0].type, 'restDone');
  assert.equal(s.rest, null);
});

test('timed hold each side, logged as seconds', () => {
  const s = exampleSession();
  W.endWarmup(s);
  // jump to C2 set 1 (side plank, 30-45s each side)
  W.jumpTo(s, 2, 1, 0);
  const t0 = at('16:40');
  W.startHold(s, 2, 1, 0, t0);
  assert.equal(s.hold.target, 45);
  let ev = W.tickTimers(s, t0 + 45000);
  assert.equal(ev[0].type, 'holdSide');
  ev = W.tickTimers(s, t0 + 45000 + W.SWITCH_MS);
  assert.equal(ev[0].type, 'holdGo');
  // stop early on side 2 at 40 s
  const r = W.stopHold(s, t0 + 45000 + W.SWITCH_MS + 40000);
  assert.equal(r.type, 'holdDone');
  assert.equal(s.ex[2][1].sets[0].r, '40');
  assert.equal(s.ex[2][1].sets[0].done, true);
  assert.ok(s.rest); // end of round C -> rest
});

test('skip and swap', () => {
  const s = exampleSession();
  W.endWarmup(s);
  W.jumpTo(s, 3, 0, 0);
  W.skipExercise(s, 3, 0);
  assert.deepEqual(s.cur, { b: 3, e: 1, r: 0 });
  W.swapExercise(s, 1, 1, 'Rear delt flyes');
  assert.equal(s.ex[1][1].swap, 'Rear delt flyes');
  assert.equal(s.ex[1][1].sets[0].w, '');
});

test('LIFT LOG v1 format matches the spec', () => {
  const code = W.validateWorkout({
    v: 1, type: 'workout', session: 'Push 1', date: D, week: 1,
    blocks: [
      { label: 'A', rounds: 4, restSec: 75, exercises: [
        { id: 'db-bench', name: 'Flat DB bench press', type: 'reps', sets: 4, reps: '6-10', weight: 40, unit: 'lb', perHand: true },
        { id: 'lat', name: 'Lateral raises', type: 'reps', sets: 4, reps: '12-20', weight: 15, unit: 'lb', perHand: true },
      ] },
      { label: 'B', rounds: 3, restSec: 60, exercises: [
        { id: 'fe', name: 'Feet-elevated push-ups', type: 'bodyweight', sets: 3, reps: '8-15', weight: null },
        { id: 'bpa', name: 'Band pull-aparts', type: 'bodyweight', sets: 3, reps: '15-20', weight: null },
      ] },
      { label: 'C', rounds: 3, restSec: 60, exercises: [
        { id: 'x', name: 'Arnold press', type: 'reps', sets: 3, reps: '8-12', weight: 25 },
        { id: 'sp', name: 'Side plank', type: 'time', sets: 3, reps: '30-45', weight: null, perSide: true },
      ] },
      { label: 'D', rounds: 2, restSec: 45, exercises: [
        { id: 'tp', name: 'Band triceps pushdown', type: 'reps', sets: 2, reps: '15-20', weight: null },
        { id: 'db', name: 'Dead bug', type: 'bodyweight', sets: 2, reps: '8', weight: null },
      ] },
    ],
  }).value;
  const s = W.newSession(code);
  W.startSession(s, at('16:00'));
  const put = (b, e, vals) => vals.forEach((v, r) => {
    const set = s.ex[b][e].sets[r];
    if (v === null) return;
    if (Array.isArray(v)) { set.w = v[0]; set.r = v[1]; } else set.r = v;
    set.done = true;
  });
  put(0, 0, [['40', '10'], ['40', '9'], ['40', '8'], ['40', '8']]);
  put(0, 1, [['15', '20'], ['15', '18'], ['15', '16'], ['15', '15']]);
  put(1, 0, [['', '14'], ['', '12'], ['', '10']]);
  put(1, 1, [['10', '15'], ['10', '15'], ['10', '12']]);
  put(2, 0, [['25', '10'], null, ['25', '8']]);
  put(2, 1, ['45', '40', '35']);
  put(3, 1, [['', '8'], ['', '8']]);
  s.ex[0][0].tags = ['Just right'];
  s.ex[0][0].note = 'felt strong';
  s.ex[0][1].tags = ['Too easy'];
  s.ex[1][1].swap = 'Rear delt flyes';
  s.ex[3][0].skipped = true;
  s.feel = 4;
  s.bw = '152';
  s.note = 'hip felt fine';
  W.finishSession(s, at('16:58'));
  const log = W.buildLiftLog(s, at('16:58'));
  assert.equal(log, [
    'LIFT LOG v1',
    'Session: Push 1 | Date: 2026-11-05 | Week: 1 | Duration: 58 min | Feel: 4/5 | Bodyweight: 152 lb',
    'A1 Flat DB bench press [target 4x6-10 @40]: 40x10, 40x9, 40x8, 40x8 | tag: just right | note: felt strong',
    'A2 Lateral raises [target 4x12-20 @15]: 15x20, 15x18, 15x16, 15x15 | tag: too easy',
    'B1 Feet-elevated push-ups [target 3x8-15 @bodyweight]: BWx14, BWx12, BWx10',
    'C1 Arnold press [target 3x8-12 @25]: 25x10, -, 25x8',
    'C2 Side plank [target 3x30-45s] (each side): 45s, 40s, 35s',
    'D2 Dead bug [target 2x8 @bodyweight]: BWx8, BWx8',
    'SKIPPED: D1 Band triceps pushdown',
    'SWAPPED: B2 Band pull-aparts -> Rear delt flyes: 10x15, 10x15, 10x12',
    'Session note: hip felt fine',
  ].join('\n'));
  // empty bodyweight/tags/notes/feel are omitted
  s.bw = '';
  s.feel = null;
  assert.equal(W.buildLiftLog(s, at('16:58')).split('\n')[1], 'Session: Push 1 | Date: 2026-11-05 | Week: 1 | Duration: 58 min');
});

// ---------- end-of-day report ----------

test('DAY OS REPORT v1 format matches the spec', () => {
  const plan = validateDay({
    v: 1, type: 'day', date: D,
    top3: ['Submit UMass EA', 'Calc HWK 30', 'Pull 1'],
    blocks: [
      { id: 'b1', start: '06:30', end: '07:25', kind: 'routine', title: 'Wake up, breakfast, hip routine' },
      { id: 'b4', start: '15:00', end: '16:00', kind: 'focus', title: 'UMass supplement', tasks: ['Final read-through', 'Submit', 'Screenshot confirmation'], trackerId: 'umass' },
      { id: 'b5', start: '16:10', end: '17:10', kind: 'workout', title: 'Pull 1' },
      { id: 'b9', start: '19:00', end: '19:30', kind: 'focus', title: 'APES notes', tasks: ['Read ch. 4'] },
      { id: 'b10', start: '20:00', end: '21:00', kind: 'free', title: 'Free time' },
    ],
  }).value;
  const day = installPlan(newDay(D), plan, at('06:00'));
  day.top3 = [true, true, false];
  const g = (id) => day.plan.blocks.find((b) => b.id === id);
  g('b1')._state = 'done';
  g('b4')._state = 'done';
  g('b4')._tasks = [true, true, true];
  g('b5')._state = 'skipped';
  g('b9')._state = 'moved';
  day.changes = [{ t: '15:20', text: 'running late +15 min' }, { t: '16:05', text: 'patch: moved b5 to 17:30' }];
  day.trackerLog = [
    { id: 'umass', k: 'sub', t: 'Submit', done: true },
    { id: 'umass', k: 'status', from: 'in_progress', to: 'submitted' },
  ];
  day.note = 'tired after school';
  const out = buildDayReport(day, { inbox: [{ text: 'ask Kumar about vocab quiz' }], workoutLogs: [] });
  assert.equal(out, [
    'DAY OS REPORT v1',
    'Date: 2026-11-05 | Top 3: 2/3 done',
    'TOP 3: [x] Submit UMass EA | [x] Calc HWK 30 | [ ] Pull 1',
    'BLOCKS:',
    '[done] 06:30-07:25 Wake up, breakfast, hip routine',
    '[done] 15:00-16:00 UMass supplement | tasks 3/3',
    '[skipped] 16:10-17:10 Pull 1',
    '[moved to tomorrow] 19:00-19:30 APES notes | open tasks: Read ch. 4',
    '[not marked] 20:00-21:00 Free time',
    'CHANGES:',
    '15:20 running late +15 min',
    '16:05 patch: moved b5 to 17:30',
    'TRACKER:',
    'umass: "Submit" checked; status -> submitted',
    'INBOX:',
    '- ask Kumar about vocab quiz',
    'DAY NOTE: tired after school',
  ].join('\n'));
  const withLog = buildDayReport(day, { inbox: [], workoutLogs: ['LIFT LOG v1\nSession: X'] });
  assert.ok(withLog.endsWith('DAY NOTE: tired after school\n\nLIFT LOG v1\nSession: X'));
  // empty sections omitted
  const bare = buildDayReport(newDay(D));
  assert.equal(bare, 'DAY OS REPORT v1\nDate: 2026-11-05');
});

// ---------- calendar + storage ----------

test('ics export has events with 5-minute alerts', () => {
  const day = dayWithExample();
  const ics = buildICS(day, at('06:00'));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 13);
  assert.equal((ics.match(/TRIGGER:-PT5M/g) || []).length, 13);
  assert.match(ics, /DTSTART:20261105T063000/);
  assert.match(ics, /DTEND:20261106T063000/); // overnight bed block
  assert.match(ics, /SUMMARY:Wake up\\, breakfast\\, hip routine/);
});

test('storage backup round trip and pruning', () => {
  store.useMemoryStore();
  const day = dayWithExample();
  store.saveDay(day);
  store.saveDay(store.newDay('2026-08-01'));
  store.saveTracker({ items: [{ id: 'a', title: 'A', cat: 'other', status: 'not_started' }] });
  store.saveInbox([{ id: 'i1', text: 'hi', date: D }]);
  const pruned = store.pruneDays(D);
  assert.equal(pruned, 1);
  const backup = store.exportAll();
  const info = store.describeBackup(JSON.parse(JSON.stringify(backup)));
  assert.deepEqual([info.days, info.trackerItems, info.inbox], [1, 1, 1]);
  store.saveTracker({ items: [] });
  store.importAll(JSON.parse(JSON.stringify(backup)));
  store.resetCache();
  assert.equal(store.getTracker().items.length, 1);
  assert.equal(store.getDay(D).plan.blocks.length, 13);
  assert.throws(() => store.importAll({ app: 'nope' }), /not a Day OS backup/);
});

// ---------- service worker ----------

test('service worker precaches every app file', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.match(sw, /const CACHE_VERSION = 'dayos-v\d+';/);
  const listed = new Set([...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]));
  const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
  const files = [...walk('js'), ...walk('css'), ...walk('icons'), 'index.html', 'manifest.webmanifest'];
  for (const f of files) assert.ok(listed.has(f.split(path.sep).join('/')), `sw.js is missing ./${f}`);
  for (const f of listed) if (f) assert.ok(fs.existsSync(path.join(ROOT, f)), `sw.js lists a missing file ./${f}`);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) assert.ok(m[1].startsWith('./'), `index.html should use relative paths: ${m[1]}`);
});

test('workout started from a day block logs to that day', () => {
  const code = W.validateWorkout(exampleWorkout(D)).value;
  const s = W.newSession(code, { source: { date: '2026-11-04', blockId: 'b7' } });
  W.startSession(s, at('00:30'));
  assert.equal(s.date, '2026-11-04');
});
