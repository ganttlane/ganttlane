/**
 * The time scale (FR-SCALE-*): the linear date ↔ x mapping (`TimeScale`), view modes with their
 * presets, header rows and grid lines (`docs/architecture.md` §6), and snapping: the caller-facing
 * snap settings, their resolution against `scheduling.granularity` and the snap of dragged edges
 * (FR-SNAP, §5.1).
 *
 * Other core modules import scale only through this file.
 *
 * @module
 */

export type { TimeRange } from './cell-grid';
export type { GridLine, GridLineKind, GridLineOptions } from './grid-lines';
export { gridLines } from './grid-lines';
export type { HeaderCell, HeaderContext, ScaleContext } from './header';
export { currentCell, headerCells, headerRows } from './header';
export type { ScaleIssue, ScaleIssueCode } from './issues';
export type {
  CalendarSnapRule,
  ClampResizeInput,
  FixedSnapRule,
  ResizeEdges,
  ResolvedSnap,
  ResolvedSnapResult,
  ResolveSnapInput,
  SnapCalendarUnit,
  SnapContext,
  SnapDirection,
  SnapEdge,
  SnapInteraction,
  SnapPrecision,
  SnapRule,
} from './snap';
export { clampResize, effectiveSnapRule, resolveSnap, snapTime } from './snap';
export type { SnapInput, SnapMode, SnapOptions, SnapStep } from './snap-input';
export type { ScaleDirection, TimeScale, TimeScaleOptions, ZoomAnchor } from './time-scale';
export { createTimeScale } from './time-scale';
export type {
  HeaderCellRange,
  HeaderFormatter,
  HeaderRowSpec,
  MajorLineSpec,
  PaddingInput,
  ResolvedViewModes,
  ViewMode,
  ViewModeId,
  ViewModeOverride,
  ViewModeOverrides,
  ViewModesInput,
  ViewModeUnit,
} from './view-modes';
export { resolveViewModes, VIEW_MODE_PRESETS } from './view-modes';
