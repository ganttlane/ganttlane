/**
 * View modes (FR-SCALE-2, FR-SCALE-3, `docs/api.md` §3): zoom presets with their column unit,
 * `pxPerDay`, header rows, grid lines, default snap step and timeline padding, plus
 * {@link resolveViewModes}, which merges caller overrides over the presets and validates them.
 */

import { DEV, isRecord, shortMessage } from '../shared';
import {
  asDateTimeMs,
  createFloatingAdapter,
  type DateAdapter,
  type DateTimeMs,
  type DurationInput,
  parseDuration,
  type TimeUnit,
} from '../time';
import { checkDuration, describeValue, freezeCopy, joinPath, type Report } from './check';
import type { ScaleIssue } from './issues';
import { checkSnapInput, isSnapOptionsObject, type SnapInput } from './snap-input';

/** Id of a built-in view mode preset (FR-SCALE-2). */
export type ViewModeId = 'hour' | 'quarter-day' | 'half-day' | 'day' | 'week' | 'month' | 'year';

/** Column unit of a view mode: one column is `step` of these (`{ unit: 'hour', step: 6 }`). */
export type ViewModeUnit = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

/** The interval of one header cell: `[start, end)`, so `end` is the start of the next cell. */
export interface HeaderCellRange {
  /** First instant of the cell. */
  readonly start: DateTimeMs;
  /** Exclusive end of the cell. */
  readonly end: DateTimeMs;
}

/**
 * Builds the label of a header cell, e.g. a week as `"2–8"`. Called with floating time and the
 * chart's {@link DateAdapter}, so read dates through `adapter.getParts` / `adapter.format`, never
 * through local `Date` getters. A function that ignores `adapter` (`(range, locale) => …`) fits
 * too.
 */
export type HeaderFormatter = (
  range: HeaderCellRange,
  locale: string,
  adapter: DateAdapter,
) => string;

/** One header row (FR-SCALE-4): cells of `step` × `unit` each, labelled by `format`. */
export interface HeaderRowSpec {
  /** Unit of one cell; cells are merged across columns (a month row over day columns). */
  readonly unit: TimeUnit;
  /** Units per cell, a positive integer, default `1` (`{ unit: 'year', step: 10 }` = decades). */
  readonly step?: number;
  /**
   * `Intl.DateTimeFormat` options applied to the cell start through `adapter.format`, or a
   * formatter for the whole cell range.
   */
  readonly format: Intl.DateTimeFormatOptions | HeaderFormatter;
}

/**
 * Where major grid lines go (FR-SCALE-5): at every start of a unit (`{ unit: 'week' }`) or
 * wherever the predicate returns `true` for a column start.
 */
export type MajorLineSpec = { readonly unit: TimeUnit } | ((date: DateTimeMs) => boolean);

/** Extra timeline before and after the data: one duration for both sides or `[before, after]`. */
export type PaddingInput = DurationInput | readonly [before: DurationInput, after: DurationInput];

/**
 * A zoom level of the chart (FR-SCALE-3): column unit and width, header rows, grid lines,
 * default snap step and padding. Built-in presets are in {@link VIEW_MODE_PRESETS}; pass
 * overrides or custom modes through {@link resolveViewModes}.
 */
export interface ViewMode {
  /** Unique id, e.g. `'day'`; presets use kebab-case ids ({@link ViewModeId}). */
  readonly id: ViewModeId | (string & Record<never, never>);
  /** Display name (for a view mode switcher); translate it here, separately from `id`. */
  readonly label?: string;
  /** Column unit. */
  readonly unit: ViewModeUnit;
  /** Units per column, a positive integer, default `1` (`6` with `'hour'` = quarter days). */
  readonly step?: number;
  /** Zoom level: pixels per floating day, finite and greater than `0`. */
  readonly pxPerDay: number;
  /** Header rows, top first; at least one (FR-SCALE-4). */
  readonly headers: readonly HeaderRowSpec[];
  /** Major grid lines (FR-SCALE-5); `false` or absent for none. */
  readonly majorLine?: MajorLineSpec | false;
  /**
   * Minor grid lines every given duration, e.g. `'15min'` in the hour mode (FR-SNAP-9): one kind
   * of step, calendar (`'1mo'`) or fixed (`'15min'`, `'1d 12h'`), not both. `gridLines` leaves
   * them out while they are denser than a pixel threshold. `false` or absent for none.
   */
  readonly minorLine?: DurationInput | false;
  /**
   * Default snap step of this mode (FR-SNAP-5); `scheduling.snap` overrides it. Only the syntax
   * is checked here: alignment to `scheduling.granularity` happens when snap is resolved.
   */
  readonly snap?: SnapInput;
  /** Timeline padding around the data in this mode. */
  readonly padding?: PaddingInput;
}

/**
 * A partial {@link ViewMode} for the record form of {@link resolveViewModes}. Each field that is
 * set replaces the preset's field as a whole (`headers` is replaced, not concatenated); fields
 * that are absent or `undefined` keep the preset's value. Use `false` to remove a preset's
 * `majorLine`, `minorLine` or `snap`.
 *
 * `snap` in object form (`SnapOptions`) is the exception: it is merged over the preset's snap
 * field by field, and a preset step such as `'1d'` counts as its `step`, so
 * `{ snap: { mode: 'relative' } }` keeps the preset step. Durations inside those fields are still
 * replaced whole, and any other snap (a step, `'unit'`, `false`) replaces the preset's snap.
 */
export type ViewModeOverride = { readonly [K in keyof ViewMode]?: ViewMode[K] | undefined };

/**
 * The record form of the `viewModes` option: overrides keyed by view mode id. A preset id merges
 * the override over that preset; any other id adds a new mode, which must then be complete
 * (`unit`, `pxPerDay`, `headers`; the key is its id).
 */
export type ViewModeOverrides = Readonly<
  Partial<Record<ViewModeId, ViewModeOverride | undefined>>
> &
  Readonly<Record<string, ViewModeOverride | undefined>>;

/**
 * The `viewModes` option: a complete list of view modes (replaces the presets) or
 * {@link ViewModeOverrides} (merged over the presets).
 */
export type ViewModesInput = readonly ViewMode[] | ViewModeOverrides;

/** Result of {@link resolveViewModes}. */
export interface ResolvedViewModes {
  /** Valid view modes in order, deeply frozen; never empty. */
  readonly modes: readonly ViewMode[];
  /** Problems found in the input; invalid modes are left out of `modes`. */
  readonly issues: readonly ScaleIssue[];
}

type Writable<T> = { -readonly [K in keyof T]: T[K] };

const MONTH_AND_YEAR: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' };
const DAY_AND_MONTH: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
const DAY_AND_SHORT_MONTH: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
const DAY_NUMBER: Intl.DateTimeFormatOptions = { day: 'numeric' };
const HOUR_NUMBER: Intl.DateTimeFormatOptions = { hour: 'numeric' };
const MONTH_NAME: Intl.DateTimeFormatOptions = { month: 'long' };
const YEAR_NUMBER: Intl.DateTimeFormatOptions = { year: 'numeric' };

/** The last instant inside a cell (its end is exclusive). */
function lastInstant({ start, end }: HeaderCellRange): DateTimeMs {
  return asDateTimeMs(Math.max(start, end - 1));
}

/** Week cell label: `"2–8"` inside one month, `"Mar 30 – Apr 5"` across months. */
function formatWeekRange(range: HeaderCellRange, locale: string, adapter: DateAdapter): string {
  const last = lastInstant(range);
  const first = adapter.getParts(range.start);
  const final = adapter.getParts(last);
  const format = (t: DateTimeMs, options: Intl.DateTimeFormatOptions): string =>
    adapter.format(t, options, locale);
  if (first.year === final.year && first.month === final.month) {
    if (first.day === final.day) return format(range.start, DAY_AND_SHORT_MONTH);
    return `${format(range.start, DAY_NUMBER)}–${format(last, DAY_NUMBER)}`;
  }
  return `${format(range.start, DAY_AND_SHORT_MONTH)} – ${format(last, DAY_AND_SHORT_MONTH)}`;
}

/** Decade cell label: `"2020–2029"`. */
function formatYearRange(range: HeaderCellRange, locale: string, adapter: DateAdapter): string {
  const first = adapter.format(range.start, YEAR_NUMBER, locale);
  const final = adapter.format(lastInstant(range), YEAR_NUMBER, locale);
  return first === final ? first : `${first}–${final}`;
}

/**
 * The built-in view modes (FR-SCALE-2), deeply frozen, from the finest to the coarsest:
 *
 * | id | column | pxPerDay | headers | majorLine | minorLine | snap | padding |
 * |---|---|---|---|---|---|---|---|
 * | `hour` | 1 h | 960 | day / hour | day | `15min` | `15min` | `7d` |
 * | `quarter-day` | 6 h | 160 | day / 6 h | day | `1h` | `1h` | `7d` |
 * | `half-day` | 12 h | 80 | day / 12 h | day | `1h` | `1h` | `14d` |
 * | `day` | 1 d | 40 | month / day | week | — | `1d` | `14d` |
 * | `week` | 1 w | 20 | month / week range | month | — | `1d` | `4w` |
 * | `month` | 1 mo | 4 | year / month | quarter | — | `1d` | `4mo` |
 * | `year` | 1 y | 1 | decade / year | — | — | `1mo` | `2y` |
 *
 * `pxPerDay` follows the fork's `day_width` except in `hour`: 960 instead of 240 gives 40 px hour
 * columns like the 40 px day columns of `day` (at 240 the hour labels do not fit and the 15-minute
 * minor lines, 2.5 px apart, never show). Snap defaults follow FR-SNAP-5 (raised to
 * `scheduling.granularity` when finer, FR-SNAP-14). Labels are English; override `label` to
 * translate them.
 */
export const VIEW_MODE_PRESETS: readonly ViewMode[] = /* @__PURE__ */ Object.freeze([
  /* @__PURE__ */ freezeViewMode({
    id: 'hour',
    label: 'Hour',
    unit: 'hour',
    pxPerDay: 960,
    headers: [
      { unit: 'day', format: DAY_AND_MONTH },
      { unit: 'hour', format: HOUR_NUMBER },
    ],
    majorLine: { unit: 'day' },
    minorLine: '15min',
    snap: '15min',
    padding: '7d',
  }),
  /* @__PURE__ */ freezeViewMode({
    id: 'quarter-day',
    label: 'Quarter day',
    unit: 'hour',
    step: 6,
    pxPerDay: 160,
    headers: [
      { unit: 'day', format: DAY_AND_MONTH },
      { unit: 'hour', step: 6, format: HOUR_NUMBER },
    ],
    majorLine: { unit: 'day' },
    minorLine: '1h',
    snap: '1h',
    padding: '7d',
  }),
  /* @__PURE__ */ freezeViewMode({
    id: 'half-day',
    label: 'Half day',
    unit: 'hour',
    step: 12,
    pxPerDay: 80,
    headers: [
      { unit: 'day', format: DAY_AND_SHORT_MONTH },
      { unit: 'hour', step: 12, format: HOUR_NUMBER },
    ],
    majorLine: { unit: 'day' },
    minorLine: '1h',
    snap: '1h',
    padding: '14d',
  }),
  /* @__PURE__ */ freezeViewMode({
    id: 'day',
    label: 'Day',
    unit: 'day',
    pxPerDay: 40,
    headers: [
      { unit: 'month', format: MONTH_AND_YEAR },
      { unit: 'day', format: DAY_NUMBER },
    ],
    majorLine: { unit: 'week' },
    snap: '1d',
    padding: '14d',
  }),
  /* @__PURE__ */ freezeViewMode({
    id: 'week',
    label: 'Week',
    unit: 'week',
    pxPerDay: 20,
    headers: [
      { unit: 'month', format: MONTH_AND_YEAR },
      { unit: 'week', format: formatWeekRange },
    ],
    majorLine: { unit: 'month' },
    snap: '1d',
    padding: '4w',
  }),
  /* @__PURE__ */ freezeViewMode({
    id: 'month',
    label: 'Month',
    unit: 'month',
    pxPerDay: 4,
    headers: [
      { unit: 'year', format: YEAR_NUMBER },
      { unit: 'month', format: MONTH_NAME },
    ],
    majorLine: { unit: 'quarter' },
    snap: '1d',
    padding: '4mo',
  }),
  /* @__PURE__ */ freezeViewMode({
    id: 'year',
    label: 'Year',
    unit: 'year',
    pxPerDay: 1,
    headers: [
      { unit: 'year', step: 10, format: formatYearRange },
      { unit: 'year', format: YEAR_NUMBER },
    ],
    snap: '1mo',
    padding: '2y',
  }),
]);

const PRESET_IDS: ReadonlySet<string> = /* @__PURE__ */ new Set(
  /* @__PURE__ */ VIEW_MODE_PRESETS.map((mode) => mode.id),
);

const VIEW_MODE_UNITS: Readonly<Record<ViewModeUnit, true>> = {
  hour: true,
  day: true,
  week: true,
  month: true,
  quarter: true,
  year: true,
};
const TIME_UNITS: Readonly<Record<TimeUnit, true>> = { minute: true, ...VIEW_MODE_UNITS };
const VIEW_MODE_FIELDS: Readonly<Record<keyof ViewMode, true>> = {
  id: true,
  label: true,
  unit: true,
  step: true,
  pxPerDay: true,
  headers: true,
  majorLine: true,
  minorLine: true,
  snap: true,
  padding: true,
};
const HEADER_FIELDS: Readonly<Record<keyof HeaderRowSpec, true>> = {
  unit: true,
  step: true,
  format: true,
};
/** View mode fields of frappe-gantt and their replacements, for migration hints. */
const RENAMED_FIELDS: ReadonlyMap<string, string> = /* @__PURE__ */ new Map([
  ['name', 'id and label'],
  ['day_width', 'pxPerDay'],
  ['column_width', 'pxPerDay'],
  ['upper_text', 'headers'],
  ['lower_text', 'headers'],
  ['thick_line', 'majorLine'],
  ['snap_at', 'snap'],
]);

/**
 * Resolves the `viewModes` option into the list of usable view modes (FR-SCALE-2, FR-SCALE-3).
 *
 * - No input: the presets ({@link VIEW_MODE_PRESETS}).
 * - Record form ({@link ViewModeOverrides}): each override is merged over the preset with the
 *   same id field by field (set fields replace the preset's, `headers` included; an object-form
 *   `snap` is merged over the preset's snap field by field, see {@link ViewModeOverride});
 *   presets keep their order and new ids follow in input order, but only when complete.
 * - Array form: a complete custom list that replaces the presets; ids must be unique (later
 *   duplicates are dropped).
 *
 * Every mode is validated (`'invalid-view-mode'` issues with a `path` such as `'day.pxPerDay'` or
 * `'[2].headers[0].unit'`): `pxPerDay` must be finite and positive, units known, steps positive
 * integers, `headers` non-empty with valid `Intl` options, and snap, line and padding durations
 * well-formed (`minorLine` a step of one kind, not `'1mo 1d'`). An invalid override of a preset
 * leaves the preset as it is, any other invalid mode is dropped, both with error issues; unknown
 * fields only produce warnings. When no valid mode is left, the presets are used and an error
 * issue says so.
 *
 * Never throws for bad input and never mutates the input or the presets; the result is deeply
 * frozen (formatter and major-line functions are kept as given).
 *
 * @param input - The `viewModes` option.
 * @returns The valid view modes, never empty, and the issues found.
 *
 * @example
 * ```ts
 * const { modes } = resolveViewModes({ day: { pxPerDay: 50 }, month: { snap: '1w' } });
 * modes.find((mode) => mode.id === 'day')?.pxPerDay; // 50
 * ```
 */
export function resolveViewModes(input?: ViewModesInput): ResolvedViewModes {
  const issues: ScaleIssue[] = [];
  const report: Report = (path, message, value, severity = 'error') => {
    const code = 'invalid-view-mode';
    const issue: ScaleIssue = {
      code,
      severity,
      message: DEV ? message : shortMessage(code, path),
      value,
    };
    issues.push(path === '' ? issue : { ...issue, path });
  };

  const raw: unknown = input;
  let modes: readonly ViewMode[] = VIEW_MODE_PRESETS;
  if (Array.isArray(raw)) {
    modes = resolveList(raw, report);
  } else if (isRecord(raw)) {
    modes = resolveOverrides(raw, report);
  } else if (raw !== undefined) {
    report(
      '',
      DEV
        ? `Invalid view modes ${describeValue(raw)}: expected a list of view modes or overrides keyed by id; the presets are used instead.`
        : '',
      raw,
    );
  }

  if (modes.length === 0) {
    report('', DEV ? 'No valid view mode is left: the presets are used instead.' : '', raw);
    modes = VIEW_MODE_PRESETS;
  }
  return Object.freeze({ modes: Object.freeze(modes), issues: Object.freeze(issues) });
}

function resolveList(list: readonly unknown[], report: Report): ViewMode[] {
  const modes: ViewMode[] = [];
  const seen = new Set<unknown>();
  list.forEach((item, index) => {
    const path = joinPath('', index);
    if (!isRecord(item)) {
      report(
        path,
        DEV
          ? `Invalid view mode ${describeValue(item)}: expected an object with id, unit, pxPerDay and headers.`
          : '',
        item,
      );
      return;
    }
    const id = item.id;
    if (typeof id === 'string' && seen.has(id)) {
      report(
        joinPath(path, 'id'),
        DEV ? `Duplicate view mode id "${id}": the later one is dropped.` : '',
        id,
      );
      return;
    }
    seen.add(id);
    const mode = readViewMode(item, path, report);
    if (mode) modes.push(mode);
  });
  return modes;
}

function resolveOverrides(
  overrides: Readonly<Record<string, unknown>>,
  report: Report,
): ViewMode[] {
  const modes: ViewMode[] = [];
  const add = (id: string, base: ViewMode | undefined): void => {
    const override = Object.hasOwn(overrides, id) ? overrides[id] : undefined;
    if (override === undefined) {
      if (base) modes.push(base);
      return;
    }
    const mode = readOverride(id, override, base, report);
    if (mode) modes.push(mode);
  };
  for (const preset of VIEW_MODE_PRESETS) add(preset.id, preset);
  for (const id of Object.keys(overrides)) if (!PRESET_IDS.has(id)) add(id, undefined);
  return modes;
}

/**
 * One override merged over its preset and validated. An unusable override of a preset leaves the
 * preset in place (its errors say so); one under a new id drops the mode.
 */
function readOverride(
  id: string,
  override: unknown,
  base: ViewMode | undefined,
  given: Report,
): ViewMode | undefined {
  const kept = DEV && base ? ` The "${id}" preset is kept.` : '';
  const report: Report = (path, message, value, severity = 'error') => {
    given(path, severity === 'error' ? message + kept : message, value, severity);
  };
  if (!isRecord(override)) {
    report(
      id,
      DEV
        ? `Invalid override ${describeValue(override)} for view mode "${id}": expected an object of view mode fields.`
        : '',
      override,
    );
    return base;
  }
  let valid = true;
  if (override.id !== undefined && override.id !== id) {
    report(
      joinPath(id, 'id'),
      DEV
        ? `The id ${describeValue(override.id)} does not match its key "${id}": in the record form the key is the id, leave id out.`
        : '',
      override.id,
    );
    valid = false;
  }
  // `fromEntries` defines own properties, so even a `__proto__` key stays plain data.
  const merged = Object.fromEntries([
    ...Object.entries(base ?? {}),
    ...definedEntries(override),
    ['id', id],
  ]);
  if (base?.snap !== undefined && isSnapOptionsObject(override.snap)) {
    merged.snap = mergeSnap(base.snap, override.snap);
  }
  const hint = DEV && !base ? ` ("${id}" is not a preset, so its view mode must be complete)` : '';
  const mode = readViewMode(merged, id, report, hint);
  return valid && mode ? mode : base;
}

/**
 * An object-form snap override merged over the preset's snap field by field; a preset step
 * (`'1d'`, `{ hours: 1 }`, `'unit'`, `false`) counts as `{ step }`. Fields of the override that
 * are `undefined` keep the preset's value; durations are replaced whole. Nothing is validated.
 *
 * @internal
 */
export function mergeSnap(
  base: SnapInput,
  override: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const baseEntries: [string, unknown][] = isSnapOptionsObject(base)
    ? Object.entries(base)
    : [['step', base]];
  return Object.fromEntries([...baseEntries, ...definedEntries(override)]);
}

/** The fields of a record that are not `undefined`. */
function definedEntries(record: Readonly<Record<string, unknown>>): [string, unknown][] {
  return Object.entries(record).filter(([, value]) => value !== undefined);
}

/** Validates a complete view mode candidate; returns its frozen copy, or nothing on errors. */
function readViewMode(
  source: Readonly<Record<string, unknown>>,
  path: string,
  report: Report,
  missingHint = '',
): ViewMode | undefined {
  let errors = 0;
  const fail: Report = (at, message, value) => {
    errors++;
    report(at, message, value);
  };
  const field = (key: keyof ViewMode): [path: string, value: unknown] => [
    joinPath(path, key),
    source[key],
  ];
  const missing = (key: string): string =>
    DEV ? `Missing ${key}: a view mode needs id, unit, pxPerDay and headers${missingHint}.` : '';

  const [idPath, id] = field('id');
  if (id === undefined) fail(idPath, missing('id'), id);
  else if (typeof id !== 'string' || id === '') {
    fail(
      idPath,
      DEV ? `Invalid view mode id ${describeValue(id)}: use a non-empty string.` : '',
      id,
    );
  }

  const [labelPath, label] = field('label');
  if (label !== undefined && typeof label !== 'string') {
    fail(labelPath, DEV ? `Invalid label ${describeValue(label)}: use a string.` : '', label);
  }

  const [unitPath, unit] = field('unit');
  if (unit === undefined) fail(unitPath, missing('unit'), unit);
  else if (!isKeyOf(VIEW_MODE_UNITS, unit)) {
    fail(
      unitPath,
      DEV
        ? `Invalid unit ${describeValue(unit)}: use hour, day, week, month, quarter or year.`
        : '',
      unit,
    );
  }

  checkStep(...field('step'), fail);

  const [pxPerDayPath, pxPerDay] = field('pxPerDay');
  if (pxPerDay === undefined) fail(pxPerDayPath, missing('pxPerDay'), pxPerDay);
  else if (typeof pxPerDay !== 'number' || !Number.isFinite(pxPerDay) || pxPerDay <= 0) {
    fail(
      pxPerDayPath,
      DEV
        ? `Invalid pxPerDay ${describeValue(pxPerDay)}: use a finite number of pixels per day greater than 0, e.g. 40.`
        : '',
      pxPerDay,
    );
  }

  const [headersPath, headers] = field('headers');
  if (headers === undefined) fail(headersPath, missing('headers'), headers);
  else checkHeaders(headers, headersPath, fail, report);

  checkMajorLine(...field('majorLine'), fail, report);

  const [minorLinePath, minorLine] = field('minorLine');
  if (minorLine !== undefined && minorLine !== false) {
    checkMinorLine(minorLine, minorLinePath, fail);
  }

  const [snapPath, snap] = field('snap');
  if (snap !== undefined) checkSnapInput(snap, snapPath, fail);

  const [paddingPath, padding] = field('padding');
  if (padding !== undefined) checkPadding(padding, paddingPath, fail);

  warnUnknownFields(source, VIEW_MODE_FIELDS, path, report, 'view mode');

  // Every field has been checked against the ViewMode shape above.
  return errors === 0 ? freezeViewMode(source as unknown as ViewMode) : undefined;
}

function checkStep(path: string, step: unknown, fail: Report): void {
  if (step !== undefined && !(Number.isSafeInteger(step) && (step as number) > 0)) {
    fail(
      path,
      DEV ? `Invalid step ${describeValue(step)}: use a positive integer such as 6.` : '',
      step,
    );
  }
}

function checkMinorLine(minorLine: unknown, path: string, fail: Report): void {
  if (!checkDuration(minorLine, path, fail, false)) return;
  const parsed = parseDuration(minorLine as DurationInput);
  if (parsed.ok && parsed.value.months > 0 && parsed.value.ms > 0) {
    fail(
      path,
      DEV
        ? `Invalid minorLine ${describeValue(minorLine)}: lines need a step of one kind, calendar ("1mo") or fixed ("15min", "1d 12h").`
        : '',
      minorLine,
    );
  }
}

function checkHeaders(headers: unknown, path: string, fail: Report, report: Report): void {
  if (!Array.isArray(headers) || headers.length === 0) {
    fail(
      path,
      DEV
        ? `Invalid headers ${describeValue(headers)}: use a non-empty list of rows such as [{ unit: 'month', format: { month: 'long' } }].`
        : '',
      headers,
    );
    return;
  }
  const rows: readonly unknown[] = headers;
  rows.forEach((row, index) => {
    const rowPath = joinPath(path, index);
    if (!isRecord(row)) {
      fail(
        rowPath,
        DEV ? `Invalid header row ${describeValue(row)}: expected { unit, step?, format }.` : '',
        row,
      );
      return;
    }
    const unit = row.unit;
    if (!isKeyOf(TIME_UNITS, unit)) {
      fail(
        joinPath(rowPath, 'unit'),
        DEV
          ? `Invalid header unit ${describeValue(unit)}: use minute, hour, day, week, month, quarter or year.`
          : '',
        unit,
      );
    }
    checkStep(joinPath(rowPath, 'step'), row.step, fail);
    checkFormat(row.format, joinPath(rowPath, 'format'), fail);
    warnUnknownFields(row, HEADER_FIELDS, rowPath, report, 'header row');
  });
}

function checkFormat(format: unknown, path: string, fail: Report): void {
  if (typeof format === 'function') return;
  if (!isRecord(format)) {
    fail(
      path,
      DEV
        ? `Invalid header format ${describeValue(format)}: use Intl.DateTimeFormat options such as { month: 'long' } or a function (range, locale, adapter) => string.`
        : '',
      format,
    );
    return;
  }
  try {
    createFloatingAdapter().format(asDateTimeMs(0), format, 'en');
  } catch (error) {
    fail(
      path,
      DEV
        ? `Invalid Intl.DateTimeFormat options: ${error instanceof Error ? error.message : String(error)}`
        : '',
      format,
    );
  }
}

function checkMajorLine(path: string, majorLine: unknown, fail: Report, report: Report): void {
  if (majorLine === undefined || majorLine === false || typeof majorLine === 'function') return;
  if (!isRecord(majorLine)) {
    fail(
      path,
      DEV
        ? `Invalid majorLine ${describeValue(majorLine)}: use { unit: 'week' }, a function (date) => boolean or false.`
        : '',
      majorLine,
    );
    return;
  }
  const unit = majorLine.unit;
  if (!isKeyOf(TIME_UNITS, unit)) {
    fail(
      joinPath(path, 'unit'),
      DEV
        ? `Invalid majorLine unit ${describeValue(unit)}: use minute, hour, day, week, month, quarter or year.`
        : '',
      unit,
    );
  }
  warnUnknownFields(majorLine, { unit: true }, path, report, 'majorLine');
}

function checkPadding(padding: unknown, path: string, fail: Report): void {
  if (!Array.isArray(padding)) {
    checkDuration(padding, path, fail, true);
    return;
  }
  const sides: readonly unknown[] = padding;
  if (sides.length !== 2) {
    fail(
      path,
      DEV
        ? `Invalid padding: a pair needs exactly two durations [before, after], got ${sides.length}.`
        : '',
      padding,
    );
    return;
  }
  sides.forEach((side, index) => checkDuration(side, joinPath(path, index), fail, true));
}

function warnUnknownFields(
  source: Readonly<Record<string, unknown>>,
  known: Readonly<Record<string, true>>,
  path: string,
  report: Report,
  owner: string,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (Object.hasOwn(known, key) || value === undefined) continue;
    report(
      joinPath(path, key),
      DEV ? `Unknown ${owner} field "${key}" is ignored${renamedHint(key)}.` : '',
      value,
      'warning',
    );
  }
}

/** The migration hint for a frappe-gantt view mode field (development build only). */
function renamedHint(key: string): string {
  const renamed = RENAMED_FIELDS.get(key);
  return renamed === undefined ? '' : `: use ${renamed} instead`;
}

function isKeyOf<K extends string>(record: Readonly<Record<K, true>>, value: unknown): value is K {
  return typeof value === 'string' && Object.hasOwn(record, value);
}

/** Deeply frozen copy of a valid view mode with only its known fields. */
function freezeViewMode(mode: ViewMode): ViewMode {
  const copy: Writable<ViewMode> = {
    id: mode.id,
    unit: mode.unit,
    pxPerDay: mode.pxPerDay,
    headers: Object.freeze(mode.headers.map(freezeHeaderRow)),
  };
  if (mode.label !== undefined) copy.label = mode.label;
  if (mode.step !== undefined) copy.step = mode.step;
  if (mode.majorLine !== undefined) {
    copy.majorLine = isRecord(mode.majorLine)
      ? Object.freeze({ unit: mode.majorLine.unit })
      : mode.majorLine;
  }
  if (mode.minorLine !== undefined) copy.minorLine = freezeCopy(mode.minorLine);
  if (mode.snap !== undefined) copy.snap = freezeCopy(mode.snap);
  if (mode.padding !== undefined) copy.padding = freezeCopy(mode.padding);
  return Object.freeze(copy);
}

function freezeHeaderRow(row: HeaderRowSpec): HeaderRowSpec {
  const copy: Writable<HeaderRowSpec> = { unit: row.unit, format: freezeCopy(row.format) };
  if (row.step !== undefined) copy.step = row.step;
  return Object.freeze(copy);
}
