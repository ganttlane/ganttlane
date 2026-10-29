/**
 * The caller-facing shape of snap settings, shared by
 * `ViewMode.snap` and `scheduling.snap`. This file only describes and syntax-checks the input;
 * resolving the effective step (granularity, `'unit'`, per-interaction steps) is `scale/snap`.
 */

import { DEV, isRecord } from '../shared';
import type { DurationFields } from '../time';
import { checkDuration, describeValue, joinPath, type Report } from './check';

/**
 * One snap step: a duration (`DurationInput`) from `'1min'` up (`'15min'`, `'1h'`,
 * `'1d'`, `'1w'`, `'1mo'`, `{ hours: 1 }`, …), `'unit'` for the view mode's column unit, or
 * `false` to disable snapping.
 */
export type SnapStep = 'unit' | false | DurationFields | (string & Record<never, never>);

/**
 * How an edge snaps: `'grid'` to the nearest calendar boundary of the
 * step, `'relative'` by whole steps from where the drag started.
 */
export type SnapMode = 'grid' | 'relative';

/** Snap settings in object form: a shared step, a mode and per-interaction steps. */
export interface SnapOptions {
  /** Step shared by all interactions; defaults to the view mode's snap. */
  readonly step?: SnapStep;
  /** Snap strategy, default `'grid'`. */
  readonly mode?: SnapMode;
  /** Step for moving a bar. */
  readonly move?: SnapStep;
  /** Step for resizing a bar. */
  readonly resize?: SnapStep;
  /** Step for dragging the progress handle. */
  readonly progress?: SnapStep;
}

/**
 * Snap settings as callers pass them: a single {@link SnapStep} or {@link SnapOptions}.
 * An object containing any of `step`, `mode`, `move`, `resize`, `progress` (or no field at
 * all) is read as `SnapOptions`; any other object as a duration (`{ hours: 1 }`).
 */
export type SnapInput = SnapStep | SnapOptions;

const STEP_KEYS: ReadonlySet<string> = /* @__PURE__ */ new Set([
  'step',
  'move',
  'resize',
  'progress',
]);
const SNAP_MODES: Readonly<Record<SnapMode, true>> = { grid: true, relative: true };

/**
 * Reports syntax problems of a {@link SnapInput}: malformed or empty durations, unknown modes and
 * unknown option fields. Does not resolve or align anything.
 *
 * @param value - The caller's snap input.
 * @param path - Location of the value, e.g. `'day.snap'`.
 * @param report - Receives each problem (all of them errors).
 * @returns `true` when the input is syntactically valid.
 * @internal
 */
export function checkSnapInput(value: unknown, path: string, report: Report): boolean {
  if (!isSnapOptionsObject(value)) return checkSnapStep(value, path, report);

  let valid = true;
  for (const [key, field] of Object.entries(value)) {
    const fieldPath = joinPath(path, key);
    if (field === undefined) continue;
    if (STEP_KEYS.has(key)) {
      valid = checkSnapStep(field, fieldPath, report) && valid;
    } else if (key === 'mode') {
      if (typeof field !== 'string' || !Object.hasOwn(SNAP_MODES, field)) {
        report(
          fieldPath,
          DEV ? `Invalid snap mode ${describeValue(field)}: use "grid" or "relative".` : '',
          field,
        );
        valid = false;
      }
    } else {
      report(
        fieldPath,
        DEV ? `Unknown snap option "${key}": use step, mode, move, resize or progress.` : '',
        field,
      );
      valid = false;
    }
  }
  return valid;
}

/**
 * Whether a snap input is in object form ({@link SnapOptions}): an object with any of `step`,
 * `mode`, `move`, `resize`, `progress`, or with no field at all. Any other object is a duration
 * step (`{ hours: 1 }`). Only the form is checked, not the field values.
 *
 * @internal
 */
export function isSnapOptionsObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 0 || keys.some((key) => key === 'mode' || STEP_KEYS.has(key));
}

function checkSnapStep(value: unknown, path: string, report: Report): boolean {
  if (value === false || value === 'unit') return true;
  if (value === true) {
    report(
      path,
      DEV ? 'Invalid snap step true: use a duration such as "1d", "unit" or false.' : '',
      value,
    );
    return false;
  }
  return checkDuration(value, path, report, false);
}
