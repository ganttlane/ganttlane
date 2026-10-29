import type { BaseIssue } from 'valibot';

import { DEV, type Issue, type IssueSeverity, shortMessage } from '../shared';
import type { TimeIssueCode } from '../time';
import type { TaskId } from './types';

/**
 * Issue codes produced by `normalizeModel`. Errors make the task invalid (a row
 * without a bar) or drop the item; warnings report a value that was corrected.
 *
 * - `'invalid-shape'` (error): a field has the wrong type. The task becomes invalid;
 *   a task without a usable `id`, and any malformed link, is dropped;
 * - `'duplicate-id'` (error): a task or link id is used again; the later item is dropped;
 * - `'invalid-date'`, `'unsupported-offset'` (error): from parsing `start` / `end`;
 * - `'invalid-duration'` (error): a malformed `duration` or `lag`, a negative or non-finite number
 *   of days, or a lag with months;
 * - `'invalid-granularity'` (error): the `granularity` option; the default `'1d'` is used;
 * - `'misaligned'`: a date, duration or lag is not a multiple of the granularity.
 *   Warning when it was aligned (`suggested` is the applied value), error with
 *   `alignInput: 'reject'` (the task is invalid, the link dropped);
 * - `'no-dates'` (warning): no dates at all, the task is a placeholder row;
 * - `'incomplete-dates'` (error): only `start`, only `end`, or a `duration` without `start`;
 * - `'end-before-start'` (error): `end` lies before `start`;
 * - `'too-long'` (error): longer than the `maxSpan` option (default 10 years);
 * - `'no-working-time'` (error): a working-time `duration` cannot be placed, the calendar has
 *   no working days ahead;
 * - `'progress-out-of-range'` (warning): `progress` outside `0` … `100`, clamped.
 */
export type ModelIssueCode =
  | TimeIssueCode
  | 'invalid-shape'
  | 'duplicate-id'
  | 'misaligned'
  | 'no-dates'
  | 'incomplete-dates'
  | 'end-before-start'
  | 'too-long'
  | 'no-working-time'
  | 'progress-out-of-range';

/** An {@link Issue} raised by the `model` module. */
export type ModelIssue = Issue<ModelIssueCode>;

/** Optional fields of a {@link ModelIssue}. */
interface IssueExtras {
  readonly taskId?: TaskId | undefined;
  readonly linkId?: string | undefined;
  readonly value?: unknown;
  readonly suggested?: unknown;
}

/**
 * Builds a frozen model issue whose message starts with the path (`tasks[2].start: …`), leaving
 * out the extras that are `undefined`. `message` is the development text (pass
 * `DEV ? text : ''`); production keeps the short form.
 *
 * @internal
 */
export function modelIssue(
  code: ModelIssueCode,
  severity: IssueSeverity,
  path: string,
  message: string,
  extras: IssueExtras = {},
): ModelIssue {
  const issue: { -readonly [K in keyof ModelIssue]: ModelIssue[K] } = {
    code,
    severity,
    message: DEV ? `${path}: ${message}` : shortMessage(code, path),
    path,
  };
  if (extras.taskId !== undefined) issue.taskId = extras.taskId;
  if (extras.linkId !== undefined) issue.linkId = extras.linkId;
  if ('value' in extras) issue.value = extras.value;
  if ('suggested' in extras) issue.suggested = extras.suggested;
  return Object.freeze(issue);
}

/**
 * Re-targets an issue from another module (e.g. a `TimeIssue`) to a task or link and freezes it.
 *
 * @internal
 */
export function adoptIssue(
  issue: Issue<TimeIssueCode>,
  path: string,
  taskId: TaskId | undefined,
  linkId?: string,
): ModelIssue {
  return modelIssue(issue.code, issue.severity, path, issue.message, {
    taskId,
    linkId,
    value: issue.value,
  });
}

/**
 * Maps the valibot issues of a shape check (`TaskSchema`, `LinkSchema`) to `'invalid-shape'`
 * errors whose paths continue `base` with the valibot path (`tasks[3].start`, `link.lag`): the one
 * mapping of normalization and of `normalizeLink`.
 *
 * @internal
 */
export function shapeIssues(
  issues: readonly BaseIssue<unknown>[],
  base: string,
  taskId: TaskId | undefined,
  linkId?: string,
): ModelIssue[] {
  return issues.map((issue) => {
    let path = base;
    for (const item of issue.path ?? []) {
      const key: unknown = item.key;
      path += typeof key === 'number' ? `[${key}]` : `.${String(key)}`;
    }
    return modelIssue('invalid-shape', 'error', path, issue.message, {
      taskId,
      linkId,
      value: issue.input,
    });
  });
}
