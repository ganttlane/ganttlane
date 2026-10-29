/**
 * Floating wall-clock time (ADR-003, `docs/architecture.md` §5): numeric representation, input
 * parsing, durations, the data step (`granularity`, ADR-017) and alignment to it, calendar
 * arithmetic, the `DateAdapter` strategy and `Intl` formatting.
 * Calendar logic, ISO parsing and formatting run on `@internationalized/date` (ADR-018); its
 * objects never leave this module, core passes numbers around.
 *
 * Other core modules import time only through this file. Prefer a {@link DateAdapter} received
 * from the caller for anything calendar-aware (week start, month/quarter/year units, formatting);
 * the pure functions are for fast paths that cannot vary (fixed units, day keys).
 *
 * @module
 */

export type { DateAdapter, FloatingAdapterOptions } from './adapter';
export { createFloatingAdapter } from './adapter';
export type { IsoWeek, TimeUnit, WeekOptions } from './arithmetic';
export {
  addDays,
  addHours,
  addMinutes,
  addMonths,
  addQuarters,
  addUnits,
  addWeeks,
  addYears,
  dayOfWeek,
  daysInMonth,
  DEFAULT_WEEK_STARTS_ON,
  diffDays,
  diffMonths,
  endOf,
  isLeapYear,
  isoWeek,
  startOf,
} from './arithmetic';
export type { DateTimeFields, DateTimeMs, DateTimeParts, DayKey, Weekday } from './datetime';
export {
  asDateTimeMs,
  asDayKey,
  DAY,
  fromDayKey,
  fromParts,
  getParts,
  HOUR,
  MINUTE,
  toDayKey,
} from './datetime';
export type { Duration, DurationFields, DurationInput } from './duration';
export {
  addDuration,
  compareFixed,
  durationToString,
  isZeroDuration,
  negate,
  parseDuration,
} from './duration';
export type { DateFormatFn } from './format';
export type { AlignMode, AlignTie, Granularity } from './granularity';
export {
  alignCeil,
  alignDuration,
  alignDurationMs,
  alignFloor,
  alignNearest,
  alignToStep,
  DEFAULT_GRANULARITY,
  isAligned,
  isDurationAligned,
  parseGranularity,
} from './granularity';
export type { ParseOptions, TimeIssue, TimeIssueCode } from './issues';
export type { DateInput, DatePrecision, ParsedDate } from './parse';
export { parseDateInput, toDate, toISODate, toISODateTime } from './parse';
