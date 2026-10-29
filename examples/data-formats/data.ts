import type { Link, Task } from '@ganttlane/core';

/** What `task.data` holds: your own payload, which the library never reads. */
export interface Meta {
  /** The part of the README the task belongs to. */
  group: 'Start and end' | 'Duration' | 'Precision' | 'Links';
  /** How the input is read, in a sentence: the tooltip shows it. */
  note: string;
}

// 2026-03-16 is a Monday. The tasks of a group say the same thing in different ways, so their
// bars line up. Notes on the dates:
//
// - `new Date(2026, 2, 16)` is local midnight of 16 March (months count from 0). A number is read
//   the same way, through the local clock, so it is made from a `Date` here: an epoch literal
//   would land on another day in some time zones.
// - A value with a time of day (`'2026-03-23T09:00'`) makes a timed task. It must be a multiple
//   of `scheduling.granularity`, so `options.ts` sets it to one hour.
export const tasks: Task<Meta>[] = [
  // ---- start and end: the same five days, written four ways, and a timed task ----
  {
    id: 'date',
    name: 'Date',
    start: new Date(2026, 2, 16),
    end: new Date(2026, 2, 20),
    data: {
      group: 'Start and end',
      note: 'A Date at local midnight is a date-only value: whole days.',
    },
  },
  {
    id: 'iso-date',
    name: 'ISO date',
    start: '2026-03-16',
    end: '2026-03-20',
    data: {
      group: 'Start and end',
      note: 'A date-only string is a whole-day value.',
    },
  },
  {
    id: 'epoch',
    name: 'Epoch ms',
    start: new Date(2026, 2, 16).getTime(),
    end: new Date(2026, 2, 20).getTime(),
    data: {
      group: 'Start and end',
      note: 'A number is read through the local clock, like a Date.',
    },
  },
  {
    id: 'iso-time',
    name: 'ISO date-time',
    start: '2026-03-23T09:00',
    end: '2026-03-24T17:00',
    data: {
      group: 'Start and end',
      note: 'A time of day makes a timed task: its end is an exact moment.',
    },
  },

  // ---- duration instead of an end ----
  {
    id: 'days',
    name: 'duration 3',
    start: '2026-03-16',
    duration: 3,
    data: { group: 'Duration', note: 'A number is days.' },
  },
  {
    id: 'three-days',
    name: "duration '3d'",
    start: '2026-03-16',
    duration: '3d',
    data: { group: 'Duration', note: 'A string with a unit: the same three days.' },
  },
  {
    id: 'week',
    name: "duration '1w'",
    start: '2026-03-18',
    duration: '1w',
    data: { group: 'Duration', note: 'A week is seven calendar days, the weekend included.' },
  },
  {
    id: 'hours',
    name: "duration '6h'",
    start: '2026-03-23T09:00',
    duration: '6h',
    data: { group: 'Duration', note: 'Hours make a timed task, counted from its start.' },
  },

  // ---- precision: the same two dates, read as days or as moments ----
  {
    id: 'precision-day',
    name: "precision 'day'",
    start: '2026-03-23',
    end: '2026-03-25',
    precision: 'day',
    data: { group: 'Precision', note: 'Whole days: the end is a day, whatever else it says.' },
  },
  {
    id: 'precision-time',
    name: "precision 'time'",
    start: '2026-03-23',
    end: '2026-03-25',
    precision: 'time',
    data: {
      group: 'Precision',
      note: 'Exact moments: the end is the midnight that starts 25 March.',
    },
  },

  // ---- links: in `links`, and as `dependencies` of the target ----
  {
    id: 'links-a',
    name: 'links[] source',
    start: '2026-03-16',
    end: '2026-03-17',
    data: { group: 'Links', note: 'The predecessor of a link in the links array.' },
  },
  {
    id: 'links-b',
    name: 'links[] target',
    start: '2026-03-19',
    end: '2026-03-20',
    data: {
      group: 'Links',
      note: 'The successor: its link is in the links array, a lag of one day.',
    },
  },
  {
    id: 'deps-a',
    name: 'dependencies source',
    start: '2026-03-16',
    end: '2026-03-17',
    data: {
      group: 'Links',
      note: 'The predecessor of a link its successor lists as a dependency.',
    },
  },
  {
    id: 'deps-b',
    name: 'dependencies target',
    start: '2026-03-19',
    end: '2026-03-20',
    // The same link as `links-a` to `links-b`, written on the successor.
    dependencies: [{ id: 'deps-a', type: 'FS', lag: '1d' }],
    data: {
      group: 'Links',
      note: 'The successor: it lists the link as a dependency, a lag of one day.',
    },
  },
];

export const links: Link[] = [{ source: 'links-a', target: 'links-b', type: 'FS', lag: '1d' }];
