/**
 * The payload of `onRangeChange` (FR-TL-7, `docs/api.md` §5), for lazy loading by date range.
 */

import type { TimeRange } from '../scale';
import type { ViewportChangeReason } from './extension';

/**
 * Why the timeline range changed:
 * - `'initial'`: the first range, at mount;
 * - `'data'`: re-resolved from new tasks or links (a fixed range follows the data; the infinite
 *   timeline keeps its range for new data);
 * - `'options'`: re-resolved for new timeline options (`range`, `padding`, `includeToday`,
 *   `infinite`), `now`, `direction` or options the tasks are read with (`calendar`, `dates`, …);
 * - `'view-mode'`: re-snapped (and re-padded) for another view mode;
 * - `'zoom'`: re-snapped for another zoom level (`zoomTo`);
 * - `'resize'`: the infinite timeline settled for a new viewport width;
 * - `'extend-start'` / `'extend-end'` / `'trim-start'` / `'trim-end'`: the infinite timeline
 *   grew or shrank at an edge (`planExtension`);
 * - `'scroll-to'`: grown for a programmatic scroll outside it (`ensureContains`);
 * - `'drag'`: grown for a dragged bar that left it (the interaction's `extend-range` effect,
 *   `ensureContains`, FR-TL-5).
 *
 * A change after which the infinite timeline settles (a rebase, new options, a resize) is
 * reported once, with the final range and its cause.
 */
export type RangeChangeReason =
  'initial' | 'data' | 'options' | 'view-mode' | 'zoom' | 'resize' | 'drag' | ViewportChangeReason;

/**
 * What `onRangeChange` reports: the new range `[start, end)` and why it changed. Core carries
 * floating time; the facade converts the dates for its public payload. Build it from a
 * `ViewportChange` as `{ ...change.range, reason: change.reason }`.
 */
export interface RangeChange extends TimeRange {
  /** Why the range changed. */
  readonly reason: RangeChangeReason;
}
