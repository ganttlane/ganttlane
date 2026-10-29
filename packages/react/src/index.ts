/**
 * React components and hooks for gantt charts built on `@ganttlane/core`: a `<Gantt>` component
 * (with a `ref` handle and `ReactNode` slots for the tooltip, the link menu and the bar label)
 * and the `useGantt` / `useGanttState` hooks, over the vanilla renderer of `@ganttlane/dom`.
 *
 * Everything here is client code: the built entry starts with `'use client'`, put there by the
 * `banner` of `tsdown.config.ts`. A directive written in this file would be dropped from the
 * bundle's other modules and is reported by Rolldown, and the build fails on a warning. What is
 * not client code (`patchTasks` and the types) is also at `@ganttlane/react/core`, without the
 * directive (`./core`).
 *
 * @packageDocumentation
 */

export { Gantt } from './Gantt';
export type { SlotKind, SlotRender } from './slots';
export type {
  ExpandedKeys,
  GanttControlledProps,
  GanttDataAttributes,
  GanttHandle,
  GanttInstance,
  GanttProps,
  GanttReactOptions,
  GanttSlotProps,
  SnapshotSource,
} from './types';
export { useGantt } from './use-gantt';
export { useGanttState } from './use-gantt-state';

// What controlled data needs, `patchTasks`, and the types of the data you
// give and the events you get: the entry without the client directive, see `./core`.
export * from './core';
