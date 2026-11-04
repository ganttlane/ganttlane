/**
 * `fromFrappeGanttOptions`: the options of the public frappe-gantt library turned into the options
 * of ganttlane, with a report of what could not be turned.
 */

import { isFiniteNumber as isNumber, isRecord, isSize } from '../shared';
import { removedFrappeReason, renamedFrappeName } from './frappe-names';

/**
 * The options and events of the public frappe-gantt library that this adapter reads. Any other
 * key is accepted and reported as `'unknown'`.
 */
export interface FrappeGanttOptions {
  /** Name of the current view mode, e.g. `'Day'` or `'Quarter Day'`. */
  readonly view_mode?: string | undefined;
  /** View modes: names of presets, or objects that define or override a mode. */
  readonly view_modes?: readonly unknown[] | undefined;
  /** Width of a column in px, in every view mode. */
  readonly column_width?: number | null | undefined;
  /** Snap step of a drag, e.g. `'1d'`, `'7d'`, `'1h'`. */
  readonly snap_at?: string | null | undefined;
  /** Language of the header and the popup. */
  readonly language?: string | undefined;
  /** Height of a bar in px. */
  readonly bar_height?: number | undefined;
  /** Gap between two bars in px. */
  readonly padding?: number | undefined;
  /** Corner radius of a bar in px. */
  readonly bar_corner_radius?: number | undefined;
  /** Height of the upper header row in px. */
  readonly upper_header_height?: number | undefined;
  /** Height of the lower header row in px. */
  readonly lower_header_height?: number | undefined;
  /** Height of the chart: px or `'auto'`. */
  readonly container_height?: number | 'auto' | undefined;
  /** Corner radius of a link arrow in px. */
  readonly arrow_curve?: number | undefined;
  /** Grid lines: `'both'`, `'vertical'`, `'horizontal'` or `'none'`. */
  readonly lines?: string | undefined;
  /** Moves a bar label inside a bar that is partly out of view. */
  readonly auto_move_label?: boolean | undefined;
  /** Draws the expected progress of a bar. */
  readonly show_expected_progress?: boolean | undefined;
  /** Shows the button that scrolls to today. */
  readonly today_button?: boolean | undefined;
  /** Shows the view mode selector. */
  readonly view_mode_select?: boolean | undefined;
  /** When the popup opens: `'click'` or `'hover'`. */
  readonly popup_on?: string | undefined;
  /** Whether the timeline grows when the user scrolls to its end. */
  readonly infinite_padding?: boolean | undefined;
  /** Where the chart is scrolled to when it is created. */
  readonly scroll_to?: string | Date | undefined;
  /** Turns editing from the UI off. */
  readonly readonly?: boolean | undefined;
  /** Turns the editing of dates off. */
  readonly readonly_dates?: boolean | undefined;
  /** Turns the editing of progress off. */
  readonly readonly_progress?: boolean | undefined;
  /** Keeps the length of a task when its bar is dragged. */
  readonly fixed_duration?: boolean | undefined;
  /** Whether a dragged task moves the tasks that depend on it. */
  readonly move_dependencies?: boolean | undefined;
  /** Any other key (an event or an option that is not converted, a misspelling). */
  readonly [key: string]: unknown;
}

/**
 * The options `fromFrappeGanttOptions` can produce: a subset of the options of `createGantt`
 * (`@ganttlane/dom`; `createGanttCore` ignores the renderer's `display`, `toolbar` and `tooltip`,
 * and `layout.height`). Every value was checked by the adapter, so the type is what it says.
 */
export interface MigratedOptions {
  readonly viewMode?: string;
  readonly viewModes?: Readonly<
    Record<
      string,
      {
        readonly label?: string;
        readonly pxPerDay?: number;
        readonly padding?: string | readonly [string, string];
        readonly snap?: string;
      }
    >
  >;
  readonly locale?: string;
  readonly layout?: {
    readonly barHeight?: number;
    readonly barRadius?: number;
    readonly rowHeight?: number;
    readonly headerRowHeight?: readonly [number, number];
    readonly height?: number | 'auto';
  };
  readonly display?: {
    readonly gridLines?: 'both' | 'vertical' | 'horizontal' | 'none';
    readonly linkCurveRadius?: number;
    readonly stickyBarLabels?: false;
    readonly expectedProgress?: false;
  };
  readonly toolbar?: false;
  readonly tooltip?: { readonly trigger?: 'click' | 'hover' };
  readonly editing?:
    false | { readonly move?: false; readonly resize?: false; readonly progress?: false };
  readonly scheduling?: { readonly snap?: string; readonly propagation?: 'preserve-lag' | 'none' };
  readonly scroll?: { readonly initial?: string | Date };
  readonly timeline?: { readonly infinite?: boolean };
}

/**
 * Why an option was not converted:
 * - `'manual'`: it has a place in ganttlane, but its value or contract differs; rewrite it;
 * - `'unsupported'`: it is on, and ganttlane cannot do it yet (it is not in the result, and the
 *   feature stays off);
 * - `'removed'`: ganttlane has no such option;
 * - `'unknown'`: it is not an option of frappe-gantt (a misspelling, say).
 */
export type FrappeUnmappedReason = 'manual' | 'unsupported' | 'removed' | 'unknown';

/** An option of frappe-gantt that is not in the result, and what to do about it. */
export interface FrappeUnmappedOption {
  /** The key as given; `view_modes[2]` or `view_modes[2].upper_text` for a part of a list. */
  readonly key: string;
  /** Why it is not in the result. */
  readonly reason: FrappeUnmappedReason;
  /** What to do, in English. */
  readonly message: string;
  /** The value as given. */
  readonly value: unknown;
  /** A start for the replacement, when there is one (a view mode of your own). */
  readonly suggested?: unknown;
}

/** A remark about an option that was converted: the result is not the same behaviour. */
export interface FrappeConversionNote {
  /** The key as given. */
  readonly key: string;
  /** What differs, in English. */
  readonly message: string;
}

/** The result of {@link fromFrappeGanttOptions}. */
export interface FrappeGanttConversion {
  /** The options of ganttlane. */
  readonly options: MigratedOptions;
  /** Remarks about converted options whose behaviour differs. */
  readonly notes: readonly FrappeConversionNote[];
  /**
   * Every key that is not in `options`. The keys are in the order given, except those that are
   * read together with others (`padding`, `bar_height`, the header heights, `column_width` and
   * the read-only flags), which come last.
   */
  readonly unmapped: readonly FrappeUnmappedOption[];
}

type Check = (value: unknown) => boolean;

const isString: Check = (value) => typeof value === 'string';
const isBoolean: Check = (value) => typeof value === 'boolean';
const oneOf =
  (...values: readonly unknown[]): Check =>
  (value) =>
    values.includes(value);

const GRID_LINES: Check = /* @__PURE__ */ oneOf('both', 'vertical', 'horizontal', 'none');
const POPUP_ON: Check = /* @__PURE__ */ oneOf('click', 'hover');

/** Options copied as they are: the path in the result and what the value must be. */
const DIRECT: Readonly<Record<string, readonly [path: string, accepts: Check]>> =
  /* @__PURE__ */ Object.freeze({
    language: ['locale', isString],
    bar_height: ['layout.barHeight', isSize],
    bar_corner_radius: ['layout.barRadius', isSize],
    container_height: ['layout.height', (value) => isSize(value) || value === 'auto'],
    arrow_curve: ['display.linkCurveRadius', isSize],
    lines: ['display.gridLines', GRID_LINES],
    popup_on: ['tooltip.trigger', POPUP_ON],
    infinite_padding: ['timeline.infinite', isBoolean],
    scroll_to: ['scroll.initial', (value) => isString(value) || value instanceof Date],
  });

/**
 * Switches that ganttlane reserves, by the option that turns them off: off is converted (a
 * toolbar object, even with everything off, counts as a toolbar that is on, so the toolbar is
 * `false`), on is `'unsupported'`.
 */
const RESERVED: Readonly<Record<string, string>> = /* @__PURE__ */ Object.freeze({
  auto_move_label: 'display.stickyBarLabels',
  show_expected_progress: 'display.expectedProgress',
  today_button: 'toolbar',
  view_mode_select: 'toolbar',
});

/** Options with a place in ganttlane whose value or contract differs, so they are not converted. */
const MANUAL: ReadonlySet<string> = /* @__PURE__ */ new Set([
  'popup',
  'ignore',
  'is_weekend',
  'holidays',
  'on_click',
  'on_double_click',
  'on_hover',
  'on_date_change',
  'on_progress_change',
  'on_view_change',
]);

/** Options that are read together with others, after the first pass. */
const COMPOSITE: ReadonlySet<string> = /* @__PURE__ */ new Set([
  'padding',
  'upper_header_height',
  'lower_header_height',
  'column_width',
  'readonly',
  'readonly_dates',
  'readonly_progress',
  'fixed_duration',
]);

/** The `step` of the presets of frappe-gantt, by the id they have in ganttlane. */
const PRESET_STEPS: Readonly<Record<string, string>> = /* @__PURE__ */ Object.freeze({
  hour: '1h',
  'quarter-day': '6h',
  'half-day': '12h',
  day: '1d',
  week: '7d',
  month: '1m',
  year: '1y',
});

/** A duration of frappe-gantt: a number and one of `y`, `m` (month), `d`, `h`, `min`. */
const DURATION = /^(\d+)(y|m|d|h|min)$/;
/** The same units in ganttlane's duration syntax, and the days one of them spans on average. */
const UNITS: Readonly<Record<string, readonly [text: string, days: number]>> =
  /* @__PURE__ */ Object.freeze({
    y: ['y', 365.25],
    m: ['mo', 30.4375],
    d: ['d', 1],
    h: ['h', 1 / 24],
    min: ['min', 1 / 1440],
  });
/** The column unit of ganttlane for a `step` unit of frappe-gantt. */
const COLUMNS: Readonly<Record<string, string>> = /* @__PURE__ */ Object.freeze({
  y: 'year',
  m: 'month',
  d: 'day',
  h: 'hour',
});

/** The id a view mode gets: `'Quarter Day'` → `'quarter-day'`. */
const idOf = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, '-');

/** A duration of frappe-gantt in the syntax of ganttlane (`'1m'` → `'1mo'`), `undefined` if unusable. */
function durationOf(value: unknown): string | undefined {
  const found = typeof value === 'string' ? DURATION.exec(value) : null;
  const unit = UNITS[found?.[2] ?? ''];
  return found === null || unit === undefined ? undefined : `${found[1] ?? ''}${unit[0]}`;
}

/**
 * Pixels per day of a column `width` px wide that spans `step`, to four decimals; `undefined` if
 * the width or the step is unusable.
 */
function pxPerDayOf(width: number, step: unknown): number | undefined {
  const found = typeof step === 'string' ? DURATION.exec(step) : null;
  const unit = UNITS[found?.[2] ?? ''];
  const count = Number(found?.[1]);
  if (unit === undefined || !(count > 0) || !(width > 0)) return undefined;
  return Math.round((width / (count * unit[1])) * 10_000) / 10_000;
}

/** A padding of frappe-gantt (a duration, or a pair of them) in ganttlane's syntax. */
function paddingOf(value: unknown): string | readonly [string, string] | undefined {
  if (!Array.isArray(value)) return durationOf(value);
  const [before, after] = value.map(durationOf);
  return value.length === 2 && before !== undefined && after !== undefined
    ? [before, after]
    : undefined;
}

function put(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop() ?? path;
  let at = target;
  for (const key of keys) at = (at[key] ??= {}) as Record<string, unknown>;
  at[last] = value;
}

/**
 * Turns the options of the public frappe-gantt library into options of ganttlane.
 *
 * Nothing is dropped silently. What cannot be turned is listed in `unmapped` with a reason; what
 * was turned but behaves differently has a remark in `notes`. Only the keys that were given are
 * converted: defaults that differ between the libraries (the popup opens on hover, the timeline
 * does not grow, weekends are days off) stay as ganttlane has them. The input is not modified,
 * nothing throws, and a value of the wrong type is reported, not copied.
 *
 * Events (`on_click` and the rest), `popup`, `holidays`, `ignore` and `is_weekend` have other
 * arguments and shapes, so they are `'manual'`. Tasks are not converted.
 *
 * @example
 * ```ts
 * import { fromFrappeGanttOptions } from '@ganttlane/core/migrate';
 *
 * const { options, notes, unmapped } = fromFrappeGanttOptions({
 *   view_mode: 'Week',
 *   bar_height: 24,
 *   padding: 16,
 *   readonly: true,
 *   on_click: (task) => open(task.id),
 * });
 * // options: { viewMode: 'week', layout: { barHeight: 24, rowHeight: 40 }, editing: false }
 * // unmapped: [{ key: 'on_click', reason: 'manual', … }]
 * createGantt(container, { ...options, tasks });
 * ```
 *
 * @param old - The options object given to `new Gantt(element, tasks, options)`.
 * @returns The options, the remarks and the keys that were not converted.
 */
export function fromFrappeGanttOptions(old: FrappeGanttOptions): FrappeGanttConversion {
  const options: Record<string, unknown> = {};
  const notes: FrappeConversionNote[] = [];
  const unmapped: FrappeUnmappedOption[] = [];
  const skip = (
    key: string,
    reason: FrappeUnmappedReason,
    message: string,
    value: unknown,
    suggested?: unknown,
  ): void => {
    unmapped.push({
      key,
      reason,
      message,
      value,
      ...(suggested === undefined ? {} : { suggested }),
    });
  };
  const note = (key: string, message: string): void => {
    notes.push({ key, message });
  };
  const result = (): FrappeGanttConversion => ({ options, notes, unmapped });
  if (!isRecord(old)) {
    skip('', 'unknown', 'is not an options object', old);
    return result();
  }

  /** A flag that must be a boolean; `undefined` when it is not given or not usable (reported). */
  const flag = (key: string): boolean | undefined => {
    const value = old[key];
    if (typeof value === 'boolean') return value;
    if (value !== undefined) skip(key, 'manual', 'is not a boolean', value);
    return undefined;
  };
  /** A duration of frappe-gantt in the syntax of ganttlane (reported when unusable). */
  const duration = (key: string, value: unknown): string | undefined => {
    const text = durationOf(value);
    if (text === undefined) skip(key, 'manual', 'is not a duration like "1d", "7d" or "1h"', value);
    return text;
  };
  const steps: Record<string, unknown> = { ...PRESET_STEPS };
  const named = new Set<string>();
  const viewModes: Record<string, Record<string, unknown>> = {};
  // The width of a column that frappe-gantt applies to every view mode, over their own.
  let width: number | undefined;
  if (old.column_width !== undefined && old.column_width !== null) {
    if (isNumber(old.column_width) && old.column_width > 0) width = old.column_width;
    else skip('column_width', 'manual', 'is not a positive number', old.column_width);
  }

  /** One entry of `view_modes`: a name, or an object that defines or overrides a mode. */
  const viewModeOf = (entry: unknown, index: number): void => {
    const at = `view_modes[${index}]`;
    const name = isRecord(entry) ? entry.name : entry;
    if (typeof name !== 'string') {
      skip(at, 'manual', 'is not a view mode', entry);
      return;
    }
    const id = idOf(name);
    named.add(id);
    const preset = Object.hasOwn(PRESET_STEPS, id);
    if (!isRecord(entry)) {
      // A name alone is a preset, and ganttlane has all of them.
      if (!preset) skip(at, 'manual', 'is no preset: give an object', entry);
      return;
    }
    const mode: Record<string, unknown> = { label: name };
    const step = typeof entry.step === 'string' ? entry.step : undefined;
    if (step !== undefined) steps[id] = step;
    if (entry.padding !== undefined) {
      mode.padding = paddingOf(entry.padding);
      if (mode.padding === undefined) {
        skip(`${at}.padding`, 'manual', 'is not a duration or a pair', entry.padding);
      }
    }
    if (entry.snap_at != null) mode.snap = duration(`${at}.snap_at`, entry.snap_at);
    const columnWidth = width ?? entry.column_width;
    if (columnWidth != null) {
      mode.pxPerDay = isNumber(columnWidth) ? pxPerDayOf(columnWidth, steps[id]) : undefined;
      if (mode.pxPerDay === undefined && width === undefined) {
        skip(`${at}.column_width`, 'manual', 'needs a positive width and a step', columnWidth);
      }
    }
    for (const field of ['upper_text', 'lower_text', 'thick_line']) {
      if (entry[field] === undefined) continue;
      skip(
        `${at}.${field}`,
        'manual',
        'see `viewModes.<id>.headers` and `majorLine`',
        entry[field],
      );
    }
    for (const field of ['date_format', 'upper_text_frequency']) {
      if (entry[field] === undefined) continue;
      skip(`${at}.${field}`, 'removed', removedFrappeReason(field) ?? 'is not used', entry[field]);
    }
    // A field that could not be converted is reported above and is not a key with `undefined`.
    const given = Object.fromEntries(
      Object.entries(mode).filter(([, value]) => value !== undefined),
    );
    if (preset) {
      viewModes[id] = given;
      if (step !== undefined && step !== PRESET_STEPS[id]) {
        skip(
          `${at}.step`,
          'manual',
          'changes the column of a preset: make a view mode of your own',
          step,
        );
      }
      return;
    }
    const column = DURATION.exec(step ?? '');
    const unit = COLUMNS[column?.[2] ?? ''];
    skip(at, 'manual', 'a view mode of your own needs `headers`: complete the suggestion', entry, {
      id,
      ...given,
      ...(unit === undefined ? {} : { unit, step: Number(column?.[1]) }),
    });
  };

  for (const [key, value] of Object.entries(old)) {
    // `snap_at: null` is its default: no snap step of its own.
    if (value === undefined || COMPOSITE.has(key) || (key === 'snap_at' && value === null))
      continue;
    const direct = Object.hasOwn(DIRECT, key) ? DIRECT[key] : undefined;
    const reserved = Object.hasOwn(RESERVED, key) ? RESERVED[key] : undefined;
    const reason = removedFrappeReason(key);
    if (direct !== undefined) {
      if (direct[1](value)) put(options, direct[0], value);
      else skip(key, 'manual', `is not usable as ${direct[0]}`, value);
    } else if (reserved !== undefined) {
      if (value === false) put(options, reserved, false);
      else if (value === true) {
        skip(key, 'unsupported', `${renamedFrappeName(key) ?? key} is not available yet`, value);
      } else skip(key, 'manual', 'is not a boolean', value);
    } else if (key === 'view_mode') {
      if (typeof value === 'string') options.viewMode = idOf(value);
      else skip(key, 'manual', 'is not a view mode name', value);
    } else if (key === 'view_modes') {
      if (!Array.isArray(value)) skip(key, 'manual', 'is not a list of view modes', value);
      else {
        value.forEach(viewModeOf);
        if (!Object.keys(PRESET_STEPS).every((id) => named.has(id))) {
          note(key, 'ganttlane keeps all seven presets');
        }
      }
    } else if (key === 'snap_at') {
      const snap = duration(key, value);
      if (snap !== undefined) put(options, 'scheduling.snap', snap);
    } else if (key === 'move_dependencies') {
      if (typeof value !== 'boolean') skip(key, 'manual', 'is not a boolean', value);
      else {
        put(options, 'scheduling.propagation', value ? 'preserve-lag' : 'none');
        if (!value) {
          note(key, 'children still follow their parent (hierarchy.moveChildren)');
        }
      }
    } else if (MANUAL.has(key)) {
      skip(key, 'manual', `has another contract: see ${renamedFrappeName(key) ?? key}`, value);
    } else if (reason !== undefined) skip(key, 'removed', reason, value);
    else skip(key, 'unknown', 'is not an option of frappe-gantt', value);
  }

  // Options that need others: the row height, the header, the width of a column, editing.
  if (old.padding !== undefined || old.bar_height !== undefined) {
    // The row of frappe-gantt is the bar and the gap under it; the gap is 18 unless given.
    const barHeight = old.bar_height ?? 30;
    const gap = old.padding ?? 18;
    if (isSize(barHeight) && isSize(gap)) {
      put(options, 'layout.rowHeight', barHeight + gap);
      note(
        old.padding === undefined ? 'bar_height' : 'padding',
        `the row was bar_height + padding; layout.rowHeight is ${barHeight + gap}`,
      );
    } else if (old.padding !== undefined) {
      const why = isSize(gap) ? 'needs a usable bar_height' : 'is not a size in px';
      skip('padding', 'manual', why, old.padding);
    }
  }
  if (old.upper_header_height !== undefined || old.lower_header_height !== undefined) {
    const upper = old.upper_header_height ?? 45;
    const lower = old.lower_header_height ?? 30;
    if (isSize(upper) && isSize(lower)) put(options, 'layout.headerRowHeight', [upper, lower]);
    else
      skip('upper_header_height', 'manual', 'the header heights must be sizes in px', [
        upper,
        lower,
      ]);
  }
  if (width !== undefined) {
    for (const id of Object.keys(PRESET_STEPS)) {
      viewModes[id] = { ...viewModes[id], pxPerDay: pxPerDayOf(width, steps[id]) };
    }
    note('column_width', 'is pixels per column in every view mode; pxPerDay is pixels per day');
  }
  if (Object.keys(viewModes).length > 0) options.viewModes = viewModes;
  const [readonly, readonlyDates, readonlyProgress, fixedDuration] = [
    'readonly',
    'readonly_dates',
    'readonly_progress',
    'fixed_duration',
  ].map(flag);
  if (readonly === true) options.editing = false;
  else {
    if (readonlyDates === true) {
      put(options, 'editing.move', false);
      put(options, 'editing.resize', false);
    }
    if (readonlyProgress === true) put(options, 'editing.progress', false);
    if (fixedDuration === true) {
      put(options, 'editing.resize', false);
      note('fixed_duration', 'hides the resize handles of every task');
    }
  }
  return result();
}
