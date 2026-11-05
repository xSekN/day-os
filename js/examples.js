// examples.js: sample codes for the "Load example" buttons. Dates are
// relative to the day you load them so the Now screen always has something.

import { addDays, todayKey } from './util.js';

export function exampleWorkout(date = todayKey()) {
  return {
    v: 1,
    type: 'workout',
    session: 'Push 1',
    date,
    week: 1,
    notes: 'Calibration week: pick a weight where the last set is 1-2 reps from failure.',
    warmup: [
      { name: '90/90 hip switches', detail: '8 each side' },
      { name: 'Band pull-aparts', detail: '15' },
      { name: 'Scap push-ups', detail: '10' },
    ],
    blocks: [
      {
        label: 'A',
        rounds: 4,
        restSec: 75,
        exercises: [
          {
            id: 'db-bench',
            name: 'Flat DB bench press',
            type: 'reps',
            sets: 4,
            reps: '6-10',
            weight: 40,
            unit: 'lb',
            perHand: true,
            perSide: false,
            tempo: '2-0-1',
            cues: ['Shoulder blades pinched', 'Elbows about 45 degrees'],
            last: '40x10, 40x9, 40x8, 40x8',
          },
          {
            id: 'lat-raise',
            name: 'Lateral raises',
            type: 'reps',
            sets: 4,
            reps: '12-20',
            weight: 15,
            unit: 'lb',
            perHand: true,
            cues: ['Lead with the elbows', 'Stop at shoulder height'],
            last: '15x18, 15x16, 15x15, 15x14',
          },
        ],
      },
      {
        label: 'B',
        rounds: 3,
        restSec: 60,
        exercises: [
          {
            id: 'fe-pushup',
            name: 'Feet-elevated push-ups',
            type: 'bodyweight',
            sets: 3,
            reps: '8-15',
            weight: null,
            tempo: '2-1-1',
            cues: ['Body in one straight line'],
          },
          {
            id: 'band-pull-apart',
            name: 'Band pull-aparts',
            type: 'bodyweight',
            sets: 3,
            reps: '15-20',
            weight: 'light band',
            cues: ['Arms straight, squeeze shoulder blades'],
          },
        ],
      },
      {
        label: 'C',
        rounds: 3,
        restSec: 60,
        exercises: [
          {
            id: 'arnold-press',
            name: 'Seated DB Arnold press',
            type: 'reps',
            sets: 3,
            reps: '8-12',
            weight: null,
            unit: 'lb',
            perHand: true,
            cues: ['Ribs down', 'Rotate as you press'],
          },
          {
            id: 'side-plank',
            name: 'Side plank',
            type: 'time',
            sets: 3,
            reps: '30-45',
            weight: null,
            perSide: true,
            cues: ['Hips high', 'Stack the feet'],
          },
        ],
      },
      {
        label: 'D',
        rounds: 3,
        restSec: 45,
        exercises: [
          {
            id: 'band-pushdown',
            name: 'Band triceps pushdown',
            type: 'bodyweight',
            sets: 3,
            reps: '15-20',
            weight: 'medium band',
          },
          {
            id: 'dead-bug',
            name: 'Dead bug',
            type: 'bodyweight',
            sets: 2,
            reps: '6-8',
            weight: null,
            perSide: true,
            tempo: 'slow',
            cues: ['Low back pressed into the floor'],
          },
        ],
      },
    ],
  };
}

export function exampleDay(date = todayKey()) {
  const w = exampleWorkout(date);
  return {
    v: 1,
    type: 'day',
    date,
    top3: ['Submit UMass EA', 'Calc HWK 30', 'Push 1'],
    deadlines: [
      { name: 'UMass EA', due: date },
      { name: 'Calc HWK 30', due: addDays(date, 1) },
    ],
    note: 'Q1 ends today.',
    blocks: [
      { id: 'b1', start: '06:30', end: '07:25', kind: 'routine', title: 'Wake up, breakfast, hip routine' },
      { id: 'b2', start: '07:30', end: '08:00', kind: 'routine', title: 'Leave for school' },
      { id: 'b3', start: '08:00', end: '14:20', kind: 'school', title: 'School' },
      { id: 'b4', start: '14:20', end: '14:35', kind: 'routine', title: 'Head home' },
      { id: 'b5', start: '14:35', end: '15:00', kind: 'meal', title: 'Snack, decompress' },
      {
        id: 'b6',
        start: '15:00',
        end: '16:00',
        kind: 'focus',
        title: 'UMass supplement',
        tasks: ['Final read-through', 'Submit', 'Screenshot confirmation'],
        trackerId: 'umass',
      },
      { id: 'b7', start: '16:10', end: '17:10', kind: 'workout', title: 'Push 1', workout: w },
      {
        id: 'b8',
        start: '17:20',
        end: '18:10',
        kind: 'focus',
        title: 'Calc HWK 30',
        tasks: ['Problems 1-20', 'Check answers', 'Review notes'],
      },
      { id: 'b9', start: '18:15', end: '18:45', kind: 'meal', title: 'Dinner' },
      { id: 'b10', start: '18:45', end: '19:00', kind: 'chore', title: 'Pack bag for tomorrow' },
      { id: 'b11', start: '19:00', end: '21:45', kind: 'free', title: 'Free time' },
      { id: 'b12', start: '21:45', end: '22:15', kind: 'routine', title: 'Wind down' },
      { id: 'b13', start: '22:15', end: '06:30', kind: 'sleep', title: 'Bed' },
    ],
  };
}

export function exampleTracker(date = todayKey()) {
  const d = (n) => addDays(date, n);
  return {
    v: 1,
    type: 'tracker',
    mode: 'merge',
    items: [
      {
        id: 'umass',
        cat: 'college',
        title: 'UMass Amherst',
        due: d(0),
        dueTime: '23:59',
        status: 'in_progress',
        subtasks: [
          { t: 'Supplement written', done: true },
          { t: 'Transcript sent', done: false },
          { t: 'Submit', done: false },
        ],
        notes: 'Early Action',
        meta: { plan: 'EA', decision: 'End of January' },
      },
      {
        id: 'cu-boulder',
        cat: 'college',
        title: 'CU Boulder',
        due: d(10),
        status: 'not_started',
        subtasks: [
          { t: 'Essay draft', done: false },
          { t: 'Activities list', done: false },
        ],
        meta: { plan: 'EA', decision: 'Early February' },
      },
      {
        id: 'uw',
        cat: 'college',
        title: 'University of Washington',
        due: d(25),
        status: 'not_started',
        meta: { plan: 'RD', decision: 'Mid-March' },
      },
      {
        id: 'apes-u3',
        cat: 'test',
        title: 'APES Unit 3 test',
        due: d(5),
        status: 'in_progress',
        subtasks: [
          { t: 'Review ch. 3', done: true },
          { t: 'Practice FRQ', done: false },
        ],
        meta: { topics: ['Biodiversity', 'Succession', 'Population growth'] },
      },
      {
        id: 'sat',
        cat: 'test',
        title: 'SAT',
        due: d(30),
        dueTime: '08:00',
        status: 'not_started',
        notes: 'Bring calculator and admission ticket',
        meta: { topics: 'Full practice test, Math focus' },
      },
      {
        id: 'calc-30',
        cat: 'assignment',
        title: 'Calc HWK 30',
        due: d(1),
        status: 'in_progress',
        subtasks: [
          { t: 'Problems 1-20', done: false },
          { t: 'Check answers', done: false },
        ],
      },
      {
        id: 'eng-essay',
        cat: 'assignment',
        title: 'English: Gatsby essay',
        due: d(7),
        status: 'not_started',
        subtasks: [
          { t: 'Thesis', done: false },
          { t: 'Draft', done: false },
          { t: 'Revise', done: false },
        ],
      },
      {
        id: 'apes-lab',
        cat: 'assignment',
        title: 'APES water lab report',
        due: d(-1),
        status: 'in_progress',
        notes: 'Was due yesterday, turn in late',
      },
      {
        id: 'permit',
        cat: 'other',
        title: 'Driver permit appointment',
        due: d(12),
        dueTime: '15:30',
        status: 'not_started',
        notes: 'Bring birth certificate',
      },
      {
        id: 'scholarship',
        cat: 'other',
        title: 'Local scholarship form',
        due: d(20),
        status: 'not_started',
      },
    ],
  };
}

export function examplePatch(date = todayKey()) {
  return {
    v: 1,
    type: 'patch',
    date,
    ops: [
      { op: 'resize', id: 'b6', end: '16:20' },
      { op: 'move', id: 'b7', start: '16:30' },
      { op: 'resize', id: 'b8', start: '17:40' },
      { op: 'add', block: { id: 'b14', start: '19:00', end: '19:30', kind: 'focus', title: 'APES notes', tasks: ['Read ch. 4'] } },
      { op: 'resize', id: 'b11', start: '19:30' },
      { op: 'trackerUpdate', id: 'apes-u3', set: { notes: 'Focus on ch. 4 succession' } },
    ],
  };
}

export const EXAMPLES = {
  day: exampleDay,
  tracker: exampleTracker,
  patch: examplePatch,
  workout: exampleWorkout,
};

export function exampleText(kind, date) {
  return JSON.stringify(EXAMPLES[kind](date), null, 2);
}
