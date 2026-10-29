/**
 * The viewport (`docs/architecture.md` §7, FR-TL-*, FR-SCROLL-1, FR-SCROLL-2): the timeline
 * range (auto from the tasks, padding, today, explicit, snapped to whole columns), the infinite
 * timeline's extend / trim policy with the exact `scrollLeft` compensation that keeps the date
 * under the viewport's left edge in place, scroll targets for dates, tasks and the initial
 * scroll, anchored rescaling for view mode changes and zoom, drag autoscroll speed, and the
 * `onRangeChange` payload. Pure math over numbers: no DOM, no timers. Depends on `layout` and
 * through it on `scale`, `model` and `time` (§3.1).
 *
 * Other core modules import the viewport only through this file.
 *
 * @module
 */

export type { ScrollAlign } from './align';
export type { AutoScrollOptions } from './autoscroll';
export { autoScrollVelocity } from './autoscroll';
export type { ColumnGrid } from './columns';
export { columnGrid } from './columns';
export { VIEWPORT_DEFAULTS } from './defaults';
export type {
  EnsureContainsOptions,
  ExtensionPolicy,
  TimelineBounds,
  ViewportChange,
  ViewportChangeReason,
} from './extension';
export { ensureContains, planExtension } from './extension';
export type {
  InfinitePolicy,
  InfiniteTimelineOptions,
  ResolvedAutoScroll,
  ResolvedScrollOptions,
  ResolvedScrollResult,
  ResolvedTimelineOptions,
  ResolvedTimelineResult,
  ScrollOptionsInput,
  TimelineOptions,
  TimelineOptionsContext,
  ViewportIssue,
  ViewportIssueCode,
} from './options';
export { resolveScrollOptions, resolveTimelineOptions } from './options';
export type { RangeInput, RangeSpan, TimelinePadding } from './range';
export { resolveRange } from './range';
export type { RangeChange, RangeChangeReason } from './range-change';
export type { RebaseOptions } from './rebase';
export { keepAnchor, rebaseTimeline } from './rebase';
export type {
  InitialScroll,
  InitialScrollInput,
  PlanScrollOptions,
  ScrollPlan,
  TaskScrollOptions,
  TaskScrollPlan,
} from './scroll';
export {
  planScrollTo,
  resolveInitialScroll,
  scrollLeftFor,
  scrollTopFor,
  scrollToTask,
} from './scroll';
export type { TimelineState } from './state';
