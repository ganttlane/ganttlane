import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // Drawing links from a bar's round handles and removing them from the menu of a link. `false`
  // turns both off (the other flags of `editing` are on unless they are set to `false`).
  editing: { links: true },
  // The type a link drawn by the user gets: 'FS' (finish to start, the default), 'SS', 'FF' or
  // 'SF'. It is not asked for while drawing: change it here, and the next links have it.
  scheduling: { defaultLinkType: 'FS' },
  viewMode: 'week',
  scroll: { initial: 'first-task' },
  // Smaller rows, so that all eight tasks are in view at once.
  layout: { rowHeight: 36, barHeight: 24 },
} satisfies Partial<GanttOptions>;
