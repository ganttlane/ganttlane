/**
 * Layout (`docs/architecture.md` §3, §7a): row metrics and header height (FR-ROW-5), bar
 * geometry with clamped radius and progress (FR-BAR-1, FR-BAR-2), label placement input
 * (`display.barLabel`), the queries behind `getRowMetrics` / `getBarRect` (FR-API-5) and the
 * virtualization window (NFR-PERF-1) and the link router (FR-LINK-3). Pure geometry in body pixels, no DOM. Depends on `scale`,
 * `hierarchy` and `schedule` (§3.1).
 *
 * Other core modules import the layout only through this file.
 *
 * @module
 */

export type { BarGeometry, BarKind, BarOptions, BarSource, BarSpan } from './bars';
export { barGeometry } from './bars';
export type {
  LayoutIssue,
  LayoutIssueCode,
  LayoutOptions,
  ResolvedLayoutOptions,
  ResolvedLayoutResult,
} from './dimensions';
export { LAYOUT_DEFAULTS, resolveLayoutOptions } from './dimensions';
export type { BarLabelMode, LabelBox, LabelOptions, LabelPlacement } from './label';
export { placeLabel } from './label';
export type { BarLookup, Layout, LayoutInput } from './layout';
export { createLayout } from './layout';
export * from './links';
export type { RowLayout, RowLayoutOptions, RowMetrics, RowRange } from './rows';
export { layoutRows } from './rows';
export type { LayoutWindow, Viewport, WindowOptions } from './window';
export { barsInWindow, visibleWindow } from './window';
