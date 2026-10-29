# A release plan

A plan with the pieces most charts need: phases that hold children, children pinned to the edges of
their phase, finished work that is locked, links with a lead and a lag, a milestone, a work
calendar with holidays, striped groups, status colours from CSS, and a typed `data` payload that
reaches every handler and render function.

```sh
pnpm add @ganttlane/dom
```

`plan.ts`:

```ts
import '@ganttlane/dom/styles.css';

import { createGantt, type Link, type Task } from '@ganttlane/dom';

/** What `task.data` holds. It is the type of `record.task.data` in every event and render function. */
interface Meta {
  owner: string;
  status: 'done' | 'active' | 'late';
}

const tasks: Task<Meta>[] = [
  // ---- Design: finished, so locked (no drag, and no propagation moves it) ----
  {
    id: 'design',
    name: 'Design',
    start: '2026-03-02',
    end: '2026-03-13',
    progress: 100,
    locked: true,
    className: 'is-done',
    data: { owner: 'Ann', status: 'done' },
  },
  {
    id: 'draft',
    name: 'Draft',
    parentId: 'design',
    start: '2026-03-02',
    end: '2026-03-06',
    progress: 100,
    locked: true,
    className: 'is-done',
    data: { owner: 'Ann', status: 'done' },
  },
  {
    id: 'sign-off',
    name: 'Sign-off',
    parentId: 'design',
    start: '2026-03-09',
    end: '2026-03-13',
    progress: 100,
    locked: true,
    className: 'is-done',
    data: { owner: 'Ann', status: 'done' },
  },

  // ---- Build: counted in working days; its children follow it ----
  {
    id: 'build',
    name: 'Build',
    start: '2026-03-16',
    end: '2026-04-10',
    durationMode: 'working',
    progress: 35,
    className: 'is-active',
    data: { owner: 'Bo', status: 'active' },
  },
  {
    id: 'backend',
    name: 'Backend',
    parentId: 'build',
    start: '2026-03-16',
    end: '2026-03-27',
    parentAnchor: 'SS', // its start is pinned to the start of Build
    followParent: true, // and it moves when Build moves (`hierarchy.moveChildren: 'following'`)
    progress: 50,
    className: 'is-active',
    data: { owner: 'Bo', status: 'active' },
  },
  {
    id: 'frontend',
    name: 'Frontend',
    parentId: 'build',
    start: '2026-03-23',
    end: '2026-04-10',
    parentAnchor: ['SS', 'FF'], // both edges pinned: it stretches with Build
    followParent: true,
    progress: 20,
    className: 'is-late',
    data: { owner: 'Cy', status: 'late' },
  },

  // ---- QA and the release ----
  {
    id: 'qa',
    name: 'QA',
    start: '2026-04-10', // a day before Build ends
    duration: 5, // days
    data: { owner: 'Ann', status: 'active' },
  },
  {
    id: 'release',
    name: 'Release',
    type: 'milestone', // a diamond at its start
    start: '2026-04-17',
    data: { owner: 'Ann', status: 'active' },
  },
];

const links: Link[] = [
  { source: 'design', target: 'build' }, // finish-to-start; no lag: it keeps the gap it has now
  { source: 'build', target: 'qa', lag: -1 }, // a lead: QA starts a day before Build ends
  { source: 'qa', target: 'release', lag: '2d' }, // a lag: two days after QA ends
];

const container = document.querySelector<HTMLElement>('#chart');
if (!container) throw new Error('#chart not found');

createGantt<Meta>(container, {
  tasks,
  links,
  viewMode: 'week',
  scroll: { initial: 'first-task' },

  // Mondays to Fridays, with two named holidays that also stripe the grid.
  calendar: {
    holidays: [
      { date: '2026-04-03', name: 'Holiday' },
      { date: '2026-04-06', name: 'Office closed' },
    ],
  },
  hierarchy: { moveChildren: 'following', expandedKeys: ['build'] }, // Design starts collapsed
  display: { rowStripes: 'group', nonWorkingDays: 'stripes' },

  tooltip: {
    render: ({ task: record }) => ({
      title: record.name,
      subtitle: `${record.task.data?.owner ?? 'Unassigned'} · ${record.task.data?.status ?? ''}`,
    }),
  },
  onBeforeTaskChange: ({ conflicts }) => {
    // Conflicts are warnings; here a bar that would leave its phase is not allowed.
    return !conflicts.some((conflict) => conflict.type === 'outside-parent');
  },
});
```

Your own stylesheet (any stylesheet of the page, loaded after the library's): status colours are one
custom property per class. `task.className` is added to the bar's own element, so a CSS variable set
on it reaches the bar and its progress.

```css
.gantt__bar.is-done {
  --gantt-bar-color: #2f9e44;
}
.gantt__bar.is-active {
  --gantt-bar-color: #3f6fd1;
}
.gantt__bar.is-late {
  --gantt-bar-color: #d9480f;
}
```

What this shows:

- **Phases and children.** `parentId` makes the tree and a pre-order list of rows. A parent with
  children gets a collapsed or expanded state from `hierarchy.expandedKeys`
  (`expand('design')`, `collapseAll()` change it later).
- **Pinned children.** `parentAnchor` pins a child's edges to its parent's: `'SS'` the start to the
  start, `'FF'` the end to the end, `'FS'` the start to the parent's end, `'SF'` the end to the
  parent's start. Moving _Build_ moves _Backend_; stretching _Build_ stretches _Frontend_, which is
  pinned at both edges.
- **Locked work.** `locked: true` removes a task from the user's reach and from propagation, but you can
  still link to it.
- **Lags and leads.** A number is days (negative for a lead), a string a duration (`'3d'`, `'4h'`). A
  link without a `lag` keeps the gap it has now.
- **Conflicts** (a child outside its phase, a bar on a day off, a link whose gap is below its minimum)
  are reported on the record (`record.conflicts`), drawn on the bar, and passed to
  `onBeforeTaskChange`.
- **A milestone** is a task of `type: 'milestone'` with just a `start`.
