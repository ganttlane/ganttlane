/**
 * The headless facade: `createGanttCore`
 * composes every core module into one chart instance with options, public `Date`-based records
 * and events, methods for applications and a memoized snapshot plus viewport and interaction
 * input for renderers. It is the top layer of core: it may import every module, and no module
 * imports it.
 *
 * @module
 */

export { createGanttCore } from './core';
export type { OptionIssue, OptionIssueCode } from './options';
export type {
  DateRange,
  GanttCore,
  GanttCoreOptions,
  GanttCoreOptionsPatch,
  GanttEditSession,
  GanttEventHandlers,
  GanttEventMap,
  GanttEventName,
  GanttHandlers,
  GanttHierarchyOptions,
  GanttIssues,
  GanttSelection,
  GanttSnapshot,
  HistoryOption,
  RangeChangeInfo,
  RendererEffect,
  ScrollBehaviorOption,
  ScrollInfo,
  ScrollPosition,
  ScrollRequest,
  ScrollRequestReason,
  ScrollToDateOptions,
  ScrollToTaskOptions,
  SetViewModeOptions,
  TaskDates,
  TaskRecord,
  TaskUpdate,
  UpdateRejectedResult,
  UpdateTaskResult,
  ViewportSize,
  ZoomToOptions,
} from './types';
