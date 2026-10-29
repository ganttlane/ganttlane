/**
 * Bar geometry (FR-BAR-1, FR-BAR-2, FR-BAR-6, FR-ROW-5): where a task's bar or milestone lies
 * in the body, from its span, its row and the time scale.
 */

import type { TaskId, TaskType } from '../model';
import type { TimeScale } from '../scale';
import type { DateTimeMs } from '../time';
import { LAYOUT_DEFAULTS } from './dimensions';
import type { RowMetrics } from './rows';

/**
 * The span a bar is drawn from, in floating time: `TaskSpan` has these fields. The store passes
 * the model's span or a draft-overlaid one (a dragged bar), with `progressDate` recomputed for
 * the new edges.
 */
export interface BarSpan {
  /** First moment of the task. */
  readonly start: DateTimeMs;
  /** End of the half-open interval `[start, endExclusive)`. */
  readonly endExclusive: DateTimeMs;
  /** Boundary of the done part, inside `[start, endExclusive]`. */
  readonly progressDate: DateTimeMs;
}

/**
 * What {@link barGeometry} reads from a task: `TaskModel` fits as is. A task without a `span`
 * (placeholder, invalid) has no bar (FR-ROW-3).
 */
export interface BarSource {
  /** Row kind; `'placeholder'` never has a bar. */
  readonly type: TaskType;
  /** The bar's span; `undefined` for a row without a bar. */
  readonly span: BarSpan | undefined;
}

/** Shape of a bar: a rectangle, or a milestone diamond (FR-BAR-6). */
export type BarKind = 'bar' | 'milestone';

/** Options of {@link barGeometry}, sizes in pixels (see `resolveLayoutOptions`). */
export interface BarOptions {
  /** Bar height, at most the row height. Default 30. */
  readonly barHeight?: number | undefined;
  /** Corner radius before the clamp. Default 3. */
  readonly barRadius?: number | undefined;
}

/**
 * Where a bar lies, in body pixels (`y = 0` at the top of the first row, `x` in time scale
 * pixels). Values are unrounded floats: snapping to device pixels is the renderer's job. Frozen.
 *
 * For a milestone, `x … x + width` and `y … y + height` are the bounding box of the diamond: a
 * square of `barHeight` centred on the start, whose corners touch the middle of each side.
 */
export interface BarGeometry {
  /** The task id (from the row). */
  readonly id: TaskId;
  /** Index of the row (`RowMetrics.index`). */
  readonly rowIndex: number;
  /** `'bar'` or `'milestone'`. */
  readonly kind: BarKind;
  /** Left edge: the start (a milestone's box starts half a bar height before it). */
  readonly x: number;
  /** Top edge: the bar is centred vertically in its row. */
  readonly y: number;
  /** Width, `0` or more: from start to `endExclusive`; a milestone's box is `height` wide. */
  readonly width: number;
  /** Height: `barHeight`, at most the row height. */
  readonly height: number;
  /** Corner radius, at most half the height and half the width (FR-BAR-2). */
  readonly radius: number;
  /** Width of the done part from `x`, `0 … width` (FR-BAR-1); always `0` for a milestone. */
  readonly progressWidth: number;
}

/**
 * The geometry of a task's bar in its row (FR-BAR-1, FR-BAR-2, FR-ROW-5). Pure; the result is
 * frozen.
 *
 * - The bar runs from `scale.dateToX(start)` to `scale.dateToX(endExclusive)`, centred
 *   vertically in the row; a zero-length task (not a milestone) is a bar of width `0`.
 * - `radius` is `barRadius` clamped to half the height and half the width, so a narrow bar
 *   stays a valid rounded rectangle (FR-BAR-2).
 * - `progressWidth` reaches `span.progressDate`, clamped to the bar.
 * - A milestone is a diamond of `barHeight` × `barHeight` centred on its start (FR-BAR-6).
 * - A placeholder or a task without a span (invalid, no dates) has no bar: `undefined`.
 *
 * @param task - The task's kind and span (`TaskModel`, or a draft-overlaid copy).
 * @param row - The task's row metrics (`RowLayout.rowOf`).
 * @param scale - The time scale.
 * @param options - Bar height and corner radius; defaults from `LAYOUT_DEFAULTS`.
 * @returns The frozen geometry, or `undefined` without a bar.
 *
 * @example
 * ```ts
 * const bar = barGeometry(model.taskById.get(id)!, rows.rowOf(id)!, scale, { barHeight: 24 });
 * ```
 */
export function barGeometry(
  task: BarSource,
  row: RowMetrics,
  scale: TimeScale,
  options: BarOptions = {},
): BarGeometry | undefined {
  const { span } = task;
  if (span === undefined || task.type === 'placeholder') return undefined;
  const height = Math.min(options.barHeight ?? LAYOUT_DEFAULTS.barHeight, row.height);
  const radius = options.barRadius ?? LAYOUT_DEFAULTS.barRadius;
  const y = row.y + (row.height - height) / 2;
  const start = scale.dateToX(span.start);
  const milestone = task.type === 'milestone';
  const x = milestone ? start - height / 2 : start;
  const width = milestone ? height : Math.max(scale.dateToX(span.endExclusive) - start, 0);
  const done = milestone ? 0 : scale.dateToX(span.progressDate) - start;
  return Object.freeze({
    id: row.id,
    rowIndex: row.index,
    kind: milestone ? 'milestone' : 'bar',
    x,
    y,
    width,
    height,
    radius: Math.max(Math.min(radius, height / 2, width / 2), 0),
    progressWidth: Math.min(Math.max(done, 0), width),
  });
}
