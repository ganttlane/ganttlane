import type { GanttOptions } from '@ganttlane/dom';

import type { Meta } from './data';

export const options = {
  viewMode: 'week',
  scroll: { initial: 'first-task' },

  // Mondays to Fridays, with two named holidays that also stripe the grid.
  calendar: {
    holidays: [
      { date: '2026-04-03', name: 'Holiday' },
      { date: '2026-04-06', name: 'Office closed' },
    ],
  },
  hierarchy: {
    // Moving a phase moves the children that follow it (`followParent` on the task).
    moveChildren: 'following',
    // Design starts collapsed: only Build is expanded.
    expandedKeys: ['build'],
  },
  display: { rowStripes: 'group', nonWorkingDays: 'stripes' },

  tooltip: {
    // `record.task.data` is the typed `Meta` payload of the task.
    render: ({ task: record }) => ({
      title: record.name,
      subtitle: `${record.task.data?.owner ?? 'Unassigned'} · ${record.task.data?.status ?? ''}`,
    }),
  },
  onBeforeTaskChange: ({ conflicts }) => {
    // Conflicts are warnings; here a bar that would leave its phase is not allowed.
    return !conflicts.some((conflict) => conflict.type === 'outside-parent');
  },
} satisfies Partial<GanttOptions<Meta>>;
