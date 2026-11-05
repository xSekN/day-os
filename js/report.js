// report.js: DAY OS REPORT v1 (the end-of-day report pasted back to Claude).

import { oneLine } from './util.js';
import { sortBlocks, STATE_LABELS } from './planner.js';
import { summarizeLog } from './tracker.js';

// day: the day record. inbox: inbox items captured that day.
// workoutLogs: LIFT LOG v1 strings logged that day (oldest first).
export function buildDayReport(day, { inbox = [], workoutLogs = [] } = {}) {
  const L = ['DAY OS REPORT v1'];
  const plan = day.plan;
  const top3 = (plan && plan.top3) || [];
  const checks = day.top3 || [];

  let head = `Date: ${day.date}`;
  if (top3.length) head += ` | Top 3: ${top3.filter((_, i) => checks[i]).length}/${top3.length} done`;
  L.push(head);

  if (top3.length) L.push('TOP 3: ' + top3.map((t, i) => `[${checks[i] ? 'x' : ' '}] ${t}`).join(' | '));

  const blocks = plan ? sortBlocks(plan.blocks) : [];
  if (blocks.length) {
    L.push('BLOCKS:');
    for (const b of blocks) {
      const label = STATE_LABELS[b._state] || 'not marked';
      let line = `[${label}] ${b.start}-${b.end} ${b.title}`;
      const tasks = b.tasks || [];
      if (tasks.length) {
        const done = tasks.filter((_, i) => b._tasks && b._tasks[i]);
        const open = tasks.filter((_, i) => !(b._tasks && b._tasks[i]));
        if (b._state !== 'done' && open.length) line += ` | open tasks: ${open.join(', ')}`;
        else line += ` | tasks ${done.length}/${tasks.length}`;
      }
      L.push(line);
    }
  }

  const changes = day.changes || [];
  if (changes.length) {
    L.push('CHANGES:');
    for (const c of changes) L.push(`${c.t} ${c.text}`);
  }

  const tracker = summarizeLog(day.trackerLog);
  if (tracker.length) {
    L.push('TRACKER:');
    L.push(...tracker);
  }

  const items = inbox.filter((i) => i && String(i.text || '').trim());
  if (items.length) {
    L.push('INBOX:');
    for (const i of items) L.push(`- ${oneLine(i.text)}`);
  }

  if (day.note && day.note.trim()) L.push(`DAY NOTE: ${oneLine(day.note)}`);

  let out = L.join('\n');
  for (const log of workoutLogs) if (log) out += '\n\n' + log;
  return out;
}
