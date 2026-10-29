/**
 * Vanilla DOM renderer for gantt charts built on `@ganttlane/core`.
 *
 * @packageDocumentation
 */

export type { Gantt } from './create-gantt';
export { createGantt } from './create-gantt';
export type {
  BarLabelContext,
  BarLabelOption,
  BarLabelRenderer,
  DisplayOptions,
  GridLinesOption,
  HighlightInput,
  NonWorkingDaysOption,
  ResolvedDisplay,
  RowStripesOption,
} from './display';
export { DISPLAY_DEFAULTS, resolveDisplay } from './display';
export type {
  DisposableNode,
  HighlightTooltipOptions,
  LinkMenuContext,
  LinkMenuOptions,
  TaskPreview,
  TaskTooltipContext,
  TooltipAction,
  TooltipApi,
  TooltipContent,
  TooltipOptions,
  TooltipPlacement,
  TooltipSections,
  TooltipTrigger,
} from './layers/popover/types';
export type {
  LayerContext,
  LayerFactories,
  LayerFactory,
  LayerName,
  LayerSlots,
  RendererLayer,
} from './layers/types';
export { LAYER_ORDER } from './layers/types';
export type {
  GanttDisplayOptions,
  GanttMountOptions,
  GanttOptions,
  GanttOptionsPatch,
  GanttVisualOptions,
  ToolbarOptions,
} from './options';
export type { MountedRenderer, RendererCore, RendererOptions } from './renderer';
export { mountRenderer } from './renderer';
export type { FrameScheduler, FrameSource, FrameTask, LayerScheduler } from './scheduler';
export type { HeightOption, ThemeOption } from './skeleton';
export type { GanttStrings, GanttStringsInput } from './strings';
export { DEFAULT_STRINGS, resolveStrings } from './strings';
export { VERSION } from '@ganttlane/core';

// The types of `@ganttlane/core` that the signatures above name, and the ones an application
// writes around a chart, so that code that installed only `@ganttlane/dom` (strict pnpm hides
// `@ganttlane/core`) can import them. Types only: no code of the core is pulled in. The set (in the
// order the sort rule wants): the data you give and read back (`Task`, `Link`, `TaskRecord`,
// `LinkRecord`, dates, view modes); the options the facade takes (`GanttCoreOptions`, edit,
// history and interaction options); the changes it reports and takes back (`ChangeSet`,
// `SessionChanges`, `TaskPatch`); the core and its parts (`GanttCore`, `GanttSnapshot`, the
// edit session, scroll and zoom options); events, hooks and their payloads (`GanttEventMap`,
// `docs/api.md` §5); issues (`Issue`, `OptionIssue`, `GanttIssues`); and the input of a custom
// layer (`InteractionEvent`, `RendererEffect`, `HitTarget`). Anything deeper is
// `import type { … } from '@ganttlane/core'`.
export type {
  ActiveLinkRecord,
  BeforeLinkCreateContext,
  BeforeLinkCreateResult,
  BeforeTaskChangeContext,
  BeforeTaskChangeResult,
  CalendarDay,
  Change,
  ChangeSet,
  Conflict,
  DateInput,
  DateRange,
  DirtyChangePayload,
  DurationInput,
  EditingOption,
  EditRefusedPayload,
  ErrorPayload,
  ExpandedChangePayload,
  GanttCore,
  GanttCoreOptions,
  GanttCoreOptionsPatch,
  GanttEditSession,
  GanttEventMap,
  GanttEventName,
  GanttIssues,
  GanttSelection,
  GanttSnapshot,
  GestureKind,
  HistoryChangePayload,
  HistoryOption,
  HitTarget,
  InactiveLinkRecord,
  InteractionEvent,
  InteractionOptions,
  Issue,
  IssueSeverity,
  IssuesPayload,
  KeyInput,
  Link,
  LinkCreatePayload,
  LinkDeletePayload,
  LinkPointerPayload,
  LinkRecord,
  LinkType,
  Listener,
  OptionIssue,
  OptionIssueCode,
  PointerInput,
  RangeChangePayload,
  RendererEffect,
  ScrollPayload,
  ScrollToDateOptions,
  ScrollToTaskOptions,
  SelectionChangePayload,
  SessionChanges,
  SessionLinkChanges,
  SetViewModeOptions,
  Task,
  TaskDatesChangePayload,
  TaskHoverPayload,
  TaskId,
  TaskPatch,
  TaskPointerPayload,
  TaskProgressChangePayload,
  TaskRecord,
  TaskType,
  TaskUpdate,
  Unsubscribe,
  UpdateTaskResult,
  ViewMode,
  ViewModeChangePayload,
  ViewModeId,
  ViewportSize,
  ZoomToOptions,
} from '@ganttlane/core';
