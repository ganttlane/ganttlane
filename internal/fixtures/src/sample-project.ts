/**
 * `sample-project`: a synthetic project plan with six groups (parent rows), each holding
 * checkpoints, anchored tasks, deliverables and locked blocks, plus one dateless placeholder row.
 * All names, ids and dates are made up.
 *
 * How the dataset uses the input model (`docs/api.md` §7):
 * - a group is a parent **task** (`data.kind: 'group'`), not `type: 'milestone'`
 *   (that is the zero-duration diamond, FR-BAR-6);
 * - ids keep the composite `${kind}-${n}` form;
 * - durations are counted in working days (`durationMode: 'working'`), finished work is `locked`,
 *   a row that keeps its length when moved is `fixedDuration`, rows without editable links are
 *   `linkable: false`, progress is drawn from the end (`progressAnchor: 'end'`), and a row with no
 *   dates is `type: 'placeholder'`; `className` / `rowClassName` carry the styling hooks;
 * - a child's `startFrom` / `endFrom` say whether its start or end is taken from its parent's start
 *   or end, or is manual. They become `parentAnchor` entries (`startFrom: 'parent-start'` → `SS`,
 *   `'parent-end'` → `FS`; `endFrom: 'parent-end'` → `FF`, `'parent-start'` → `SF`; both → two
 *   anchors, so the child stretches with its parent), and any non-manual source also sets
 *   `followParent`;
 * - links between groups have no type (default `FS`); links between tasks are `FS` and cannot be
 *   edited.
 *
 * Deliberate details:
 * - `task-7` ends after its parent: a core should report an `outside-parent` conflict
 *   (FR-SCH-6), not move it;
 * - `group-1` and its finished children are `locked`;
 * - `group-3` is given as `start + duration` (no `end`); the others carry all three
 *   (`end` wins, FR-DATA-2);
 * - `placeholder-3` is a row with no dates (FR-DATA-3).
 */

import { deepFreeze } from './freeze';
import type { Fixture, FixtureLinkType, FixtureTask } from './types';

/** What a sample-project row represents. */
export type SampleProjectKind =
  'group' | 'checkpoint' | 'task' | 'deliverable' | 'block' | 'placeholder';

/** Where a child takes a date from: its parent's start or end, or a manual date. */
export type SampleProjectDateSource = 'parent-start' | 'parent-end' | 'manual';

/** `task.data` payload of the sample-project dataset. */
export interface SampleProjectData {
  kind: SampleProjectKind;
  status?: 'done' | 'active' | 'inactive' | 'overdue' | 'pending';
  groupType?: 'standard' | 'review' | 'ongoing';
  startFrom?: SampleProjectDateSource;
  endFrom?: SampleProjectDateSource;
  flagged?: boolean;
}

type SampleProjectTask = FixtureTask<SampleProjectData>;
type Status = NonNullable<SampleProjectData['status']>;

/** Fields shared by every child row of a group. */
const child = (n: number, kind: SampleProjectKind, parent: number) => ({
  id: `${kind}-${n}`,
  parentId: `group-${parent}`,
  className: kind,
});

function group(
  n: number,
  name: string,
  status: Status,
  fields: Omit<SampleProjectTask, 'id' | 'name' | 'data'>,
  groupType: SampleProjectData['groupType'] = 'standard',
): SampleProjectTask {
  return {
    id: `group-${n}`,
    name,
    durationMode: 'working',
    progressAnchor: 'end',
    className: `status-${status}`,
    ...fields,
    data: {
      kind: 'group',
      status,
      groupType,
      ...(fields.rowClassName === undefined ? {} : { flagged: true }),
    },
  };
}

/** A checkpoint: one locked day. */
function checkpoint(n: number, parent: number, name: string, start: string): SampleProjectTask {
  return {
    ...child(n, 'checkpoint', parent),
    name,
    start,
    duration: 1,
    locked: true,
    fixedDuration: true,
    linkable: false,
    progress: 100,
    progressAnchor: 'end',
    data: { kind: 'checkpoint' },
  };
}

/** Derives the parent anchors from the date sources. */
function anchorsOf(
  startFrom: SampleProjectDateSource,
  endFrom: SampleProjectDateSource,
): FixtureLinkType | FixtureLinkType[] | undefined {
  const anchors: FixtureLinkType[] = [];
  if (startFrom !== 'manual') anchors.push(startFrom === 'parent-start' ? 'SS' : 'FS');
  if (endFrom !== 'manual') anchors.push(endFrom === 'parent-end' ? 'FF' : 'SF');
  if (anchors.length === 0) return undefined;
  return anchors.length === 1 ? anchors[0] : anchors;
}

function anchoredTask(
  n: number,
  parent: number,
  name: string,
  sources: [startFrom: SampleProjectDateSource, endFrom: SampleProjectDateSource],
  fields: Pick<SampleProjectTask, 'start' | 'end' | 'duration' | 'progress' | 'locked'>,
): SampleProjectTask {
  const [startFrom, endFrom] = sources;
  const parentAnchor = anchorsOf(startFrom, endFrom);
  return {
    ...child(n, 'task', parent),
    name,
    durationMode: 'working',
    progressAnchor: 'end',
    linkable: false,
    ...fields,
    ...(parentAnchor === undefined ? {} : { parentAnchor }),
    followParent: parentAnchor !== undefined,
    data: { kind: 'task', startFrom, endFrom },
  };
}

/** A deliverable: one day, anchored by its end (start-to-start or finish-to-start). */
function deliverable(
  n: number,
  parent: number,
  name: string,
  endFrom: 'parent-start' | 'parent-end',
  start: string,
  progress: number,
): SampleProjectTask {
  return {
    ...child(n, 'deliverable', parent),
    name,
    start,
    duration: 1,
    fixedDuration: true,
    linkable: false,
    parentAnchor: endFrom === 'parent-start' ? 'SS' : 'FS',
    followParent: true,
    progress,
    progressAnchor: 'end',
    data: { kind: 'deliverable', endFrom },
  };
}

/** A block: locked work in working days. */
function block(
  n: number,
  parent: number,
  name: string,
  start: string,
  end: string,
  duration: number,
): SampleProjectTask {
  return {
    ...child(n, 'block', parent),
    name,
    start,
    end,
    duration,
    durationMode: 'working',
    locked: true,
    linkable: false,
    progress: 0,
    data: { kind: 'block' },
  };
}

const tasks: SampleProjectTask[] = [
  group(1, 'Planning', 'done', {
    start: '2026-03-02',
    end: '2026-03-13',
    duration: 10,
    progress: 100,
    locked: true,
  }),
  checkpoint(1, 1, 'Kick-off', '2026-03-02'),
  anchoredTask(1, 1, 'Outline scope', ['parent-start', 'manual'], {
    start: '2026-03-02',
    end: '2026-03-04',
    duration: 3,
    progress: 100,
    locked: true,
  }),
  anchoredTask(2, 1, 'Draft roadmap', ['parent-start', 'parent-end'], {
    start: '2026-03-02',
    end: '2026-03-13',
    duration: 10,
    progress: 100,
    locked: true,
  }),
  block(1, 1, 'Planning workshop', '2026-03-05', '2026-03-10', 4),
  deliverable(1, 1, 'Deliverable 1: Planning', 'parent-end', '2026-03-16', 100),

  group(2, 'Design', 'active', {
    start: '2026-03-16',
    end: '2026-03-27',
    duration: 10,
    progress: 60,
  }),
  checkpoint(2, 2, 'Design review', '2026-03-20'),
  anchoredTask(3, 2, 'Draft wireframes', ['parent-start', 'manual'], {
    start: '2026-03-16',
    end: '2026-03-18',
    duration: 3,
    progress: 100,
    locked: true,
  }),
  anchoredTask(4, 2, 'Produce visual design', ['manual', 'parent-end'], {
    start: '2026-03-19',
    end: '2026-03-27',
    duration: 7,
    progress: 40,
  }),
  block(2, 2, 'Studio session', '2026-03-19', '2026-03-20', 2),
  deliverable(2, 2, 'Deliverable 2: Design', 'parent-end', '2026-03-30', 0),

  // `start + duration` only (no `end`): the end comes from the working calendar.
  group(3, 'Build', 'overdue', {
    start: '2026-03-30',
    duration: 15,
    progress: 35,
    rowClassName: 'urgent',
  }),
  checkpoint(3, 3, 'Demo', '2026-04-08'),
  anchoredTask(5, 3, 'Implement features', ['parent-start', 'parent-end'], {
    start: '2026-03-30',
    end: '2026-04-20',
    duration: 15,
    progress: 60,
  }),
  anchoredTask(6, 3, 'Integrate services', ['manual', 'parent-end'], {
    start: '2026-04-14',
    end: '2026-04-20',
    duration: 5,
    progress: 0,
  }),
  // Manual dates, not following the parent, and ending after it (outside-parent conflict).
  anchoredTask(7, 3, 'Prepare test data', ['manual', 'manual'], {
    start: '2026-04-21',
    end: '2026-04-22',
    duration: 2,
    progress: 0,
  }),
  deliverable(3, 3, 'Deliverable 3: Prototype', 'parent-start', '2026-03-30', 100),
  {
    id: 'placeholder-3',
    name: 'To be scheduled',
    type: 'placeholder',
    parentId: 'group-3',
    className: 'placeholder',
    data: { kind: 'placeholder' },
  },

  group(4, 'QA', 'inactive', {
    start: '2026-04-22',
    end: '2026-05-08',
    duration: 12,
    progress: 0,
  }),
  checkpoint(4, 4, 'Test environment ready', '2026-04-22'),
  anchoredTask(8, 4, 'Functional testing', ['parent-start', 'manual'], {
    start: '2026-04-22',
    end: '2026-04-29',
    duration: 5,
    progress: 0,
  }),
  anchoredTask(9, 4, 'Performance testing', ['manual', 'manual'], {
    start: '2026-04-30',
    end: '2026-05-06',
    duration: 5,
    progress: 0,
  }),
  anchoredTask(10, 4, 'Security testing', ['parent-start', 'parent-end'], {
    start: '2026-04-22',
    end: '2026-05-08',
    duration: 12,
    progress: 0,
  }),
  block(3, 4, 'QA window', '2026-04-22', '2026-04-29', 5),
  block(4, 4, 'Load-test window', '2026-04-30', '2026-05-06', 5),
  deliverable(4, 4, 'Deliverable 4: QA', 'parent-end', '2026-05-11', 0),

  // Review groups keep their length when moved (`fixedDuration`).
  group(
    5,
    'Review',
    'pending',
    {
      start: '2026-05-11',
      end: '2026-05-12',
      duration: 2,
      progress: 0,
      fixedDuration: true,
    },
    'review',
  ),
  checkpoint(5, 5, 'Sign-off', '2026-05-11'),
  anchoredTask(11, 5, 'Fix review findings', ['manual', 'parent-end'], {
    start: '2026-05-12',
    end: '2026-05-12',
    duration: 1,
    progress: 0,
  }),
  block(5, 5, 'Release prep', '2026-05-12', '2026-05-12', 1),
  deliverable(5, 5, 'Deliverable 5: Review', 'parent-end', '2026-05-13', 0),

  group(
    6,
    'Launch',
    'inactive',
    {
      start: '2026-05-13',
      end: '2026-06-25',
      duration: 30,
      progress: 0,
    },
    'ongoing',
  ),
  checkpoint(6, 6, 'Go-live', '2026-05-13'),
  anchoredTask(12, 6, 'Monitor rollout', ['parent-start', 'parent-end'], {
    start: '2026-05-13',
    end: '2026-06-25',
    duration: 30,
    progress: 0,
  }),
  anchoredTask(13, 6, 'Wrap up', ['manual', 'parent-end'], {
    start: '2026-06-25',
    end: '2026-06-25',
    duration: 1,
    progress: 0,
  }),
  block(6, 6, 'Rollout window', '2026-05-18', '2026-05-22', 5),
  deliverable(6, 6, 'Final deliverable', 'parent-end', '2026-06-26', 0),
];

/**
 * Synthetic project plan: six groups (parents) with checkpoints, anchored tasks, deliverables,
 * blocks and a placeholder row; working-day durations; weekends and named holidays.
 */
export const sampleProject: Fixture<SampleProjectData> = deepFreeze({
  name: 'sample-project',
  description:
    'Six groups with FS links (one with a 1-day lag), working-day durations, a locked ' +
    'completed group and a fixed-duration review; children of every kind with SS / FF / ' +
    'SS+FF / FS parent anchors, non-editable task links, a child outside its parent and a ' +
    'dateless "To be scheduled" placeholder. Weekends and named holidays (one on a Saturday).',
  tasks,
  links: [
    // Group chain (default type FS).
    { source: 'group-1', target: 'group-2' },
    { source: 'group-2', target: 'group-3', type: 'FS' },
    { source: 'group-3', target: 'group-4', type: 'FS', lag: 1 },
    { source: 'group-4', target: 'group-5' },
    { source: 'group-5', target: 'group-6', type: 'FS' },
    // Task links: display only.
    { source: 'task-3', target: 'task-4', type: 'FS', editable: false },
    { source: 'task-6', target: 'task-7', type: 'FS', editable: false },
    { source: 'task-8', target: 'task-9', type: 'FS', editable: false },
  ],
  calendar: {
    weekends: [0, 6],
    holidays: [
      { date: '2026-04-03', name: 'Spring Holiday' },
      // A bare date: an unnamed company day off.
      '2026-04-24',
      { date: '2026-05-25', name: 'Memorial Day' },
      { date: '2026-06-19', name: 'Juneteenth' },
      { date: '2026-07-03', name: 'Independence Day (observed)' },
      // Falls on a Saturday: already a non-working day.
      { date: '2026-07-04', name: 'Independence Day' },
    ],
  },
  options: {
    scheduling: {
      durationMode: 'working',
      propagation: 'preserve-lag',
      defaultLinkType: 'FS',
      skipNonWorkingDays: { move: true, resize: false },
    },
    hierarchy: {
      expandedKeys: 'all',
      moveChildren: 'following',
      childAnchor: 'SS',
    },
  },
});
