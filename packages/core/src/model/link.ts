/**
 * Normalization of links (FR-DATA-5, FR-LINK-1, ADR-007): the `links` array and the
 * `Task.dependencies` shorthand become {@link LinkModel}s with a resolved id, type and lag.
 * Whether source and target exist, and cycles, are checked by the graph (plan step 2.3).
 */

import * as v from 'valibot';

import { DEV, err, isObject, ok, type Result } from '../shared';
import { alignDurationMs } from '../time';
import { type ModelIssue, modelIssue, shapeIssues } from './issues';
import type { ResolvedModelOptions } from './options';
import { LinkSchema } from './schema';
import type { Link, LinkType, TaskDependency, TaskId } from './types';
import { durationValue, readDaysOrDuration, reportMisaligned } from './values';

/**
 * A normalized link: core's internal record of one dependency, deeply frozen except for `link`
 * and the `value`s of issues. The graph (plan step 2.3) turns it into the public `LinkRecord`.
 */
export interface LinkModel {
  /** `Link.id`, or `` `${source}:${type}:${target}` `` (for the shorthand always the latter). */
  readonly id: string;
  /** Predecessor, as given. */
  readonly source: TaskId;
  /** Successor, as given. */
  readonly target: TaskId;
  /** `Link.type` or the default link type. */
  readonly type: LinkType;
  /**
   * The lag in milliseconds, aligned to the nearest multiple of the granularity (negative for a
   * lead); counted in the successor's `durationMode` by scheduling. `undefined`: keep the current
   * gap (ADR-007).
   */
  readonly lag: number | undefined;
  /** `Link.editable`, default `true`. */
  readonly editable: boolean;
  /** The caller's `Link`; `undefined` for a link from `Task.dependencies`. */
  readonly link: Link | undefined;
  /** Where it came from: `'links[2]'` or `'tasks[5].dependencies[0]'`. */
  readonly path: string;
  /** Issues of this link (a corrected lag), also listed in `NormalizedModel.issues`. */
  readonly issues: readonly ModelIssue[];
}

/**
 * What a link is made of, from `links` or from the dependency shorthand.
 *
 * @internal
 */
export interface LinkSource {
  readonly id: string | undefined;
  readonly source: TaskId;
  readonly target: TaskId;
  readonly type: LinkType | undefined;
  readonly lag: TaskDependency['lag'];
  readonly editable: boolean | undefined;
  readonly link: Link | undefined;
  /** Task whose `dependencies` listed it (issues carry its id). */
  readonly taskId: TaskId | undefined;
}

/**
 * The id of a link: its own or the default `` `${source}:${type}:${target}` ``.
 *
 * @internal
 */
export function linkIdOf(input: LinkSource, settings: ResolvedModelOptions): string {
  return input.id ?? `${input.source}:${input.type ?? settings.defaultLinkType}:${input.target}`;
}

/**
 * Builds a link model, or reports why the link is dropped (an invalid lag, a lag with months,
 * a misaligned lag with `alignInput: 'reject'`) and returns `undefined`. Issues of a dropped link
 * go to `issues` only.
 *
 * @internal
 */
export function buildLinkModel(
  input: LinkSource,
  id: string,
  path: string,
  settings: ResolvedModelOptions,
  issues: ModelIssue[],
): LinkModel | undefined {
  const own: ModelIssue[] = [];
  const owner = { taskId: input.taskId, linkId: id };
  let lag: number | undefined;
  if (input.lag !== undefined) {
    const lagPath = `${path}.lag`;
    const parsed = readDaysOrDuration(input.lag, lagPath, owner, own, true);
    let accepted = parsed !== undefined;
    if (parsed !== undefined && parsed.months !== 0) {
      own.push(
        modelIssue(
          'invalid-duration',
          'error',
          lagPath,
          DEV ? 'a lag cannot have months, quarters or years' : '',
          {
            ...owner,
            value: input.lag,
          },
        ),
      );
      accepted = false;
    } else if (parsed !== undefined) {
      lag = alignDurationMs(parsed.ms, settings.granularity, 'nearest');
      if (lag !== parsed.ms) {
        accepted = reportMisaligned(
          own,
          lagPath,
          owner,
          settings.granularity,
          settings.alignInput,
          input.lag,
          durationValue(input.lag, { months: 0, ms: lag }),
        );
      }
    }
    if (!accepted) {
      issues.push(...own);
      return undefined;
    }
  }
  issues.push(...own);
  return Object.freeze({
    id,
    source: input.source,
    target: input.target,
    type: input.type ?? settings.defaultLinkType,
    lag,
    editable: input.editable ?? true,
    link: input.link,
    path,
    issues: Object.freeze(own),
  });
}

/**
 * Checks one link against the rules normalization applies to it on its own (FR-DATA-11,
 * FR-LINK-6): its shape (`LinkSchema`), then its lag, read and aligned as `normalizeModel` does
 * (an invalid lag, a lag with months and, with `alignInput: 'reject'`, a misaligned lag drop the
 * link). What depends on other data is not checked: duplicate ids, references and cycles.
 *
 * @param link - The link, possibly from untyped code; never mutated.
 * @param options - The options of the model it is meant for (`NormalizedModel.options`).
 * @param path - Prefix of the issue paths; default `'link'`.
 * @returns The link model normalization would build (resolved id, type and lag, with the warning
 *   of a corrected lag), or the issues why normalization would drop the link.
 *
 * @example
 * ```ts
 * normalizeLink({ source: 'a', target: 'b', lag: { months: 1 } }, model.options);
 * // { ok: false, issue: [{ code: 'invalid-duration', path: 'link.lag', … }] }
 * ```
 */
export function normalizeLink(
  link: unknown,
  options: ResolvedModelOptions,
  path = 'link',
): Result<LinkModel, readonly ModelIssue[]> {
  const shape = v.safeParse(LinkSchema, link);
  if (!shape.success) {
    const id = isObject(link) && typeof link.id === 'string' ? link.id : undefined;
    return err(Object.freeze(shapeIssues(shape.issues, path, undefined, id)));
  }
  const own = link as Link;
  const { id, source, target, type, lag, editable } = own;
  const input: LinkSource = {
    id,
    source,
    target,
    type,
    lag,
    editable,
    link: own,
    taskId: undefined,
  };
  const issues: ModelIssue[] = [];
  const model = buildLinkModel(input, linkIdOf(input, options), path, options, issues);
  return model === undefined ? err(Object.freeze(issues)) : ok(model);
}
