import type { Link, Task } from '@ganttlane/core';

/** What `task.data` holds: the status of a task. */
export interface Meta {
  status: 'done' | 'active' | 'late' | 'blocked' | 'review';
}

// 2026-03-02 is a Monday. Three phases with children, one status each, styled by CLASS: the
// stylesheet (`styles.css`) turns `className` into the colour of the bar and `rowClassName` into a
// tint of the whole row. A phase is a task like the others, with children.
export const tasks: Task<Meta>[] = [
  // ---- Discovery: finished ----
  {
    id: 'discovery',
    name: 'Discovery',
    start: '2026-03-02',
    end: '2026-03-06',
    progress: 100,
    className: 'is-phase is-done',
    data: { status: 'done' },
  },
  {
    id: 'interviews',
    name: 'Interviews',
    parentId: 'discovery',
    start: '2026-03-02',
    end: '2026-03-03',
    progress: 100,
    className: 'is-done',
    data: { status: 'done' },
  },
  {
    id: 'requirements',
    name: 'Requirements',
    parentId: 'discovery',
    start: '2026-03-04',
    end: '2026-03-06',
    progress: 100,
    className: 'is-done',
    data: { status: 'done' },
  },

  // ---- Build: one task is late, one is blocked; their rows are tinted ----
  {
    id: 'build',
    name: 'Build',
    start: '2026-03-09',
    end: '2026-03-24',
    progress: 45,
    className: 'is-phase is-active',
    data: { status: 'active' },
  },
  {
    id: 'backend',
    name: 'Backend',
    parentId: 'build',
    start: '2026-03-09',
    end: '2026-03-18',
    progress: 70,
    className: 'is-active',
    data: { status: 'active' },
  },
  {
    id: 'frontend',
    name: 'Frontend',
    parentId: 'build',
    start: '2026-03-11',
    end: '2026-03-24',
    progress: 35,
    className: 'is-late',
    rowClassName: 'row-late',
    data: { status: 'late' },
  },
  {
    id: 'integrations',
    name: 'Integrations',
    parentId: 'build',
    start: '2026-03-19',
    end: '2026-03-24',
    progress: 0,
    className: 'is-blocked',
    rowClassName: 'row-blocked',
    data: { status: 'blocked' },
  },

  // ---- Release ----
  {
    id: 'release',
    name: 'Release',
    start: '2026-03-25',
    end: '2026-03-27',
    progress: 0,
    className: 'is-phase is-review',
    data: { status: 'review' },
  },
  {
    id: 'qa',
    name: 'QA',
    parentId: 'release',
    start: '2026-03-25',
    end: '2026-03-26',
    progress: 50,
    // Colour set on the task itself wins over the class: this one bar is teal whatever its
    // status says, and its progress is a darker teal of its own.
    color: '#0f9d8a',
    progressColor: '#0a6b5d',
    className: 'is-active',
    data: { status: 'active' },
  },
  {
    id: 'launch',
    name: 'Launch',
    parentId: 'release',
    type: 'milestone',
    start: '2026-03-27',
    className: 'is-review',
    data: { status: 'review' },
  },
];

export const links: Link[] = [
  { source: 'interviews', target: 'requirements' },
  { source: 'requirements', target: 'backend' },
  { source: 'backend', target: 'integrations' },
  { source: 'integrations', target: 'qa' },
  { source: 'qa', target: 'launch' },
];

/** The colours of the statuses when they come from the data, not from a stylesheet. */
const COLOURS: Record<Meta['status'], { color: string; progressColor: string }> = {
  done: { color: '#2f9e44', progressColor: '#1c6b2c' },
  active: { color: '#3f6fd1', progressColor: '#264a96' },
  late: { color: '#d9480f', progressColor: '#9c3207' },
  blocked: { color: '#6b7280', progressColor: '#3f4651' },
  review: { color: '#7c3aed', progressColor: '#5421ab' },
};

/**
 * The same plan styled from the data instead: every task carries its own `color` and
 * `progressColor` (the renderer writes them as `--gantt-bar-color` and `--gantt-bar-progress-color`
 * on its bar), and no class. A colour is a value, so there is no theme to follow and no rule to
 * write, but there is also no row tint: `rowClassName` is the only way to style a row. (QA keeps
 * the teal it sets for itself.)
 */
export const coloured: Task<Meta>[] = tasks.map(({ className, rowClassName, ...task }) => ({
  ...COLOURS[task.data?.status ?? 'active'],
  ...task,
}));
