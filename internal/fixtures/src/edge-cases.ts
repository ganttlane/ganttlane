/**
 * Small, focused fixtures for input edge cases. Each one isolates a single problem (plus a valid
 * control row where that helps) and its `description` says what a correct core should report,
 * using the `Issue` codes from `docs/api.md` §4.
 *
 * Plan step 2.1 runs every one of them through the model (frozen input, no throws, typed issues).
 */

import { deepFreeze } from './freeze';
import type { Fixture } from './types';

const WEEKENDS = { weekends: [0, 6] };

const noDates: Fixture = {
  name: 'no-dates',
  description:
    'Tasks without a usable date range become rows without a bar plus an issue (FR-DATA-3); ' +
    'an explicit placeholder is valid and gets no issue.',
  tasks: [
    { id: 'no-dates', name: 'No dates at all' },
    { id: 'duration-only', name: 'Duration without a start', duration: 3 },
    { id: 'start-only', name: 'Start without end or duration', start: '2026-03-02' },
    { id: 'end-only', name: 'End without a start', end: '2026-03-06' },
    { id: 'placeholder', name: 'Explicit placeholder', type: 'placeholder' },
    { id: 'dated', name: 'Control: dated task', start: '2026-03-02', end: '2026-03-06' },
  ],
  links: [],
};

const endBeforeStart: Fixture = {
  name: 'end-before-start',
  description:
    'End earlier than start gives `end-before-start`. The same-month case passed the fork, whose ' +
    'check diffed in whole years (bug D3); the date-time case is earlier on the same day.',
  tasks: [
    {
      id: 'same-month',
      name: 'End before start, same month',
      start: '2026-03-20',
      end: '2026-03-10',
    },
    {
      id: 'previous-month',
      name: 'End in the previous month',
      start: '2026-04-02',
      end: '2026-03-30',
    },
    {
      id: 'same-day-time',
      name: 'End earlier on the same day',
      start: '2026-03-10T15:00',
      end: '2026-03-10T09:00',
    },
    { id: 'valid', name: 'Control: valid range', start: '2026-03-10', end: '2026-03-20' },
  ],
  links: [],
};

const invalidDates: Fixture = {
  name: 'invalid-dates',
  description:
    'Unparseable or impossible values give `invalid-date` (dates) or `invalid-duration` (the ' +
    'ambiguous `m` duration unit is rejected), never an exception.',
  tasks: [
    { id: 'feb-30', name: 'February 30th', start: '2026-02-30', end: '2026-03-02' },
    { id: 'month-13', name: 'Month 13', start: '2026-13-01', duration: 2 },
    { id: 'hour-25', name: 'Hour 25', start: '2026-03-02T25:00', end: '2026-03-03T10:00' },
    { id: 'garbage', name: 'Not a date', start: 'next tuesday', duration: 1 },
    { id: 'nan-epoch', name: 'NaN epoch', start: Number.NaN, duration: 1 },
    {
      id: 'ambiguous-m',
      name: "Duration '3m' (months or minutes?)",
      start: '2026-03-02',
      duration: '3m',
    },
    { id: 'valid', name: 'Control: valid task', start: '2026-03-02', duration: 2 },
  ],
  links: [],
};

const unknownParent: Fixture = {
  name: 'unknown-parent',
  description:
    'A `parentId` that matches no task gives `unknown-parent`; the task is shown as a root row.',
  tasks: [
    {
      id: 'orphan',
      name: 'Parent does not exist',
      parentId: 'ghost',
      start: '2026-03-02',
      duration: 2,
    },
    {
      id: 'orphan-numeric',
      name: 'Numeric parent does not exist',
      parentId: 404,
      start: '2026-03-04',
      duration: 2,
    },
    { id: 'parent', name: 'Control: parent', start: '2026-03-02', end: '2026-03-06' },
    { id: 'child', name: 'Control: child', parentId: 'parent', start: '2026-03-03', duration: 2 },
  ],
  links: [],
};

const parentCycle: Fixture = {
  name: 'parent-cycle',
  description:
    'Parent chains that loop (two tasks pointing at each other, a task that is its own parent) ' +
    'give a `parent-cycle` issue and must not hang the tree builder.',
  tasks: [
    { id: 'a', name: 'Parent is b', parentId: 'b', start: '2026-03-02', duration: 2 },
    { id: 'b', name: 'Parent is a', parentId: 'a', start: '2026-03-02', duration: 2 },
    { id: 'self', name: 'Own parent', parentId: 'self', start: '2026-03-04', duration: 1 },
    { id: 'root', name: 'Control: root', start: '2026-03-02', duration: 3 },
  ],
  links: [],
};

const unknownLinkTarget: Fixture = {
  name: 'unknown-link-target',
  description:
    'Links whose source or target matches no task give `unknown-link-task` and are dropped; ' +
    'the valid link survives.',
  tasks: [
    { id: 'a', name: 'Predecessor', start: '2026-03-02', duration: 2 },
    { id: 'b', name: 'Successor', start: '2026-03-04', duration: 2 },
  ],
  links: [
    { source: 'a', target: 'ghost' },
    { source: 'ghost-source', target: 'b' },
    { source: 'a', target: 'b', type: 'FS' },
  ],
};

const linkCycle: Fixture = {
  name: 'link-cycle',
  description:
    'A → B → C → A and a self-link D → D give `cycle` (FR-LINK-7); propagation must terminate ' +
    '(FR-SCH-5). E → F is a valid control link.',
  tasks: [
    { id: 'A', name: 'A', start: '2026-03-02', duration: 2 },
    { id: 'B', name: 'B', start: '2026-03-04', duration: 2 },
    { id: 'C', name: 'C', start: '2026-03-06', duration: 2 },
    { id: 'D', name: 'D (self-link)', start: '2026-03-02', duration: 1 },
    { id: 'E', name: 'E', start: '2026-03-02', duration: 1 },
    { id: 'F', name: 'F', start: '2026-03-03', duration: 1 },
  ],
  links: [
    { source: 'A', target: 'B', type: 'FS' },
    { source: 'B', target: 'C', type: 'FS' },
    { source: 'C', target: 'A', type: 'FS' },
    { source: 'D', target: 'D', type: 'FS' },
    { source: 'E', target: 'F', type: 'FS' },
  ],
};

const duplicateIds: Fixture = {
  name: 'duplicate-ids',
  description:
    'Two tasks share an id and two links share an explicit id: both are reported, and lookups ' +
    'by id stay deterministic.',
  tasks: [
    { id: 'dup', name: 'First "dup"', start: '2026-03-02', duration: 2 },
    { id: 'dup', name: 'Second "dup"', start: '2026-03-09', duration: 2 },
    { id: 'other', name: 'Links to "dup"', start: '2026-03-12', duration: 1 },
  ],
  links: [
    { id: 'same-link', source: 'dup', target: 'other' },
    { id: 'same-link', source: 'other', target: 'dup', type: 'SS' },
  ],
};

const numericIds: Fixture = {
  name: 'numeric-ids',
  description:
    'Numeric ids, including the falsy `0` (fork bug D14 style `if (x)` checks), in tasks, ' +
    '`parentId` and links; they stay numbers (ids are never changed by the library).',
  tasks: [
    { id: 0, name: 'Id zero', start: '2026-03-02', end: '2026-03-13' },
    { id: 1, name: 'Child of 0', parentId: 0, start: '2026-03-02', duration: 3 },
    { id: 2, name: 'Child of 0', parentId: 0, start: '2026-03-05', duration: 3 },
    { id: 10, name: 'Root', start: '2026-03-16', duration: 2 },
  ],
  links: [
    { source: 1, target: 2, type: 'FS' },
    { source: 0, target: 10 },
  ],
};

const progressBounds: Fixture = {
  name: 'progress-bounds',
  description:
    'Progress at 0 and 100 (fork bugs D4 / D5, FR-PROG-1), fractional, out of range (−10, 150; ' +
    'must end up within 0…100) and missing.',
  tasks: [
    { id: 'p0', name: 'Progress 0', start: '2026-03-02', duration: 5, progress: 0 },
    { id: 'p100', name: 'Progress 100', start: '2026-03-02', duration: 5, progress: 100 },
    { id: 'p12.5', name: 'Progress 12.5', start: '2026-03-02', duration: 5, progress: 12.5 },
    { id: 'p-10', name: 'Progress −10', start: '2026-03-02', duration: 5, progress: -10 },
    { id: 'p150', name: 'Progress 150', start: '2026-03-02', duration: 5, progress: 150 },
    {
      id: 'p100-end',
      name: 'Progress 100 anchored to the end',
      start: '2026-03-02',
      duration: 5,
      progress: 100,
      progressAnchor: 'end',
    },
    { id: 'none', name: 'No progress', start: '2026-03-02', duration: 5 },
  ],
  links: [],
};

const oneDay: Fixture = {
  name: 'one-day',
  description:
    'One-day tasks in every input form; the Saturday one in working mode has zero working days ' +
    '(a non-working-day conflict, not a crash).',
  tasks: [
    { id: 'start-eq-end', name: 'start = end', start: '2026-03-04', end: '2026-03-04' },
    { id: 'duration-1', name: 'duration: 1', start: '2026-03-04', duration: 1 },
    { id: 'duration-1d', name: "duration: '1d'", start: '2026-03-04', duration: '1d' },
    {
      id: 'saturday-working',
      name: 'Saturday, working mode',
      start: '2026-03-07',
      end: '2026-03-07',
      durationMode: 'working',
    },
  ],
  links: [],
  calendar: WEEKENDS,
};

const acrossNewYear: Fixture = {
  name: 'across-new-year',
  description:
    'Tasks crossing 2026 → 2027 (2026 has ISO week 53). The working-mode task skips the New ' +
    "Year's Day holiday and the weekend: 3 working days from Wed 2026-12-30 end on Mon 2027-01-04.",
  tasks: [
    { id: 'range', name: 'Dec 28 → Jan 5', start: '2026-12-28', end: '2027-01-05' },
    { id: 'duration', name: 'Dec 31 + 2 days', start: '2026-12-31', duration: 2 },
    {
      id: 'working',
      name: '3 working days from Dec 30',
      start: '2026-12-30',
      duration: 3,
      durationMode: 'working',
    },
    { id: 'time', name: 'Over midnight', start: '2026-12-31T22:00', end: '2027-01-01T02:00' },
  ],
  links: [],
  calendar: { weekends: [0, 6], holidays: [{ date: '2027-01-01', name: "New Year's Day" }] },
};

const leapDay: Fixture = {
  name: 'leap-day',
  description:
    'February 29th 2028: a one-day task on it, ranges across it, and month / year durations ' +
    'starting at a month end, which must clamp to the end of the shorter month (FR-TIME-*).',
  tasks: [
    { id: 'leap-day', name: 'Feb 29', start: '2028-02-29', end: '2028-02-29' },
    { id: 'across', name: 'Feb 28 → Mar 1 (3 days)', start: '2028-02-28', end: '2028-03-01' },
    { id: 'plus-month', name: "Jan 31 + '1mo'", start: '2028-01-31', duration: '1mo' },
    { id: 'plus-year', name: "Feb 29 + '1y'", start: '2028-02-29', duration: '1y' },
    {
      id: 'non-leap',
      name: 'Control: Feb 28 → Mar 1 2027 (2 days)',
      start: '2027-02-28',
      end: '2027-03-01',
    },
  ],
  links: [],
};

const dstCrossing: Fixture = {
  name: 'dst-crossing',
  description:
    'Floating wall-clock times around DST switches (EU 2026-03-29 / 2026-10-25, US 2026-03-08 / ' +
    '2026-11-01), including local times that do not exist or repeat in those zones. Durations ' +
    'are wall-clock (22:00 → 04:00 is 6h) in every host time zone.',
  tasks: [
    {
      id: 'eu-spring',
      name: 'EU spring forward',
      start: '2026-03-28T22:00',
      end: '2026-03-29T04:00',
      precision: 'time',
    },
    {
      id: 'eu-gap',
      name: 'EU 02:30 (skipped locally)',
      start: '2026-03-29T02:30',
      end: '2026-03-29T03:30',
    },
    {
      id: 'eu-autumn',
      name: 'EU fall back (02:00–03:00 twice)',
      start: '2026-10-25T01:00',
      end: '2026-10-25T04:00',
    },
    {
      id: 'us-spring',
      name: 'US spring forward',
      start: '2026-03-07T22:00',
      end: '2026-03-08T06:00',
    },
    { id: 'us-gap', name: 'US 02:00 (skipped locally)', start: '2026-03-08T02:00', duration: '1h' },
    {
      id: 'us-autumn',
      name: 'US fall back (01:00–02:00 twice)',
      start: '2026-11-01T00:30',
      end: '2026-11-01T02:30',
    },
    {
      id: 'eu-days',
      name: 'Control: date-only across EU switch (4 days)',
      start: '2026-03-27',
      end: '2026-03-30',
    },
  ],
  links: [],
  options: { scheduling: { granularity: '30min' } },
};

const misaligned1h: Fixture = {
  name: 'misaligned-1h',
  description:
    "With `granularity: '1h'` (ADR-017, FR-SNAP-12/13): task 2 gives two `misaligned` issues and " +
    "becomes 10:00–12:00 under `alignInput: 'expand'`, task 3's '90min' becomes 2h, the '30min' " +
    'lag is aligned to the nearest step; date-only task 4 is always valid. Mirrors docs/api.md §4.',
  tasks: [
    { id: 1, name: 'Aligned 10:00–12:00', start: '2026-01-05T10:00', end: '2026-01-05T12:00' },
    { id: 2, name: 'Misaligned 10:30–11:30', start: '2026-01-05T10:30', end: '2026-01-05T11:30' },
    { id: 3, name: "Duration '90min'", start: '2026-01-05', duration: '90min' },
    { id: 4, name: 'Control: date-only', start: '2026-01-06', end: '2026-01-07' },
  ],
  links: [{ source: 1, target: 4, type: 'FS', lag: '30min' }],
  options: { scheduling: { granularity: '1h', alignInput: 'expand' } },
};

const veryLong: Fixture = {
  name: 'very-long',
  description:
    'Tasks longer than ten years (`too-long` error: no bar) next to a short one: the time scale and ' +
    'any per-day loops must stay fast (no day-by-day walks over the whole span).',
  tasks: [
    { id: 'decade-plus', name: '2026 → mid 2037', start: '2026-01-01', end: '2037-06-30' },
    { id: 'eleven-years', name: "duration: '11y'", start: '2026-01-01', duration: '11y' },
    { id: 'days', name: 'duration: 4000 days', start: '2026-01-01', duration: 4000 },
    { id: 'short', name: 'Control: one week', start: '2026-03-02', end: '2026-03-06' },
  ],
  links: [],
};

const deepHierarchy: Fixture = {
  name: 'deep-hierarchy',
  description: 'Five levels of nesting with siblings at several depths (levels 0…4).',
  tasks: [
    { id: 'level-1', name: 'Level 1', start: '2026-03-02', end: '2026-04-24' },
    { id: 'level-2', name: 'Level 2', parentId: 'level-1', start: '2026-03-02', end: '2026-04-10' },
    { id: 'level-3', name: 'Level 3', parentId: 'level-2', start: '2026-03-09', end: '2026-04-03' },
    { id: 'level-4', name: 'Level 4', parentId: 'level-3', start: '2026-03-16', end: '2026-03-27' },
    { id: 'level-5', name: 'Level 5', parentId: 'level-4', start: '2026-03-16', end: '2026-03-20' },
    {
      id: 'level-5b',
      name: 'Level 5 sibling',
      parentId: 'level-4',
      start: '2026-03-23',
      end: '2026-03-27',
    },
    {
      id: 'level-3b',
      name: 'Level 3 sibling',
      parentId: 'level-2',
      start: '2026-04-06',
      end: '2026-04-10',
    },
    {
      id: 'level-2b',
      name: 'Level 2 sibling',
      parentId: 'level-1',
      start: '2026-04-13',
      end: '2026-04-24',
    },
  ],
  links: [{ source: 'level-5', target: 'level-5b', type: 'FS' }],
};

const parentWithoutChildren: Fixture = {
  name: 'parent-without-children',
  description:
    'A group row listed in `expandedKeys` but without children renders as a plain row (no ' +
    'chevron, no crash); the other group has a child for contrast.',
  tasks: [
    { id: 'empty-group', name: 'Group without children', start: '2026-03-02', end: '2026-03-13' },
    { id: 'group', name: 'Group with a child', start: '2026-03-02', end: '2026-03-13' },
    { id: 'child', name: 'Child', parentId: 'group', start: '2026-03-02', duration: 3 },
  ],
  links: [],
  options: { hierarchy: { expandedKeys: ['empty-group', 'group'] } },
};

const linkTypes: Fixture = {
  name: 'link-types',
  description:
    'Every link type from one predecessor: SS, FF, SF, an FS + FF pair on the same successor ' +
    "(the legacy fork's `{start: 'end', end: 'end'}`, FR-LINK-2), a lead (lag −1), a `'2d'` lag " +
    'and a link without a type (falls back to `scheduling.defaultLinkType`).',
  tasks: [
    { id: 'a', name: 'Predecessor (Mon–Fri)', start: '2026-03-02', end: '2026-03-06' },
    { id: 'ss', name: 'SS successor', start: '2026-03-02', end: '2026-03-04' },
    { id: 'ff', name: 'FF successor', start: '2026-03-04', end: '2026-03-06' },
    { id: 'sf', name: 'SF successor', start: '2026-02-25', end: '2026-03-01' },
    { id: 'fs-ff', name: 'FS + FF successor', start: '2026-03-09', end: '2026-03-13' },
    { id: 'lead', name: 'FS with a 1-day lead', start: '2026-03-06', end: '2026-03-10' },
    { id: 'lag', name: "FS with a '2d' lag", start: '2026-03-11', end: '2026-03-13' },
    { id: 'default', name: 'Link without a type', start: '2026-03-09', end: '2026-03-10' },
  ],
  links: [
    { source: 'a', target: 'ss', type: 'SS' },
    { source: 'a', target: 'ff', type: 'FF' },
    { source: 'a', target: 'sf', type: 'SF' },
    { source: 'a', target: 'fs-ff', type: 'FS' },
    { source: 'a', target: 'fs-ff', type: 'FF' },
    { source: 'a', target: 'lead', type: 'FS', lag: -1 },
    { source: 'a', target: 'lag', type: 'FS', lag: '2d' },
    { source: 'a', target: 'default' },
  ],
  calendar: WEEKENDS,
};

/** All edge-case fixtures, in a stable order. Deep-frozen. */
export const edgeCases: readonly Fixture[] = deepFreeze([
  noDates,
  endBeforeStart,
  invalidDates,
  unknownParent,
  parentCycle,
  unknownLinkTarget,
  linkCycle,
  duplicateIds,
  numericIds,
  progressBounds,
  oneDay,
  acrossNewYear,
  leapDay,
  dstCrossing,
  misaligned1h,
  veryLong,
  deepHierarchy,
  parentWithoutChildren,
  linkTypes,
]);

/**
 * Looks up an edge case by name.
 *
 * @param name - `Fixture.name`, e.g. `'link-cycle'`.
 * @returns The fixture.
 * @throws If there is no edge case with that name.
 */
export function edgeCase(name: string): Fixture {
  const fixture = edgeCases.find((candidate) => candidate.name === name);
  if (!fixture) throw new Error(`Unknown edge case: ${name}`);
  return fixture;
}
