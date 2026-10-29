/**
 * Snapping of dragged edges:
 * {@link resolveSnap} turns `scheduling.snap` and the view mode's snap into one rule per
 * interaction, every step a multiple of `scheduling.granularity`; {@link snapTime} snaps an edge
 * during a drag; {@link clampResize} keeps a resized task at least one step long.
 */

import type { WorkCalendar } from '../calendar';
import { assertNever, DEV, isRecord, shortMessage } from '../shared';
import {
  alignNearest,
  alignToStep,
  asDateTimeMs,
  type DateAdapter,
  type DatePrecision,
  type DateTimeMs,
  DAY,
  DEFAULT_GRANULARITY,
  type Duration,
  type DurationInput,
  durationToString,
  type Granularity,
  HOUR,
  parseDuration,
} from '../time';
import { cellGrid } from './cell-grid';
import { joinPath } from './check';
import type { ScaleIssue, ScaleIssueCode } from './issues';
import { checkSnapInput, type SnapInput, type SnapMode } from './snap-input';
import { VIEW_MODE_PRESETS, type ViewMode } from './view-modes';

/** Calendar unit of a {@link CalendarSnapRule}. */
export type SnapCalendarUnit = 'week' | 'month' | 'quarter' | 'year';

/**
 * A snap step of fixed length. On the grid its boundaries are the multiples of `ms` counted from
 * midnight (steps up to a day, which divide 24 h) or from 1970-01-01 (steps of several days).
 */
export interface FixedSnapRule {
  /** Discriminant. */
  readonly kind: 'fixed';
  /** Step length in milliseconds. */
  readonly ms: number;
}

/**
 * A snap step of `count` calendar units. On the grid its boundaries are the unit starts (weeks
 * start on `DateAdapter.weekStartsOn`) whose index counted from the epoch is a multiple of
 * `count`, so `2mo` snaps to January, March, May, … and `1q` to quarter starts.
 */
export interface CalendarSnapRule {
  /** Discriminant. */
  readonly kind: 'calendar';
  /** Calendar unit. */
  readonly unit: SnapCalendarUnit;
  /** Units per step, a positive integer. */
  readonly count: number;
}

/** A resolved snap step: fixed, calendar, or `false` when snapping is off. */
export type SnapRule = FixedSnapRule | CalendarSnapRule | false;

/** An interaction with its own snap step. */
export type SnapInteraction = 'move' | 'resize' | 'progress';

/** Direction of the drag: `-1` toward earlier dates, `1` toward later ones, `0` unknown. */
export type SnapDirection = -1 | 0 | 1;

/** Which edge of a task is snapped: its start or its exclusive end. */
export type SnapEdge = 'start' | 'end';

/** Snap settings resolved for a view mode by {@link resolveSnap}; deeply frozen. */
export interface ResolvedSnap {
  /** Snap strategy. */
  readonly mode: SnapMode;
  /** Step for moving a bar. */
  readonly move: SnapRule;
  /** Step for resizing a bar. */
  readonly resize: SnapRule;
  /** Step for dragging the progress handle. */
  readonly progress: SnapRule;
  /** The data step every rule is a multiple of. */
  readonly granularity: Granularity;
  /** Whether day-precision tasks snap to whole days at least. */
  readonly keepDayPrecision: boolean;
}

/** Input of {@link resolveSnap}. */
export interface ResolveSnapInput {
  /** The active view mode (from `resolveViewModes`); its `snap` is the default. */
  readonly viewMode: Pick<ViewMode, 'id' | 'unit' | 'step' | 'snap'>;
  /** `scheduling.snap`, which overrides the view mode's snap. */
  readonly option?: SnapInput | undefined;
  /** `scheduling.granularity`, default one day. */
  readonly granularity?: Granularity | undefined;
  /** `scheduling.keepDayPrecision`, default `true`. */
  readonly keepDayPrecision?: boolean | undefined;
}

/** Result of {@link resolveSnap}. */
export interface ResolvedSnapResult {
  /** The resolved settings. */
  readonly snap: ResolvedSnap;
  /** Problems found in the snap settings. */
  readonly issues: readonly ScaleIssue[];
}

/** What {@link effectiveSnapRule} needs to know about the task. */
export interface SnapPrecision {
  /** Precision of the task being edited. */
  readonly precision: DatePrecision;
  /** The data step, default one day. */
  readonly granularity?: Granularity | undefined;
  /** `scheduling.keepDayPrecision`, default `true`. */
  readonly keepDayPrecision?: boolean | undefined;
}

/** Input of {@link snapTime} besides the raw date. */
export interface SnapContext extends SnapPrecision {
  /** The interaction's rule from {@link ResolvedSnap}. */
  readonly rule: SnapRule;
  /** Calendar math (week start, months); its `weekStartsOn` anchors week steps. */
  readonly adapter: DateAdapter;
  /** Snap strategy, default `'grid'`. */
  readonly mode?: SnapMode | undefined;
  /** Position of the edge when the drag started; required by `'relative'` (else grid is used). */
  readonly origin?: DateTimeMs | undefined;
  /** Drag direction, default `0`. Breaks ties and picks the side for skipped days. */
  readonly direction?: SnapDirection | undefined;
  /** The snapped edge, default `'start'`. An `'end'` is exclusive (see {@link snapTime}). */
  readonly edge?: SnapEdge | undefined;
  /** Work calendar for skipping non-working days. */
  readonly calendar?: WorkCalendar | undefined;
  /** `scheduling.skipNonWorkingDays[interaction]`, default `false`. */
  readonly skipNonWorking?: boolean | undefined;
}

/** Start and exclusive end of a task. */
export interface ResizeEdges {
  /** Start. */
  readonly start: DateTimeMs;
  /** Exclusive end. */
  readonly end: DateTimeMs;
}

/** Input of {@link clampResize}. */
export interface ClampResizeInput extends ResizeEdges {
  /** The edge being dragged; the other one stays where it is. */
  readonly edge: SnapEdge;
  /** The shortest allowed duration: the effective resize rule ({@link effectiveSnapRule}). */
  readonly minStep: Exclude<SnapRule, false>;
  /** Calendar math for calendar steps. */
  readonly adapter: DateAdapter;
}

const WEEK = 7 * DAY;
const MONTHS: Readonly<Record<Exclude<SnapCalendarUnit, 'week'>, number>> = {
  month: 1,
  quarter: 3,
  year: 12,
};
const STEP_KEYS: readonly string[] = ['step', 'move', 'resize', 'progress'];

/** A parsed snap step: a duration, the view mode's column (`'unit'`) or `false` (off). */
type StepValue = Duration | 'unit' | false;

/** A step field name: the shared `step` or one interaction. */
type StepKey = 'step' | SnapInteraction;

/** The parsed steps of a preset's snap, per field (a plain preset step is `{ step }`). */
type DefaultSteps = Partial<Record<StepKey, StepValue>>;

/** A step field read from snap settings. */
interface StepEntry {
  /** The parsed step. */
  readonly step: StepValue;
  /** The step as configured. */
  readonly value: unknown;
  /** Where it was configured. */
  readonly path: string;
  /** `false` for preset defaults, raised silently. */
  readonly explicit: boolean;
}

/** Valid fields of one snap setting. */
type SnapFields = Partial<Record<StepKey, StepEntry> & { mode: SnapMode }>;

/**
 * Resolves the snap settings of a view mode.
 *
 * - `option` (`scheduling.snap`) overrides `viewMode.snap` field by field (`step`, `mode`,
 *   `move`, `resize`, `progress`); a step given directly (`'1h'`) replaces it as a whole.
 * - Each interaction uses its own step, else `step`, else the granularity.
 * - `'unit'` is the view mode's column: `step` × `unit` (`6h` in the quarter-day preset).
 * - Every step becomes a multiple of `granularity`; steps under a day divide 24 h, longer ones
 *   are whole days. Preset defaults that do not fit are raised silently (the hour preset snaps
 *   by days at `granularity: '1d'`); other steps are raised with a `'snap-below-granularity'` or
 *   `'snap-not-multiple'` warning. Whole weeks become week steps that snap to week starts.
 * - Malformed or mixed (`'1mo 1d'`) settings are ignored with an `'invalid-snap'` error.
 *
 * Whether a step of the view mode's snap is a silent preset default is decided per field: when
 * the view mode's id is a preset id, a `step`, `move`, `resize` or `progress` whose value equals
 * the preset's value for that field (compared as parsed durations, so `'15min'` matches
 * `{ minutes: 15 }`; a plain preset step counts as `{ step }`) is a default. So
 * `resolveViewModes({ hour: { snap: { mode: 'relative' } } })`, which merges to
 * `{ step: '15min', mode: 'relative' }`, warns about nothing; only fields the override changed
 * or added can warn. Never throws, never mutates the input.
 *
 * @param input - View mode, `scheduling.snap`, granularity and `keepDayPrecision`.
 * @returns The rules per interaction and the issues found.
 *
 * @example
 * ```ts
 * const hour = VIEW_MODE_PRESETS[0]; // snap '15min'
 * resolveSnap({ viewMode: hour }).snap.move; // { kind: 'fixed', ms: 86_400_000 }: raised to 1d
 * const hourly = parseGranularity('1h');
 * if (hourly.ok) resolveSnap({ viewMode: hour, option: '15min', granularity: hourly.value });
 * // → move { kind: 'fixed', ms: 3_600_000 } and a 'snap-below-granularity' warning
 * ```
 */
export function resolveSnap(input: ResolveSnapInput): ResolvedSnapResult {
  const { viewMode } = input;
  const granularity = input.granularity ?? DEFAULT_GRANULARITY;
  const issues: ScaleIssue[] = [];
  const preset = VIEW_MODE_PRESETS.find((mode) => mode.id === viewMode.id);
  const ownPath = `viewModes.${viewMode.id}.snap`;
  const own = readSnap(viewMode.snap, ownPath, issues, defaultSteps(preset?.snap));
  const option = readSnap(input.option, 'scheduling.snap', issues);
  const fields: SnapFields = option?.replaces
    ? option.fields
    : { ...own?.fields, ...option?.fields };

  const rules = new Map<StepEntry, SnapRule>();
  const ruleFor = (interaction: SnapInteraction): SnapRule => {
    const entry = fields[interaction] ?? fields.step;
    if (!entry) return Object.freeze({ kind: 'fixed', ms: granularity.ms });
    let rule = rules.get(entry);
    if (rule === undefined) {
      rule = toRule(entry, viewMode, granularity, issues);
      rules.set(entry, rule);
    }
    return rule;
  };

  const snap: ResolvedSnap = Object.freeze({
    mode: fields.mode ?? 'grid',
    move: ruleFor('move'),
    resize: ruleFor('resize'),
    progress: ruleFor('progress'),
    granularity,
    keepDayPrecision: input.keepDayPrecision ?? true,
  });
  return Object.freeze({ snap, issues: Object.freeze(issues) });
}

/**
 * Steps 1–2 of the snap algorithm for one task: `false` (snapping
 * off) becomes the granularity, a fixed step is raised to a multiple of it, and with
 * `keepDayPrecision` a day-precision task gets whole days at least.
 *
 * @param rule - The interaction's rule.
 * @param task - Task precision, granularity and `keepDayPrecision`.
 * @returns The step actually used, never `false`.
 */
export function effectiveSnapRule(rule: SnapRule, task: SnapPrecision): Exclude<SnapRule, false> {
  if (rule !== false && rule.kind === 'calendar') return rule;
  const unit = (task.granularity ?? DEFAULT_GRANULARITY).ms;
  let ms = rule === false ? unit : Math.max(unit, Math.ceil(rule.ms / unit) * unit);
  if (task.precision === 'day' && task.keepDayPrecision !== false) {
    ms = Math.max(DAY, Math.ceil(ms / DAY) * DAY);
  }
  return rule !== false && ms === rule.ms ? rule : { kind: 'fixed', ms };
}

/**
 * Snaps a dragged edge.
 *
 * 1. The step is {@link effectiveSnapRule}: `false` snaps to the granularity only, day-precision
 *    tasks to whole days at least when `keepDayPrecision` is on.
 * 2. `'grid'`: the nearest boundary of the step (see {@link FixedSnapRule} and
 *    {@link CalendarSnapRule}). `'relative'`: `origin` plus a whole number of steps (calendar
 *    steps through `adapter.add`), so the offset from the grid is kept; `origin` is first
 *    aligned to the granularity (record edges always are).
 * 3. A value exactly halfway between two boundaries goes in the drag direction; direction `0`
 *    goes to the later one.
 * 4. With `skipNonWorking` and a `calendar`, an edge that lands on a non-working day moves to the
 *    next working day (previous for direction `-1`), keeping the time of day:
 *    `WorkCalendar.rollToWorking` with `keepTimeOfDay`. For an `'end'` edge the day checked is the
 *    one before the exclusive end (an end at Saturday 00:00 ends on Friday). When no working day is
 *    found the edge stays.
 *
 * Without skipping the result is within half a step of `t`, idempotent and monotonic in `t`;
 * with rules from {@link resolveSnap} it is always a multiple of the granularity.
 *
 * @param t - Raw date of the edge (from `TimeScale.xToDate`).
 * @param context - Rule, mode, task precision, drag state and calendar.
 * @returns The snapped date; `t` itself when it is not finite.
 * @throws RangeError in `'grid'` mode for a calendar rule whose `count` is not a positive integer
 * (rules from {@link resolveSnap} always have one).
 */
export function snapTime(t: DateTimeMs, context: SnapContext): DateTimeMs {
  if (!Number.isFinite(t)) return t;
  const { adapter, origin, calendar } = context;
  const rule = effectiveSnapRule(context.rule, context);
  const up = (context.direction ?? 0) >= 0;
  const anchor =
    context.mode === 'relative' && origin !== undefined && Number.isFinite(origin)
      ? alignNearest(origin, context.granularity ?? DEFAULT_GRANULARITY)
      : undefined;

  let result: DateTimeMs;
  if (rule.kind === 'fixed' || (rule.unit === 'week' && anchor !== undefined)) {
    // Fixed length (floating weeks are 7 days): multiples of the step from the anchor.
    const step = rule.kind === 'fixed' ? rule.ms : rule.count * WEEK;
    const base = anchor ?? 0;
    result = asDateTimeMs(base + alignToStep(t - base, step, 'nearest', up ? 'up' : 'down'));
  } else {
    // Weeks with an anchor took the fixed-length branch above.
    const [lower, upper] =
      anchor === undefined || rule.unit === 'week'
        ? calendarCell(t, rule, adapter)
        : monthsFrom(t, anchor, rule.count * MONTHS[rule.unit], adapter);
    const below = t - lower;
    const above = upper - t;
    result = below < above || (below === above && !up) ? lower : upper;
  }

  if (context.skipNonWorking === true && calendar) {
    const edge = context.edge ?? 'start';
    result = calendar.rollToWorking(result, up ? 1 : -1, { edge, keepTimeOfDay: true }) ?? result;
  }
  return result;
}

/**
 * Keeps a resized task at least one step long: the dragged edge stops one
 * `minStep` away from the fixed one. Milestones have no duration, so callers skip this for them.
 *
 * @param input - Edges, the dragged edge, the minimum step and the adapter.
 * @returns The clamped edges (the fixed edge is unchanged).
 */
export function clampResize(input: ClampResizeInput): ResizeEdges {
  const { start, end, edge, minStep, adapter } = input;
  const shift = (t: DateTimeMs, sign: 1 | -1): DateTimeMs =>
    minStep.kind === 'fixed'
      ? asDateTimeMs(t + sign * minStep.ms)
      : adapter.add(t, sign * minStep.count, minStep.unit);
  if (edge === 'end') {
    const min = shift(start, 1);
    return { start, end: end < min ? min : end };
  }
  const max = shift(end, -1);
  return { start: start > max ? max : start, end };
}

/**
 * Grid boundaries of a calendar step around `t`: the header cell grid of the same unit and step
 * (`scale/cell-grid`), so weeks count from the week containing 1970-01-01 and months, quarters
 * and years from year 0.
 */
function calendarCell(
  t: DateTimeMs,
  rule: CalendarSnapRule,
  adapter: DateAdapter,
): [DateTimeMs, DateTimeMs] {
  const grid =
    rule.unit === 'week'
      ? cellGrid('week', rule.count, adapter, 'snap step')
      : cellGrid('month', rule.count * MONTHS[rule.unit], adapter, 'snap step');
  const lower = grid.floor(t);
  return [lower, grid.next(lower)];
}

/** The boundaries `origin + k * months` around `t`, each computed from `origin` (no drift). */
function monthsFrom(
  t: DateTimeMs,
  origin: DateTimeMs,
  months: number,
  adapter: DateAdapter,
): [DateTimeMs, DateTimeMs] {
  const at = (k: number): DateTimeMs => adapter.add(origin, k * months, 'month');
  let k = Math.floor(adapter.diffMonths(origin, t) / months);
  while (at(k) > t) k--;
  while (at(k + 1) <= t) k++;
  return [at(k), at(k + 1)];
}

/**
 * Reads one snap setting; invalid fields are reported and left out. A step equal to the field's
 * value in `defaults` (the preset's snap) is not explicit; without `defaults` every step is.
 */
function readSnap(
  value: unknown,
  path: string,
  issues: ScaleIssue[],
  defaults?: DefaultSteps,
): { fields: SnapFields; replaces: boolean } | undefined {
  if (value === undefined) return undefined;
  const rejected = new Set<string>();
  const reject = (at: string, message: string, field: unknown): void => {
    rejected.add(at);
    const code = 'invalid-snap';
    issues.push({
      code,
      severity: 'error',
      message: DEV ? message : shortMessage(code, at),
      path: at,
      value: field,
    });
  };
  checkSnapInput(value, path, reject);

  const replaces = !isSnapOptions(value);
  const entries: [string, unknown][] = replaces ? [['step', value]] : Object.entries(value);
  const fields: SnapFields = {};
  for (const [key, field] of entries) {
    const at = replaces ? path : joinPath(path, key);
    if (field === undefined || rejected.has(at)) continue;
    if (key === 'mode') fields.mode = field as SnapMode;
    else if (isStepKey(key)) {
      const step = readStep(field);
      if (step === undefined) {
        reject(
          at,
          DEV ? `Snap step ${JSON.stringify(field)} mixes calendar and fixed units.` : '',
          field,
        );
      } else {
        const explicit =
          !defaults || !Object.hasOwn(defaults, key) || !sameStep(defaults[key], step);
        fields[key] = { step, value: field, path: at, explicit } satisfies StepEntry;
      }
    }
  }
  // A rejected plain step is no setting at all: the view mode's snap stays.
  return replaces && !fields.step ? undefined : { fields, replaces };
}

/** The parsed steps of a preset's snap per field; a plain step counts as `{ step }`. */
function defaultSteps(snap: SnapInput | undefined): DefaultSteps | undefined {
  if (snap === undefined) return undefined;
  const entries: [string, unknown][] = isSnapOptions(snap)
    ? Object.entries(snap)
    : [['step', snap]];
  const steps: DefaultSteps = {};
  for (const [key, field] of entries) {
    const step = isStepKey(key) && field !== undefined ? readStep(field) : undefined;
    if (isStepKey(key) && step !== undefined) steps[key] = step;
  }
  return steps;
}

/** Whether two parsed steps are the same (durations compared by value). */
function sameStep(a: StepValue | undefined, b: StepValue): boolean {
  if (a === undefined || a === false || a === 'unit' || b === false || b === 'unit') return a === b;
  return a.months === b.months && a.ms === b.ms;
}

/** Whether an option key holds a step. */
function isStepKey(key: string): key is StepKey {
  return STEP_KEYS.includes(key);
}

/** Whether a snap input is in the options form (see `SnapInput`). */
function isSnapOptions(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 0 || keys.some((key) => key === 'mode' || isStepKey(key));
}

/** A checked step as a duration, `'unit'` or `false`; `undefined` when it mixes units. */
function readStep(step: unknown): StepValue | undefined {
  if (step === false || step === 'unit') return step;
  const parsed = parseDuration(step as DurationInput);
  if (!parsed.ok || (parsed.value.months > 0 && parsed.value.ms > 0)) return undefined;
  return parsed.value;
}

/** Converts a step to a rule fitted to the granularity. */
function toRule(
  entry: StepEntry,
  viewMode: ResolveSnapInput['viewMode'],
  granularity: Granularity,
  issues: ScaleIssue[],
): SnapRule {
  if (entry.step === false) return false;
  const { months, ms } = entry.step === 'unit' ? columnDuration(viewMode) : entry.step;
  if (months > 0) {
    const unit = months % 12 === 0 ? 'year' : months % 3 === 0 ? 'quarter' : 'month';
    return Object.freeze({ kind: 'calendar', unit, count: months / MONTHS[unit] });
  }

  const unit = granularity.ms;
  let fitted: number;
  let code: ScaleIssueCode | undefined;
  if (ms < unit) {
    fitted = unit;
    code = 'snap-below-granularity';
  } else if (ms < DAY) {
    fitted = Math.ceil(ms / unit) * unit;
    while (DAY % fitted !== 0) fitted += unit;
  } else {
    fitted = Math.ceil(ms / DAY) * DAY;
  }
  code ??= fitted === ms ? undefined : 'snap-not-multiple';
  if (code && entry.explicit) {
    const text = (value: number): string => durationToString({ months: 0, ms: value });
    const suggested = text(fitted);
    issues.push({
      code,
      severity: 'warning',
      message: DEV
        ? `Snap step ${text(ms)} ${
            code === 'snap-below-granularity'
              ? `is finer than the granularity ${text(unit)}`
              : `does not fit the granularity ${text(unit)} (use its multiples that divide 24 h, or whole days)`
          }: raised to ${suggested}.`
        : shortMessage(code, entry.path),
      path: entry.path,
      value: entry.value,
      suggested,
    });
  }
  return Object.freeze(
    fitted % WEEK === 0
      ? { kind: 'calendar', unit: 'week', count: fitted / WEEK }
      : { kind: 'fixed', ms: fitted },
  );
}

/** The view mode's column (`'unit'`) as a duration. */
function columnDuration(viewMode: ResolveSnapInput['viewMode']): Duration {
  const step = viewMode.step ?? 1;
  switch (viewMode.unit) {
    case 'hour':
      return { months: 0, ms: step * HOUR };
    case 'day':
      return { months: 0, ms: step * DAY };
    case 'week':
      return { months: 0, ms: step * WEEK };
    case 'month':
    case 'quarter':
    case 'year':
      return { months: step * MONTHS[viewMode.unit], ms: 0 };
    default:
      return assertNever(viewMode.unit, 'Unknown view mode unit');
  }
}
