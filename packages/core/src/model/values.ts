/**
 * Helpers shared by task and link normalization: reading days-or-duration values, alignment to
 * the granularity per `alignInput` (ADR-017) and the formatting used in issue messages.
 */

import { assertNever, DEV } from '../shared';
import {
  alignCeil,
  alignFloor,
  alignNearest,
  asDateTimeMs,
  type DatePrecision,
  type DateTimeMs,
  DAY,
  type Duration,
  type DurationInput,
  durationToString,
  type Granularity,
  parseDuration,
  toISODate,
  toISODateTime,
} from '../time';
import { adoptIssue, type ModelIssue, modelIssue } from './issues';
import type { AlignInput } from './options';
import type { TaskId } from './types';

/** Owner of an issue: the task and / or link it belongs to. */
export interface IssueOwner {
  readonly taskId: TaskId | undefined;
  readonly linkId?: string | undefined;
}

/**
 * Reads a task `duration` or link `lag`: a number is days (`signed` allows negative numbers, for
 * lags), anything else goes through `parseDuration`. Problems are pushed to `issues`.
 *
 * @internal
 */
export function readDaysOrDuration(
  value: number | DurationInput,
  path: string,
  owner: IssueOwner,
  issues: ModelIssue[],
  signed: boolean,
): Duration | undefined {
  if (typeof value === 'number') {
    if (Number.isFinite(value) && (signed || value >= 0)) return { months: 0, ms: value * DAY };
    issues.push(
      modelIssue(
        'invalid-duration',
        'error',
        path,
        DEV ? `${value} is not a finite${signed ? '' : ', non-negative'} number of days` : '',
        { ...owner, value },
      ),
    );
    return undefined;
  }
  const parsed = parseDuration(value);
  if (parsed.ok) return parsed.value;
  issues.push(adoptIssue(parsed.issue, path, owner.taskId, owner.linkId));
  return undefined;
}

/**
 * Aligns a date or a fixed duration to `step` per `policy`: `down` for task starts (expand:
 * floor, nearest: ties down), up for ends and durations (expand: ceil, nearest: ties up).
 * For `'reject'` it returns what `'expand'` would apply, as the suggestion.
 *
 * @internal
 */
export function alignTo(
  value: number,
  step: Granularity,
  policy: AlignInput,
  down: boolean,
): DateTimeMs {
  const t = asDateTimeMs(value);
  switch (policy) {
    case 'nearest':
      return alignNearest(t, step, down ? 'down' : 'up');
    case 'expand':
    case 'reject':
      return down ? alignFloor(t, step) : alignCeil(t, step);
    default:
      return assertNever(policy, 'Unknown alignInput');
  }
}

/**
 * Reports a value that changed when aligned: a `'misaligned'` warning, or an error with
 * `'reject'`. Returns `false` when the value is rejected.
 *
 * @internal
 */
export function reportMisaligned(
  issues: ModelIssue[],
  path: string,
  owner: IssueOwner,
  step: Granularity,
  policy: AlignInput,
  value: unknown,
  suggested: string | number,
): boolean {
  const reject = policy === 'reject';
  const shown = DEV ? JSON.stringify(suggested) : '';
  issues.push(
    modelIssue(
      'misaligned',
      reject ? 'error' : 'warning',
      path,
      DEV
        ? `not a multiple of the granularity ${stepText(step)}, ${reject ? `rejected, suggested ${shown}` : `aligned to ${shown}`}`
        : '',
      { ...owner, value, suggested },
    ),
  );
  return !reject;
}

/**
 * A duration as the caller wrote it: days for a number input, else the canonical string.
 *
 * @internal
 */
export function durationValue(input: unknown, duration: Duration): string | number {
  return typeof input === 'number' ? duration.ms / DAY : durationToString(duration);
}

/**
 * A date as ISO text: date-only for `'day'` precision.
 *
 * @internal
 */
export function isoText(t: DateTimeMs, precision: DatePrecision): string {
  return precision === 'day' ? toISODate(t) : toISODateTime(t);
}

function stepText(step: Granularity): string {
  return durationToString({ months: 0, ms: step.ms });
}
