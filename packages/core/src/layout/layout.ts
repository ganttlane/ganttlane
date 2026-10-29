/**
 * The prepared layout: row metrics plus bar geometry by row, behind the
 * queries the facade exposes (`getRowMetrics`, `getBarRect`) and the virtualization window.
 */

import type { TaskId } from '../model';
import type { TimeScale } from '../scale';
import { type BarGeometry, barGeometry, type BarSource } from './bars';
import type { RowLayout, RowMetrics } from './rows';

/**
 * Where {@link createLayout} finds a task's span by id: `NormalizedModel.taskById` fits as is;
 * the store can pass a lookup that overlays draft spans on the model.
 */
export interface BarLookup {
  /** The task's kind and span, `undefined` for an unknown id. */
  get(id: TaskId): BarSource | undefined;
}

/** Input of {@link createLayout}. */
export interface LayoutInput {
  /** The row metrics (`layoutRows`). */
  readonly rows: RowLayout;
  /** The tasks' spans by id. */
  readonly tasks: BarLookup;
  /** The time scale. */
  readonly scale: TimeScale;
  /** Bar height in pixels, at most the row height. Default 30. */
  readonly barHeight?: number | undefined;
  /** Corner radius before the per-bar clamp, in pixels. Default 3. */
  readonly barRadius?: number | undefined;
}

/**
 * Row metrics and bar geometry of the visible rows, in body pixels (see `RowLayout`). Frozen.
 *
 * Bars are computed on first use and cached per row, so preparing a layout is O(rows) whatever
 * the number of bars, and a window of bars costs O(visible rows): a draft (a dragged bar) can
 * prepare a new layout per frame. Every query returns the same frozen objects on every call.
 */
export interface Layout {
  /** The row metrics. */
  readonly rows: RowLayout;
  /** The time scale the bars were placed with. */
  readonly scale: TimeScale;
  /** The bar of the row at `index`; `undefined` for a row without a bar or an unknown index. */
  readonly barAt: (index: number) => BarGeometry | undefined;
  /**
   * Where a task's row lies; `undefined` when the row is not visible
   * (a collapsed parent) or the id is unknown.
   */
  readonly getRowMetrics: (id: TaskId) => RowMetrics | undefined;
  /**
   * Where a task's bar lies, for positioning things next to it from outside; add
   * `rows.headerHeight` to `y` for scroller content pixels. `undefined` without a visible bar.
   */
  readonly getBarRect: (id: TaskId) => BarGeometry | undefined;
}

/**
 * Prepares the layout of the visible rows: an index from row to bar, with
 * bars placed lazily by {@link barGeometry}. Pure: the result depends only on the input, which
 * is never mutated; `input.tasks` is read when a bar is first needed, so it must not change
 * afterwards (build a new layout instead).
 *
 * @param input - Rows, task spans, scale and bar sizes.
 * @returns The frozen {@link Layout}.
 *
 * @example
 * ```ts
 * const rows = layoutRows(visibleRows(tree, expandedKeys), resolved);
 * const layout = createLayout({ rows, tasks: model.taskById, scale, ...resolved });
 * layout.getBarRect('design'); // { x, y, width, height, radius, progressWidth, … }
 * ```
 */
export function createLayout(input: LayoutInput): Layout {
  const { rows, tasks, scale } = input;
  const options = { barHeight: input.barHeight, barRadius: input.barRadius };
  // `null`: the row has no bar; a hole: not computed yet.
  const cache: (BarGeometry | null | undefined)[] = [];
  const barAt = (index: number): BarGeometry | undefined => {
    const cached = cache[index];
    if (cached !== undefined) return cached ?? undefined;
    const row = rows.rows[index];
    if (row === undefined) return undefined;
    const source = tasks.get(row.id);
    const bar = source === undefined ? undefined : barGeometry(source, row, scale, options);
    cache[index] = bar ?? null;
    return bar;
  };
  return Object.freeze({
    rows,
    scale,
    barAt,
    getRowMetrics: rows.rowOf,
    getBarRect: (id: TaskId): BarGeometry | undefined => {
      const row = rows.rowOf(id);
      return row === undefined ? undefined : barAt(row.index);
    },
  });
}
