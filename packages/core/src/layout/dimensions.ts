/**
 * Layout dimensions (the `layout` options): defaults and the resolution of the
 * caller's `layout` options into checked pixel sizes, with typed issues for bad values.
 */

import { DEV, isFiniteNumber, type Issue, shortMessage } from '../shared';

/**
 * Default sizes in pixels:
 * - `rowHeight` 48: a bar 30 high plus 18 of space between bars;
 * - `barHeight` 30 and `barRadius` 3;
 * - `headerRowHeights` `[45, 30]`: the header is exactly the sum of its rows, 75 px, with no
 *   extra padding. Header rows past the second default to 30 px;
 * - `labelPadding` 5: the margin a label inside needs, and the room an outside label keeps
 *   beyond the link handle;
 * - `labelHandleReach` 16: how far the default link handle reaches past a bar's edge (centre
 *   10 px out, radius 6: `INTERACTION_DEFAULTS.handles`, which `layout` cannot import; a test
 *   keeps the two equal), so that an outside label starts at `labelHandleReach + labelPadding`
 *   = 21 px and never sits on the handle;
 * - `overscanRows` 5 and `overscanPx` 400: what the virtualization window renders beyond the
 *   viewport.
 */
export const LAYOUT_DEFAULTS: {
  readonly rowHeight: number;
  readonly barHeight: number;
  readonly barRadius: number;
  readonly headerRowHeights: readonly number[];
  readonly labelPadding: number;
  readonly labelHandleReach: number;
  readonly overscanRows: number;
  readonly overscanPx: number;
} = /* @__PURE__ */ Object.freeze({
  rowHeight: 48,
  barHeight: 30,
  barRadius: 3,
  headerRowHeights: /* @__PURE__ */ Object.freeze([45, 30]),
  labelPadding: 5,
  labelHandleReach: 16,
  overscanRows: 5,
  overscanPx: 400,
});

/** Default height of header rows past the ones in `LAYOUT_DEFAULTS.headerRowHeights`. */
const DEFAULT_EXTRA_HEADER_ROW = 30;

/**
 * Issue code of the `layout` module: `'invalid-layout-option'`, a `layout` option is not a usable
 * size. An error replaces the value with its default (`suggested`); a warning reports a value
 * that was corrected (a bar taller than its row is clamped to the row height).
 */
export type LayoutIssueCode = 'invalid-layout-option';

/** An {@link Issue} raised by the `layout` module. */
export type LayoutIssue = Issue<LayoutIssueCode>;

/** The caller's `layout` options, sizes in pixels. */
export interface LayoutOptions {
  /** Height of a task row; finite, greater than `0`. */
  readonly rowHeight?: number | undefined;
  /** Height of a bar, centred in its row; finite, greater than `0`. */
  readonly barHeight?: number | undefined;
  /**
   * Corner radius of a bar; finite, `0` or more. Each bar clamps it
   * to half its height and width.
   */
  readonly barRadius?: number | undefined;
  /**
   * Height of every header row (one number) or one per header row, top first; finite, `0` or
   * more.
   */
  readonly headerRowHeight?: number | readonly number[] | undefined;
}

/** {@link LayoutOptions} with defaults applied and values checked. Frozen. */
export interface ResolvedLayoutOptions {
  /** Height of a task row. */
  readonly rowHeight: number;
  /** Height of a bar, at most `rowHeight`. */
  readonly barHeight: number;
  /** Corner radius of a bar before the per-bar clamp. */
  readonly barRadius: number;
  /** One height per header row of the view mode, top first. */
  readonly headerRowHeights: readonly number[];
}

/** Result of {@link resolveLayoutOptions}. Frozen. */
export interface ResolvedLayoutResult {
  /** The sizes to lay out with. */
  readonly options: ResolvedLayoutOptions;
  /** Problems found, in option order; paths are the option names (`'rowHeight'`). */
  readonly issues: readonly LayoutIssue[];
}

/**
 * Applies the defaults to the `layout` options and checks them. Never throws: a value
 * that is not a usable size gives an `'invalid-layout-option'` error and its default instead.
 *
 * - `rowHeight`, `barHeight`: finite and greater than `0`. Without `barHeight` the bar is
 *   `min(30, rowHeight)`; a `barHeight` above `rowHeight` gives a warning and is clamped to it.
 * - `barRadius`: finite, `0` or more (each bar clamps it further).
 * - `headerRowHeight`: a number is used for every header row; a list gives one height per header
 *   row, top first: missing and invalid entries take their default (45 px for the first row,
 *   30 px for the others), extra entries are ignored, so one list fits view modes with different
 *   numbers of header rows.
 *
 * @param options - The caller's `layout` options; `undefined` for all defaults.
 * @param headerRowCount - Header rows of the current view mode (`viewMode.headers.length`).
 * @returns The frozen sizes and issues.
 *
 * @example
 * ```ts
 * const { options } = resolveLayoutOptions({ rowHeight: 36, headerRowHeight: 32 }, 2);
 * options.headerRowHeights; // [32, 32]
 * ```
 */
export function resolveLayoutOptions(
  options: LayoutOptions | undefined,
  headerRowCount: number,
): ResolvedLayoutResult {
  const issues: LayoutIssue[] = [];
  const {
    rowHeight: rowDefault,
    barHeight: barDefault,
    barRadius: radiusDefault,
  } = LAYOUT_DEFAULTS;
  const rowHeight = size(issues, 'rowHeight', options?.rowHeight, false, rowDefault) ?? rowDefault;
  const fittingBar = Math.min(barDefault, rowHeight);
  let barHeight = size(issues, 'barHeight', options?.barHeight, false, fittingBar) ?? fittingBar;
  if (barHeight > rowHeight) {
    const message = DEV ? `${barHeight} is taller than the row (${rowHeight}), clamped` : '';
    issues.push(layoutIssue('warning', 'barHeight', message, barHeight, rowHeight));
    barHeight = rowHeight;
  }
  const barRadius =
    size(issues, 'barRadius', options?.barRadius, true, radiusDefault) ?? radiusDefault;

  const header = options?.headerRowHeight;
  const defaults = Array.from(
    { length: headerRowCount },
    (_, i) => LAYOUT_DEFAULTS.headerRowHeights[i] ?? DEFAULT_EXTRA_HEADER_ROW,
  );
  const shared = isList(header)
    ? undefined
    : size(issues, 'headerRowHeight', header, true, Object.freeze(defaults.slice()));
  const headerRowHeights = defaults.map((fallback, i) =>
    isList(header)
      ? (size(issues, `headerRowHeight[${i}]`, header[i], true, fallback) ?? fallback)
      : (shared ?? fallback),
  );

  return Object.freeze({
    options: Object.freeze({
      rowHeight,
      barHeight,
      barRadius,
      headerRowHeights: Object.freeze(headerRowHeights),
    }),
    issues: Object.freeze(issues),
  });
}

/**
 * A size option: `undefined` when it is missing or invalid; an invalid value is reported with
 * its replacement as `suggested`.
 */
function size(
  issues: LayoutIssue[],
  path: string,
  value: unknown,
  zero: boolean,
  suggested: unknown,
): number | undefined {
  if (value === undefined) return undefined;
  if (isFiniteNumber(value) && (value > 0 || (zero && value === 0))) return value;
  const message = DEV
    ? `${show(value)} is not ${zero ? 'a finite number, 0 or more' : 'a finite number greater than 0'}`
    : '';
  issues.push(layoutIssue('error', path, message, value, suggested));
  return undefined;
}

/** A value for a message: strings quoted, objects by kind, the rest as `String()`. */
function show(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  return typeof value === 'object' && value !== null ? 'an object' : String(value);
}

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function layoutIssue(
  severity: LayoutIssue['severity'],
  path: string,
  message: string,
  value: unknown,
  suggested: unknown,
): LayoutIssue {
  const code = 'invalid-layout-option';
  return Object.freeze({
    code,
    severity,
    message: DEV ? `layout.${path}: ${message}` : shortMessage(code, path),
    path,
    value,
    suggested,
  });
}
