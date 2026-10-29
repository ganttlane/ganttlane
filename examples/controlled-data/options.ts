import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // Your state owns the tasks. The chart never changes them: it reports every committed change to
  // `onTasksChange`, shows it as a draft, and waits for you to hand the tasks back (`setTasks`).
  // (<Gantt> has no `dataMode`: passing the `tasks` prop makes it controlled.)
  dataMode: 'controlled',
  viewMode: 'week',
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions>;
