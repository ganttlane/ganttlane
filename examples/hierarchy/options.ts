import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // Every day is a working day, so a bar on a weekend is not a conflict here: the conflicts you
  // see are about the hierarchy.
  calendar: { weekends: [] },
  hierarchy: {
    // Which children move with their phase: 'all' (the default), 'following' (only those with
    // `followParent`) or 'none'. The first select changes it.
    moveChildren: 'all',
    // The pin of a child that has `followParent` and no `parentAnchor` of its own: 'SS' (the
    // default), 'FF', 'FS', 'SF', or two of them. The second select changes it.
    childAnchor: 'FF',
    // The phases that are open: 'all' (the default) or their ids. Build is open, Plan and Launch
    // are shut; `expand`, `collapse`, `expandAll` and `collapseAll` change it later.
    expandedKeys: ['build'],
  },
  // Zebra stripes for each phase with its children.
  display: { rowStripes: 'group' },
  // One column a week: the whole plan fits.
  viewMode: 'week',
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions>;
