/**
 * The part of `@ganttlane/react` that is not client code, at `@ganttlane/react/core`: the helper
 * that writes a `ChangeSet` into your own tasks (`patchTasks`, `docs/decisions.md` Q12) and the
 * types of the data you give and the events you get. The main entry starts with `'use client'`, so
 * a server component that imports from it gets a reference to a client module, not a function;
 * this entry has no directive, so server code, a server action or a route handler can import
 * `patchTasks` (and a shared module can import the types) from here. The main entry exports all of it
 * too, for client code.
 *
 * @packageDocumentation
 */

export { patchTasks } from '@ganttlane/core';

// The types of the data you give and the events you get, so that an application that installed
// only `@ganttlane/react` (strict pnpm hides `@ganttlane/dom` and `@ganttlane/core`) can name them:
// the set `@ganttlane/dom` re-exports (ADR-026), its types only, as far as a React application
// meets them. Anything deeper is `import type { … } from '@ganttlane/core'`.
export type {
  BarLabelContext,
  ChangeSet,
  DateInput,
  GanttCore,
  GanttEventMap,
  GanttIssues,
  GanttSnapshot,
  GanttStrings,
  GanttStringsInput,
  HighlightInput,
  Issue,
  Link,
  LinkMenuContext,
  LinkRecord,
  SessionChanges,
  Task,
  TaskDatesChangePayload,
  TaskId,
  TaskRecord,
  TaskTooltipContext,
  TooltipContent,
  ViewMode,
  ViewModeId,
} from '@ganttlane/dom';
