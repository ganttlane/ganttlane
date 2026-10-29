/**
 * Task progress (FR-PROG): pure functions over dates and the work calendar, without model types
 * (`docs/architecture.md` §3.1):
 *
 * - {@link progressToDate} / {@link dateToProgress}: percentage ↔ progress date in calendar or
 *   working time, the date aligned down to `granularity` (FR-PROG-1, FR-SNAP-15);
 * - {@link progressFromDate}: the progress handle, a dragged date → percentage, with skipped
 *   non-working days (FR-PROG-3, FR-SCH-4);
 * - {@link rebaseProgress}: progress after a resize or move, keeping the completed amount or the
 *   remainder (`progressAnchor`, FR-PROG-2).
 *
 * All four are public: like the work calendar (FR-CAL-6) they are useful on their own, e.g. for
 * custom bar renderers, tooltips or a progress editor outside the chart.
 *
 * Other core modules import progress only through this file.
 *
 * @module
 */

export type { ProgressAnchor, RebaseProgressInput } from './progress-anchor';
export { rebaseProgress } from './progress-anchor';
export type {
  DateToProgressInput,
  ProgressBoundary,
  ProgressBounds,
  ProgressSpan,
  ProgressToDateInput,
} from './progress-date';
export { dateToProgress, progressToDate } from './progress-date';
export type { ProgressFromDateInput } from './progress-handle';
export { progressFromDate } from './progress-handle';
