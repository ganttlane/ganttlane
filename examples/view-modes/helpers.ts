import type { ViewMode } from '@ganttlane/dom';

/** The seven presets, by the id that `viewMode` and `setViewMode` take. */
export const VIEW_MODES = [
  'hour',
  'quarter-day',
  'half-day',
  'day',
  'week',
  'month',
  'year',
] as const;

/**
 * Says what a view mode is: its name, the zoom (pixels per day) and the default snap step of a drag.
 *
 * @param viewMode - The `ViewMode` that `onViewModeChange` passes, or the one the snapshot holds.
 * @param pxPerDay - The zoom now in use; it differs from `viewMode.pxPerDay` after `zoomTo`.
 * @returns A sentence.
 */
export function describe(viewMode: ViewMode, pxPerDay: number): string {
  const zoom =
    pxPerDay === viewMode.pxPerDay
      ? `${String(pxPerDay)} px per day`
      : `${pxPerDay.toFixed(1)} px per day (zoomed from ${String(viewMode.pxPerDay)})`;
  const snap = typeof viewMode.snap === 'string' ? viewMode.snap : 'its own step';
  return `${viewMode.label ?? viewMode.id}: ${zoom}, a drag snaps to ${snap}`;
}

/**
 * The zoom a step of the buttons leads to. `zoomTo` takes any positive number of pixels per day;
 * the buttons stay between a hairline year and a very wide hour.
 *
 * @param pxPerDay - The zoom now in use.
 * @param factor - Above 1 to zoom in, below 1 to zoom out.
 * @returns The new zoom.
 */
export function zoomed(pxPerDay: number, factor: number): number {
  return Math.min(Math.max(pxPerDay * factor, 0.5), 4800);
}
