/**
 * The facade of `createGantt` without its container, for bindings of other frameworks
 * (`@ganttlane/react` is one): the core with the routing of the options and the merge of the
 * issues, and a renderer that is mounted, removed and mounted again on demand. Application code
 * uses `createGantt` from `@ganttlane/dom`.
 *
 * @packageDocumentation
 */

export type { GanttChart } from './create-gantt';
export { createChart } from './create-gantt';
export { MERGED_OPTION_GROUPS } from './options';
