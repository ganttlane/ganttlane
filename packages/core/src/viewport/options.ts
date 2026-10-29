/**
 * The caller's `timeline` and `scroll` options: defaults, parsing of dates and
 * durations, and typed issues for bad values. The viewport math takes the parsed values.
 */

import type { PaddingInput, TimeRange, ViewMode } from '../scale';
import { DEV, isRecord, isSize, type Issue, shortMessage } from '../shared';
import {
  asDateTimeMs,
  type DateInput,
  type DateTimeMs,
  DAY,
  type Duration,
  type DurationInput,
  parseDateInput,
  parseDuration,
} from '../time';
import type { ScrollAlign } from './align';
import type { AutoScrollOptions } from './autoscroll';
import { VIEWPORT_DEFAULTS } from './defaults';
import type { ExtensionPolicy, TimelineBounds } from './extension';
import type { InitialScroll } from './scroll';

/**
 * Issue codes of the `viewport` module: a `timeline` or a `scroll` option is unusable. Every
 * issue is an error; the value is replaced by its default (`suggested` when there is one).
 */
export type ViewportIssueCode = 'invalid-timeline-option' | 'invalid-scroll-option';

/** An {@link Issue} raised by the `viewport` module. */
export type ViewportIssue = Issue<ViewportIssueCode>;

/** The caller's `timeline.infinite` object. */
export interface InfiniteTimelineOptions {
  /** Distance in px to a range edge at which it is extended; default the viewport width. */
  readonly threshold?: number | undefined;
  /** One extension, e.g. `'1mo'`; default two viewport widths of time. */
  readonly extendBy?: DurationInput | undefined;
  /** Dates the timeline never extends past; a date-only `max` includes its whole day. */
  readonly bounds?:
    { readonly min?: DateInput | undefined; readonly max?: DateInput | undefined } | undefined;
  /** Longest range, e.g. `'5y'`: the far side is trimmed down to it. */
  readonly maxSpan?: DurationInput | undefined;
}

/** The caller's `timeline` options. */
export interface TimelineOptions {
  /** `'auto'` (default: from the tasks) or an explicit range; a date-only `end` is inclusive. */
  readonly range?: 'auto' | { readonly start: DateInput; readonly end: DateInput } | undefined;
  /** Padding around the data (`'14d'` or `['1w', '1mo']`); default the view mode's. */
  readonly padding?: PaddingInput | undefined;
  /** Whether the automatic range always contains today. Default `false`. */
  readonly includeToday?: boolean | undefined;
  /** The infinite timeline: `true` with defaults, or its settings. Default `false`. */
  readonly infinite?: boolean | InfiniteTimelineOptions | undefined;
}

/**
 * The caller's `scroll` options. Named apart from the DOM's
 * `ScrollOptions`, which renderers use next to it.
 */
export interface ScrollOptionsInput {
  /**
   * Initial scroll: a keyword or a date (`DateInput`: a `Date`, an ISO string, epoch ms).
   * Default `'today'`.
   */
  readonly initial?:
    | 'today'
    | 'start'
    | 'end'
    | 'first-task'
    | 'none'
    | Date
    | number
    | (string & Record<never, never>)
    | undefined;
  /** Behaviour of programmatic scrolls. Default `'smooth'`. */
  readonly behavior?: 'smooth' | 'instant' | 'auto' | undefined;
  /** Where scroll targets land. Default `'start'`. */
  readonly align?: ScrollAlign | undefined;
  /** Drag autoscroll near the edges, or `false` to turn it off. Default `{ edge: 40, maxSpeed: 20 }`. */
  readonly autoScroll?: AutoScrollOptions | false | undefined;
}

/** {@link TimelineOptions} parsed, with defaults applied. Frozen. */
export interface ResolvedTimelineOptions {
  /** The explicit range (end exclusive), or `undefined` for the automatic one. */
  readonly range: TimeRange | undefined;
  /** Padding before and after the data: the option, else the view mode's, else none. */
  readonly padding: readonly [before: Duration, after: Duration];
  /** Whether the automatic range contains today. */
  readonly includeToday: boolean;
  /**
   * The infinite timeline's settings (only the fields the caller set), or `undefined` when it is
   * off. Spread it into an `ExtensionPolicy` with the view mode's `columns`.
   */
  readonly infinite: InfinitePolicy | undefined;
}

/** The caller-set part of an `ExtensionPolicy`. */
export type InfinitePolicy = Pick<ExtensionPolicy, 'threshold' | 'extendBy' | 'bounds' | 'maxSpan'>;

/** Result of {@link resolveTimelineOptions}. Frozen. */
export interface ResolvedTimelineResult {
  /** The parsed options. */
  readonly options: ResolvedTimelineOptions;
  /** Problems found, in option order; paths are relative to `timeline` (`'infinite.extendBy'`). */
  readonly issues: readonly ViewportIssue[];
}

/** Context of {@link resolveTimelineOptions}. */
export interface TimelineOptionsContext {
  /** The current view mode, whose `padding` applies when `timeline.padding` is not set. */
  readonly viewMode?: Pick<ViewMode, 'padding'> | undefined;
  /** `dates.endInclusive`: a date-only range end or `bounds.max` covers its day. Default `true`. */
  readonly endInclusive?: boolean | undefined;
}

/** Autoscroll settings with defaults applied. */
export interface ResolvedAutoScroll {
  /** Zone width at each viewport edge, px. */
  readonly edge: number;
  /** Speed at the outer side of the zone, px per frame. */
  readonly maxSpeed: number;
}

/** {@link ScrollOptionsInput} parsed, with defaults applied. Frozen. */
export interface ResolvedScrollOptions {
  /** The initial scroll target (a date is parsed into floating time). */
  readonly initial: InitialScroll;
  /** Behaviour of programmatic scrolls. */
  readonly behavior: 'smooth' | 'instant' | 'auto';
  /** Where scroll targets land. */
  readonly align: ScrollAlign;
  /** Drag autoscroll, or `false`. */
  readonly autoScroll: ResolvedAutoScroll | false;
}

/** Result of {@link resolveScrollOptions}. Frozen. */
export interface ResolvedScrollResult {
  /** The parsed options. */
  readonly options: ResolvedScrollOptions;
  /** Problems found, in option order; paths are relative to `scroll` (`'autoScroll.edge'`). */
  readonly issues: readonly ViewportIssue[];
}

type Report = (path: string, message: string, value: unknown, suggested?: unknown) => void;

const ZERO: Duration = /* @__PURE__ */ Object.freeze({ months: 0, ms: 0 });
const NO_PADDING: readonly [Duration, Duration] = /* @__PURE__ */ Object.freeze([ZERO, ZERO]);
const INITIAL_KEYWORDS: ReadonlySet<unknown> = /* @__PURE__ */ new Set([
  'today',
  'start',
  'end',
  'first-task',
  'none',
]);
const BEHAVIORS: ReadonlySet<unknown> = /* @__PURE__ */ new Set(['smooth', 'instant', 'auto']);
const ALIGN_KEYWORDS: ReadonlySet<unknown> = /* @__PURE__ */ new Set(['start', 'center', 'end']);

/**
 * Parses the `timeline` options. Never throws: an unusable value gives an
 * `'invalid-timeline-option'` error and its default instead.
 *
 * - `range`: `'auto'` / absent → automatic; `{ start, end }` → explicit, a date-only `end`
 *   covering its whole day (with `endInclusive`); unparsable dates or `end <= start` → automatic.
 * - `padding`: a duration or `[before, after]`; absent or invalid → the view mode's padding,
 *   else none.
 * - `includeToday`: a boolean, default `false`.
 * - `infinite`: `false` / absent → off; `true` → on with defaults; an object → on, each field
 *   checked on its own (`threshold` finite, `0` or more; `extendBy` and `maxSpan` non-empty
 *   durations; `bounds` parsable dates with `min` before `max`, a date-only `max` covering its
 *   day), an invalid field falling back to its default.
 *
 * @param options - The caller's `timeline` options.
 * @param context - The view mode (for its padding) and `dates.endInclusive`.
 * @returns The frozen parsed options and issues.
 *
 * @example
 * ```ts
 * const { options } = resolveTimelineOptions({ infinite: { extendBy: '1mo' } }, { viewMode });
 * const policy = options.infinite && { ...options.infinite, columns: columnGrid(viewMode, adapter) };
 * ```
 */
export function resolveTimelineOptions(
  options: TimelineOptions | undefined,
  context: TimelineOptionsContext = {},
): ResolvedTimelineResult {
  const issues: ViewportIssue[] = [];
  const report = reporter('invalid-timeline-option', 'timeline', issues);
  const source = readGroup(options, report);
  const endInclusive = context.endInclusive ?? true;
  const resolved: ResolvedTimelineOptions = {
    range: readRange(source.range, endInclusive, report),
    padding: readPadding(source.padding, report) ?? viewModePadding(context.viewMode),
    includeToday: readIncludeToday(source.includeToday, report),
    infinite: readInfinite(source.infinite, endInclusive, report),
  };
  return Object.freeze({ options: Object.freeze(resolved), issues: Object.freeze(issues) });
}

/**
 * Parses the `scroll` options. Never throws: an unusable value gives an
 * `'invalid-scroll-option'` error and its default instead.
 *
 * - `initial`: `'today'` (default), `'start'`, `'end'`, `'first-task'`, `'none'` or a date.
 * - `behavior`: `'smooth'` (default), `'instant'` or `'auto'`.
 * - `align`: `'start'` (default), `'center'`, `'end'` or a number from `0` to `1`.
 * - `autoScroll`: `false`, or `{ edge, maxSpeed }` with finite values, `0` or more (defaults 40
 *   and 20).
 *
 * @param options - The caller's `scroll` options.
 * @returns The frozen parsed options and issues.
 */
export function resolveScrollOptions(
  options: ScrollOptionsInput | undefined,
): ResolvedScrollResult {
  const issues: ViewportIssue[] = [];
  const report = reporter('invalid-scroll-option', 'scroll', issues);
  const source = readGroup(options, report);
  const resolved: ResolvedScrollOptions = {
    initial: readInitial(source.initial, report),
    behavior: readBehavior(source.behavior, report),
    align: readAlign(source.align, report),
    autoScroll: readAutoScroll(source.autoScroll, report),
  };
  return Object.freeze({ options: Object.freeze(resolved), issues: Object.freeze(issues) });
}

function reporter(code: ViewportIssueCode, group: string, issues: ViewportIssue[]): Report {
  return (path, message, value, suggested) => {
    const issue: ViewportIssue = {
      code,
      severity: 'error',
      message: DEV
        ? `${path === '' ? group : `${group}.${path}`}: ${message}`
        : shortMessage(code, path),
      value,
      ...(path === '' ? {} : { path }),
      ...(suggested === undefined ? {} : { suggested }),
    };
    issues.push(Object.freeze(issue));
  };
}

function readGroup(options: unknown, report: Report): Readonly<Record<string, unknown>> {
  if (isRecord(options)) return options;
  if (options !== undefined) {
    report('', DEV ? `${show(options)} is not an options object` : '', options);
  }
  return {};
}

function readRange(value: unknown, endInclusive: boolean, report: Report): TimeRange | undefined {
  if (value === undefined || value === 'auto') return undefined;
  if (!isRecord(value)) {
    report('range', DEV ? `${show(value)} is not 'auto' or { start, end }` : '', value, 'auto');
    return undefined;
  }
  const start = readDate(value.start, 'range.start', false, report);
  const end = readDate(value.end, 'range.end', endInclusive, report);
  if (start === undefined || end === undefined) return undefined;
  if (end <= start) {
    const message = DEV ? 'the end is not after the start, the automatic range is used' : '';
    report('range', message, value, 'auto');
    return undefined;
  }
  return Object.freeze({ start, end });
}

function readDate(
  value: unknown,
  path: string,
  inclusiveEnd: boolean,
  report: Report,
): DateTimeMs | undefined {
  const parsed = parseDateInput(value as DateInput);
  if (!parsed.ok) {
    report(path, parsed.issue.message, value);
    return undefined;
  }
  const { value: t, precision } = parsed.value;
  return inclusiveEnd && precision === 'day' ? asDateTimeMs(t + DAY) : t;
}

function readDuration(
  value: unknown,
  path: string,
  allowZero: boolean,
  report: Report,
): Duration | undefined {
  const parsed = parseDuration(value as DurationInput);
  if (!parsed.ok) {
    report(path, parsed.issue.message, value);
    return undefined;
  }
  const { months, ms } = parsed.value;
  if (!allowZero && months === 0 && ms === 0) {
    report(
      path,
      DEV ? `${show(value)} is empty: use a positive duration such as "1mo"` : '',
      value,
    );
    return undefined;
  }
  return Object.freeze({ months, ms });
}

function readPadding(value: unknown, report: Report): readonly [Duration, Duration] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    const side = readDuration(value, 'padding', true, report);
    return side === undefined ? undefined : Object.freeze([side, side] as const);
  }
  const sides: readonly unknown[] = value;
  if (sides.length !== 2) {
    report(
      'padding',
      DEV ? `a pair needs exactly two durations [before, after], got ${sides.length}` : '',
      value,
    );
    return undefined;
  }
  const before = readDuration(sides[0], 'padding[0]', true, report);
  const after = readDuration(sides[1], 'padding[1]', true, report);
  if (before === undefined || after === undefined) return undefined;
  return Object.freeze([before, after] as const);
}

/** The view mode's padding (validated by `resolveViewModes`), or none. */
function viewModePadding(
  viewMode: Pick<ViewMode, 'padding'> | undefined,
): readonly [Duration, Duration] {
  const padding = viewMode?.padding;
  if (padding === undefined) return NO_PADDING;
  return readPadding(padding, () => undefined) ?? NO_PADDING;
}

function readIncludeToday(value: unknown, report: Report): boolean {
  if (value === undefined || typeof value === 'boolean') return value ?? false;
  report('includeToday', DEV ? `${show(value)} is not a boolean` : '', value, false);
  return false;
}

function readInfinite(
  value: unknown,
  endInclusive: boolean,
  report: Report,
): InfinitePolicy | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) return Object.freeze({});
  if (!isRecord(value)) {
    report('infinite', DEV ? `${show(value)} is not a boolean or an object` : '', value, false);
    return undefined;
  }
  const threshold = readSize(value.threshold, 'infinite.threshold', report);
  const extendBy = optional(value.extendBy, (v) =>
    readDuration(v, 'infinite.extendBy', false, report),
  );
  const maxSpan = optional(value.maxSpan, (v) =>
    readDuration(v, 'infinite.maxSpan', false, report),
  );
  const bounds = readBounds(value.bounds, endInclusive, report);
  return Object.freeze({
    ...(threshold === undefined ? {} : { threshold }),
    ...(extendBy === undefined ? {} : { extendBy }),
    ...(bounds === undefined ? {} : { bounds }),
    ...(maxSpan === undefined ? {} : { maxSpan }),
  });
}

function readBounds(
  value: unknown,
  endInclusive: boolean,
  report: Report,
): TimelineBounds | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    report('infinite.bounds', DEV ? `${show(value)} is not { min?, max? }` : '', value);
    return undefined;
  }
  const min = optional(value.min, (v) => readDate(v, 'infinite.bounds.min', false, report));
  const max = optional(value.max, (v) => readDate(v, 'infinite.bounds.max', endInclusive, report));
  if (min !== undefined && max !== undefined && min >= max) {
    report('infinite.bounds', DEV ? 'min is not before max, the bounds are ignored' : '', value);
    return undefined;
  }
  if (min === undefined && max === undefined) return undefined;
  return Object.freeze({
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
  });
}

function readInitial(value: unknown, report: Report): InitialScroll {
  if (value === undefined) return VIEWPORT_DEFAULTS.initialScroll;
  if (INITIAL_KEYWORDS.has(value)) return value as InitialScroll;
  const parsed = parseDateInput(value as DateInput);
  if (parsed.ok) return parsed.value.value;
  report(
    'initial',
    DEV
      ? `${show(value)} is not 'today', 'start', 'end', 'first-task', 'none' or a date (${parsed.issue.message})`
      : '',
    value,
    VIEWPORT_DEFAULTS.initialScroll,
  );
  return VIEWPORT_DEFAULTS.initialScroll;
}

function readBehavior(value: unknown, report: Report): ResolvedScrollOptions['behavior'] {
  if (value === undefined) return VIEWPORT_DEFAULTS.behavior;
  if (BEHAVIORS.has(value)) return value as ResolvedScrollOptions['behavior'];
  report(
    'behavior',
    DEV ? `${show(value)} is not 'smooth', 'instant' or 'auto'` : '',
    value,
    VIEWPORT_DEFAULTS.behavior,
  );
  return VIEWPORT_DEFAULTS.behavior;
}

function readAlign(value: unknown, report: Report): ScrollAlign {
  if (value === undefined) return VIEWPORT_DEFAULTS.align;
  if (ALIGN_KEYWORDS.has(value)) return value as ScrollAlign;
  if (typeof value === 'number' && value >= 0 && value <= 1) return value;
  report(
    'align',
    DEV ? `${show(value)} is not 'start', 'center', 'end' or a number from 0 to 1` : '',
    value,
    VIEWPORT_DEFAULTS.align,
  );
  return VIEWPORT_DEFAULTS.align;
}

function readAutoScroll(value: unknown, report: Report): ResolvedAutoScroll | false {
  if (value === false) return false;
  const defaults: ResolvedAutoScroll = {
    edge: VIEWPORT_DEFAULTS.autoScrollEdge,
    maxSpeed: VIEWPORT_DEFAULTS.autoScrollMaxSpeed,
  };
  if (value !== undefined && !isRecord(value)) {
    const message = DEV ? `${show(value)} is not false or { edge?, maxSpeed? }` : '';
    report('autoScroll', message, value, defaults);
    return Object.freeze(defaults);
  }
  return Object.freeze({
    edge: readSize(value?.edge, 'autoScroll.edge', report) ?? defaults.edge,
    maxSpeed: readSize(value?.maxSpeed, 'autoScroll.maxSpeed', report) ?? defaults.maxSpeed,
  });
}

/** A size in px: finite, `0` or more; `undefined` when absent or invalid (reported). */
function readSize(value: unknown, path: string, report: Report): number | undefined {
  if (value === undefined) return undefined;
  if (isSize(value)) return value;
  report(path, DEV ? `${show(value)} is not a finite number, 0 or more` : '', value);
  return undefined;
}

function optional<T>(value: unknown, read: (value: unknown) => T | undefined): T | undefined {
  return value === undefined ? undefined : read(value);
}

/** A value for a message: strings quoted, objects by kind, the rest as `String()`. */
function show(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' && value !== null ? 'an object' : String(value);
}
