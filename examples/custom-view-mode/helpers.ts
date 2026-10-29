import type { ViewMode } from '@ganttlane/dom';

/**
 * Says what a view mode is made of: the width of a column, the zoom and the snap step of a drag.
 *
 * @param viewMode - The `ViewMode` that `onViewModeChange` passes.
 * @returns A sentence.
 */
export function describe(viewMode: ViewMode): string {
  const step = viewMode.step ?? 1;
  const column = `${String(step)} ${viewMode.unit}${step === 1 ? '' : 's'}`;
  const snap = typeof viewMode.snap === 'string' ? viewMode.snap : 'its own step';
  const rows = viewMode.headers.length;
  return `${viewMode.label ?? viewMode.id}: a column is ${column}, ${String(viewMode.pxPerDay)} px per day, ${String(rows)} header rows, a drag snaps to ${snap}`;
}
