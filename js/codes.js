// codes.js: turns pasted text into a validated code. It never throws: every
// problem comes back as a readable error so a bad paste can't crash the app.

import { isObj, todayKey } from './util.js';
import { validateDay, validatePatch } from './planner.js';
import { validateTrackerCode } from './tracker.js';
import { validateWorkout } from './workout.js';

export const TYPES = ['day', 'patch', 'tracker', 'workout'];

// Undo what chat apps and phones do to JSON: code fences, smart quotes,
// non-breaking spaces, and text around the object.
export function cleanText(raw) {
  let t = String(raw == null ? '' : raw).replace(/^﻿/, '').trim();
  const fence = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/.exec(t);
  if (fence) t = fence[1].trim();
  t = t
    .replace(/[“”„‟″‶]/g, '"')
    .replace(/[‘’‚‛′‵]/g, "'")
    .replace(/[   ]/g, ' ');
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first > 0 && last > first && !t.startsWith('[')) t = t.slice(first, last + 1);
  return t;
}

// Find the first JSON syntax error with a plain-English reason. Safari's own
// message ("JSON Parse error: Expected '}'") gives no position.
export function locateJsonError(text) {
  let i = 0;
  const n = text.length;
  const ws = () => {
    while (i < n && /\s/.test(text[i])) i++;
  };
  const fail = (msg) => {
    throw { pos: Math.min(i, n), msg };
  };
  const endEarly = (what) => fail(`the code ends too early: missing ${what} (was the paste cut off?)`);
  function value() {
    ws();
    if (i >= n) endEarly('a value');
    const c = text[i];
    if (c === '{') return obj();
    if (c === '[') return arr();
    if (c === '"') return str();
    if (c === '-' || (c >= '0' && c <= '9')) return num();
    for (const w of ['true', 'false', 'null']) {
      if (text.startsWith(w, i)) {
        i += w.length;
        return;
      }
    }
    if (c === "'") fail('single quotes found: JSON needs double quotes (")');
    fail(`unexpected "${c}" where a value should be`);
  }
  function obj() {
    i++;
    ws();
    if (text[i] === '}') {
      i++;
      return;
    }
    for (;;) {
      ws();
      if (i >= n) endEarly('"}"');
      if (text[i] === '}') fail('extra comma before "}"');
      if (text[i] === "'") fail('single quotes found: JSON needs double quotes (")');
      if (text[i] !== '"') fail('expected a "quoted" property name');
      str();
      ws();
      if (text[i] !== ':') fail(i >= n ? 'the code ends too early (was the paste cut off?)' : 'expected ":" after a property name');
      i++;
      value();
      ws();
      if (i >= n) endEarly('"}"');
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === '}') {
        i++;
        return;
      }
      fail('expected "," or "}" here (is a comma missing?)');
    }
  }
  function arr() {
    i++;
    ws();
    if (text[i] === ']') {
      i++;
      return;
    }
    for (;;) {
      value();
      ws();
      if (i >= n) endEarly('"]"');
      if (text[i] === ',') {
        i++;
        ws();
        if (text[i] === ']') fail('extra comma before "]"');
        continue;
      }
      if (text[i] === ']') {
        i++;
        return;
      }
      fail('expected "," or "]" here (is a comma missing?)');
    }
  }
  function str() {
    i++;
    while (i < n) {
      const c = text[i];
      if (c === '"') {
        i++;
        return;
      }
      if (c === '\\') i += 2;
      else if (c === '\n') fail('a text value has a line break in it (missing closing quote?)');
      else i++;
    }
    endEarly('a closing quote');
  }
  function num() {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!m) fail('bad number');
    i += m[0].length;
  }
  try {
    value();
    ws();
    if (i < n) fail('there is extra text after the end of the code');
    return null;
  } catch (e) {
    if (e && typeof e.pos === 'number') {
      const before = text.slice(0, e.pos);
      const line = before.split('\n').length;
      const col = e.pos - before.lastIndexOf('\n');
      const lineText = text.split('\n')[line - 1] || '';
      return { pos: e.pos, line, col, msg: e.msg, lineText };
    }
    return { pos: 0, line: 1, col: 1, msg: 'could not read this as JSON', lineText: '' };
  }
}

function jsonError(text) {
  const loc = locateJsonError(text);
  if (!loc) return ['This is not valid JSON.'];
  const snippet = loc.lineText.length > 70 ? loc.lineText.slice(Math.max(0, loc.col - 35), loc.col + 35) : loc.lineText;
  return [`This is not valid JSON: ${loc.msg} (line ${loc.line}, column ${loc.col}).`, snippet.trim() ? `Near: ${snippet.trim()}` : ''].filter(Boolean);
}

// Parse pasted text. Returns { ok, type, value, errors }.
// ctx.tracker is needed to tell tracker updates from new items.
export function parseCode(raw, ctx = {}) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return { ok: false, errors: ['Nothing pasted yet. Paste a code from Claude first.'] };
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    const cleaned = cleanText(text);
    try {
      obj = JSON.parse(cleaned);
    } catch {
      return { ok: false, errors: jsonError(cleaned) };
    }
  }
  if (Array.isArray(obj)) return { ok: false, errors: ['Expected one code {...}, but this is a list [...].'] };
  if (!isObj(obj)) return { ok: false, errors: ['Expected a code that starts with { and ends with }.'] };
  if (obj.app === 'day-os' && obj.type === 'backup') {
    return { ok: false, errors: ['This is a backup, not a code. Restore it from More > Backup.'] };
  }
  if (obj.type == null) return { ok: false, errors: ['Missing "type". It must be "day", "patch", "tracker", or "workout".'] };
  if (!TYPES.includes(obj.type)) {
    return { ok: false, errors: [`Unknown type "${obj.type}". It must be "day", "patch", "tracker", or "workout".`] };
  }
  if (obj.v != null && obj.v !== 1) return { ok: false, type: obj.type, errors: [`Unsupported version "v": ${JSON.stringify(obj.v)}. This app reads v: 1.`] };
  let r;
  try {
    if (obj.type === 'day') r = validateDay(obj);
    else if (obj.type === 'patch') r = validatePatch(obj, ctx.today || todayKey());
    else if (obj.type === 'tracker') r = validateTrackerCode(obj, ctx.tracker);
    else r = validateWorkout(obj);
  } catch (e) {
    r = { ok: false, errors: [`Couldn't read this ${obj.type} code: ${e.message}`] };
  }
  return { ...r, type: obj.type };
}
