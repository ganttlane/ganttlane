import type { GanttOptions } from '@ganttlane/dom';

// Values that come from outside the reach of TypeScript (a config file, a form, a query string):
// plain strings, which nothing in their type ties to an option. The casts below are only here so
// that this file compiles; without them the compiler would refuse the values, as it should, and
// the chart has to cope with them all the same.
const propagation: string = 'sideways';
const gridLines: string = 'diagonal';

export const options = {
  // Not a propagation policy: an `invalid-option` issue, whose `suggested` is the default that is
  // used instead ('preserve-lag'). A group of options is checked field by field.
  scheduling: { propagation: propagation as 'none' },
  // The same for the options the renderer owns: the path says where, `display.gridLines`.
  display: { gridLines: gridLines as 'both' },
  // One column a week: the whole plan fits.
  viewMode: 'week',
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions>;
