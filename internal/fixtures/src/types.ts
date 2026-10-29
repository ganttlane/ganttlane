/**
 * Minimal input types for fixtures, mirroring `docs/api.md` §2 (input data) and the data-related
 * part of §3 (options) field for field.
 *
 * Fixtures keep their own types instead of importing them from `@ganttlane/core`, so the
 * workspace has no core ↔ fixtures dependency cycle (core uses the fixtures as a devDependency,
 * from tests only). Compatibility is checked in core instead: a type test there
 * (`packages/core/src/model/schema.test.ts`) asserts that {@link FixtureTask} is assignable to
 * `Task` and {@link FixtureLink} to `Link`. When `docs/api.md` changes, update these types too.
 *
 * @packageDocumentation
 */

/** `Date`, `'YYYY-MM-DD'`, `'YYYY-MM-DDTHH:mm[:ss]'` (floating wall-clock) or epoch ms. */
export type FixtureDateInput = Date | string | number;

/** Task identifier. Never changed by the library. */
export type FixtureTaskId = string | number;

/** Finish-to-start, start-to-start, finish-to-finish, start-to-finish. */
export type FixtureLinkType = 'FS' | 'SS' | 'FF' | 'SF';

/**
 * Duration: `'1y' '1q' '1mo' '2w' '3d' '6h' '30min'`, compound `'1d 4h'` (`'m'` is rejected),
 * or an object of units.
 */
export type FixtureDurationInput =
  | string
  | {
      years?: number;
      quarters?: number;
      months?: number;
      weeks?: number;
      days?: number;
      hours?: number;
      minutes?: number;
    };

/** Per-interaction editing switches (`docs/api.md` §3 `editing`). */
export interface FixtureEditingFlags {
  move?: boolean;
  resize?: boolean;
  progress?: boolean;
  links?: boolean;
}

/** A task as the consumer passes it in (`docs/api.md` §2 `Task`). */
export interface FixtureTask<TData = unknown> {
  id: FixtureTaskId;
  name: string;
  start?: FixtureDateInput;
  /** Date-only → inclusive last day; with time → exact moment. */
  end?: FixtureDateInput;
  /** A number means days; the mode comes from `durationMode`. */
  duration?: number | FixtureDurationInput;
  precision?: 'day' | 'time';
  durationMode?: 'calendar' | 'working';
  /** 0…100. */
  progress?: number;
  progressAnchor?: 'start' | 'end';
  type?: 'task' | 'milestone' | 'placeholder';
  parentId?: FixtureTaskId;
  parentAnchor?: FixtureLinkType | FixtureLinkType[];
  followParent?: boolean;
  locked?: boolean;
  fixedDuration?: boolean;
  linkable?: boolean;
  editable?: boolean | Partial<FixtureEditingFlags>;
  className?: string;
  rowClassName?: string;
  color?: string;
  progressColor?: string;
  description?: string;
  data?: TData;
}

/** A dependency between two tasks (`docs/api.md` §2 `Link`). */
export interface FixtureLink {
  /** Defaults to `${source}:${type}:${target}`. */
  id?: string;
  /** Predecessor. */
  source: FixtureTaskId;
  /** Successor. */
  target: FixtureTaskId;
  /** Defaults to `scheduling.defaultLinkType`. */
  type?: FixtureLinkType;
  /** A number means days; `undefined` takes the current gap. */
  lag?: number | FixtureDurationInput;
  editable?: boolean;
}

/**
 * Work calendar (`docs/api.md` §3 `calendar`). The `isWorkingDay` callback is left out on
 * purpose: fixtures are plain, serialisable data.
 */
export interface FixtureCalendar {
  /** Days of the week that are not worked, `0` = Sunday. */
  weekends?: number[];
  holidays?: (FixtureDateInput | { date: FixtureDateInput; name?: string })[];
  /** Exceptions: weekend days that are worked. */
  workingDays?: FixtureDateInput[];
}

/** The data-related subset of `GanttOptions` (`docs/api.md` §3) a fixture may need. */
export interface FixtureOptions {
  dates?: {
    endInclusive?: boolean;
  };
  scheduling?: {
    durationMode?: 'calendar' | 'working';
    propagation?: 'none' | 'preserve-lag' | 'push-forward';
    defaultLinkType?: FixtureLinkType;
    granularity?: FixtureDurationInput;
    alignInput?: 'expand' | 'nearest' | 'reject';
    keepDayPrecision?: boolean;
    skipNonWorkingDays?: { move?: boolean; resize?: boolean; progress?: boolean };
    detectCycles?: 'error' | 'ignore-link';
  };
  hierarchy?: {
    expandedKeys?: 'all' | FixtureTaskId[];
    moveChildren?: 'all' | 'following' | 'none';
    childAnchor?: FixtureLinkType;
  };
}

/** A named dataset: what a gantt chart would be created with. */
export interface Fixture<TData = unknown> {
  /** Stable kebab-case name, unique within its group. */
  name: string;
  /** What the fixture exercises and what a correct core is expected to report. */
  description: string;
  tasks: FixtureTask<TData>[];
  links: FixtureLink[];
  calendar?: FixtureCalendar;
  options?: FixtureOptions;
}
