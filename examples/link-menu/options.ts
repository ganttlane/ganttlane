import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // The menu a click on an arrow opens is `linkMenu`: `render` is its content and `onRemove` what
  // its remove action calls. Both close over the example's own chart and status line, so they are
  // in `vanilla.ts` (`linkMenu`) and in `react.tsx` (`renderLinkMenu`, `linkMenu.onRemove`).

  // No days off, so that moving a task by a day (the "Lag" actions) never lands on a weekend.
  calendar: { weekends: [] },
  layout: { rowHeight: 40, barHeight: 26 },
  viewMode: 'week',
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions>;
