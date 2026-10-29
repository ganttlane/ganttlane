import type { WorkCalendar } from '../calendar';
import {
  DEFAULT_GRANULARITY,
  type Duration,
  type DurationInput,
  type Granularity,
  parseDuration,
  parseGranularity,
} from '../time';
import { adoptIssue, type ModelIssue } from './issues';
import type { DurationMode, LinkType } from './types';

/**
 * What normalization does with a date, duration or lag that is not a multiple of the granularity
 * (`scheduling.alignInput`, FR-SNAP-13). Every case also reports a `'misaligned'` issue.
 * - `'expand'` (default): `start` down, `end` and `duration` up, so the task loses no time;
 * - `'nearest'`: to the nearest boundary, ties widen the task (`start` down, `end` up);
 * - `'reject'`: the task becomes invalid (no bar), the link is dropped.
 *
 * Lags always go to the nearest multiple (ties toward +∞), except with `'reject'`.
 */
export type AlignInput = 'expand' | 'nearest' | 'reject';

/**
 * Options of `normalizeModel`: the data-related part of `GanttOptions` (`docs/api.md` §3,
 * `dates` and `scheduling`). The issue of an invalid option has the option's path in
 * `GanttOptions` (`'scheduling.granularity'`), so that it names the option wherever it is listed
 * (the facade lists it with the data issues); `maxSpan`, which `GanttOptions` does not have, is
 * reported as `'maxSpan'`.
 */
export interface NormalizeModelOptions {
  /** The work calendar for working-time durations and day counts. */
  readonly calendar: WorkCalendar;
  /** The data step (`scheduling.granularity`, FR-SNAP-12); default `'1d'`. */
  readonly granularity?: DurationInput | undefined;
  /** Policy for misaligned input (`scheduling.alignInput`); default `'expand'`. */
  readonly alignInput?: AlignInput | undefined;
  /** Whether a date-only `end` is the inclusive last day (`dates.endInclusive`); default `true`. */
  readonly endInclusive?: boolean | undefined;
  /** Default `Task.durationMode` (`scheduling.durationMode`); default `'calendar'`. */
  readonly durationMode?: DurationMode | undefined;
  /** Default `Link.type` (`scheduling.defaultLinkType`); default `'FS'`. */
  readonly defaultLinkType?: LinkType | undefined;
  /** Longest valid task; longer ones get `'too-long'` (as upstream frappe-gantt); default `'10y'`. */
  readonly maxSpan?: DurationInput | undefined;
}

/** {@link NormalizeModelOptions} with defaults applied and durations parsed. */
export interface ResolvedModelOptions {
  /** The work calendar. */
  readonly calendar: WorkCalendar;
  /** The data step. */
  readonly granularity: Granularity;
  /** Policy for misaligned input. */
  readonly alignInput: AlignInput;
  /** Whether a date-only `end` is inclusive. */
  readonly endInclusive: boolean;
  /** Default duration mode. */
  readonly durationMode: DurationMode;
  /** Default link type. */
  readonly defaultLinkType: LinkType;
  /** Longest valid task. */
  readonly maxSpan: Duration;
}

const DEFAULT_MAX_SPAN: Duration = /* @__PURE__ */ Object.freeze({ months: 120, ms: 0 });

/**
 * Applies the defaults; an invalid `granularity` or `maxSpan` is reported and replaced by its
 * default.
 *
 * @internal
 */
export function resolveModelOptions(
  options: NormalizeModelOptions,
  issues: ModelIssue[],
): ResolvedModelOptions {
  let granularity = DEFAULT_GRANULARITY;
  if (options.granularity !== undefined) {
    const parsed = parseGranularity(options.granularity);
    if (parsed.ok) granularity = parsed.value;
    else issues.push(adoptIssue(parsed.issue, 'scheduling.granularity', undefined));
  }
  let maxSpan = DEFAULT_MAX_SPAN;
  if (options.maxSpan !== undefined) {
    const parsed = parseDuration(options.maxSpan);
    if (parsed.ok) maxSpan = parsed.value;
    else issues.push(adoptIssue(parsed.issue, 'maxSpan', undefined));
  }
  return Object.freeze({
    calendar: options.calendar,
    granularity,
    alignInput: options.alignInput ?? 'expand',
    endInclusive: options.endInclusive ?? true,
    durationMode: options.durationMode ?? 'calendar',
    defaultLinkType: options.defaultLinkType ?? 'FS',
    maxSpan,
  });
}
