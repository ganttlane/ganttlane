import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // Your state owns the tasks and the links (<Gantt>: the `tasks` and `links` props).
  dataMode: 'controlled',
  // View mode: the chart cannot be edited from the UI (no drag, no links drawn). The example turns
  // it on between Edit and Save or Cancel. Your own calls (`updateTask`, `setTasks`) still work.
  editing: false,
  viewMode: 'week',
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions>;
