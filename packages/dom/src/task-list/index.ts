/**
 * A list of the tasks to stand beside a chart: `createTaskList`, and what `@ganttlane/react` draws
 * its `TaskList` with (`mediateTaskList` and the pure helpers), so that the two behave the same. A
 * subpath of its own: an application without a list does not pay for it.
 *
 * @packageDocumentation
 */

export type { TaskListMediator, TaskListMediatorOptions, TaskListRowHandlers } from './mediator';
export { mediateTaskList } from './mediator';
export type {
  TaskListColumnBase,
  TaskListHost,
  TaskListRowState,
  TaskListSharedOptions,
  TaskListStrings,
  TreeAction,
} from './model';
export {
  cellAttributes,
  cellText,
  columnTracks,
  createTabStop,
  rowAttributes,
  rowClass,
  rowsToDraw,
  TASK_LIST_DEFAULTS,
  taskListWidth,
  treeAction,
  treeColumnOf,
} from './model';
export type { TaskList, TaskListColumn, TaskListOptions } from './task-list';
export { createTaskList } from './task-list';
