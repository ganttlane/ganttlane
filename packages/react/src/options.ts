import { MERGED_OPTION_GROUPS } from '@ganttlane/dom/facade';

/** A plain object of unknown values: the shape of a set of options, and of the props. */
export type Fields = Readonly<Record<string, unknown>>;

/** Whether a value is a plain object (not an array, not `null`). */
export function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The five groups that are controlled or uncontrolled (`GanttControlledProps`). */
export type ControlledKey = 'tasks' | 'links' | 'viewMode' | 'expandedKeys' | 'selectedKeys';

/** The groups, in the order they are checked. */
export const CONTROLLED_KEYS: readonly ControlledKey[] = [
  'tasks',
  'links',
  'viewMode',
  'expandedKeys',
  'selectedKeys',
];

/** Whether each group is controlled: decided when the chart is created, and kept. */
export type Modes = Readonly<Record<ControlledKey, boolean>>;

/**
 * The mode of each group: controlled when its value prop is not `undefined`.
 *
 * @param props - The props of the first render.
 * @returns The modes to keep.
 */
export function modesOf(props: Fields): Modes {
  return Object.fromEntries(
    CONTROLLED_KEYS.map((key) => [key, props[key] !== undefined]),
  ) as unknown as Modes;
}

/**
 * Props that are not options: the controlled / uncontrolled pairs, the one option read only at
 * creation (`renderer`), `dataMode` (the mode of `tasks` decides it), the slots (they are
 * drawn by React, and the chart is given a function of its own for each) and the container's.
 */
const NOT_OPTIONS: ReadonlySet<string> = new Set([
  'tasks',
  'defaultTasks',
  'links',
  'defaultLinks',
  'onLinksChange',
  'viewMode',
  'defaultViewMode',
  'expandedKeys',
  'defaultExpandedKeys',
  'selectedKeys',
  'defaultSelectedKeys',
  'renderer',
  'dataMode',
  'renderTooltip',
  'renderLinkMenu',
  'renderBarLabel',
  'className',
  'style',
]);

/** The props split into the options to diff and the handlers the application gave. */
export interface Parts {
  /** Options, as given: no handlers that are functions, no controlled pairs. */
  readonly options: Fields;
  /** The `on<Event>` handlers that are functions, by key. */
  readonly handlers: Fields;
}

const HANDLER_KEY = /^on[A-Z]/;

/**
 * Splits props into options and handlers. A handler that is not a function stays among the
 * options, so that the core reports it like any unusable option.
 *
 * @param props - The props or options of the chart.
 * @returns The two parts.
 */
export function splitProps(props: Fields): Parts {
  const options: Record<string, unknown> = {};
  const handlers: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (NOT_OPTIONS.has(key)) continue;
    if (HANDLER_KEY.test(key) && typeof value === 'function') handlers[key] = value;
    else options[key] = value;
  }
  return { options, handlers };
}

/** Nesting `equalData` follows; deeper values are compared by identity. */
const MAX_DEPTH = 6;

/**
 * Whether two option values are the same data: identical, or arrays, plain objects and `Date`s
 * with equal contents. Functions and every other object (a `Map`, a class instance) count only
 * when identical. It lets an option written inline (`calendar={{ weekends: [0, 6] }}`) cost
 * nothing on the renders where it did not change.
 *
 * @param a - A value.
 * @param b - Another.
 * @param depth - How deep the comparison already is.
 * @returns `true` when applying `b` over `a` would change nothing.
 */
export function equalData(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true;
  if (depth >= MAX_DEPTH || typeof a !== 'object' || typeof b !== 'object') return false;
  if (a === null || b === null) return false;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && Object.is(a.getTime(), b.getTime());
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item: unknown, index) => equalData(item, b[index], depth + 1))
    );
  }
  if (!isPlain(a) || !isPlain(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equalData(a[key], b[key], depth + 1))
  );
}

function isPlain(value: object): value is Fields {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * The fields of `next` that differ from `prev`, `undefined` for a field `prev` had and `next`
 * has not (what `setOptions` reads as "back to the default"); `undefined` when none differs.
 */
function changedFields(prev: Fields, next: Fields): Record<string, unknown> | undefined {
  let changed: Record<string, unknown> | undefined;
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (!equalData(prev[key], next[key])) (changed ??= {})[key] = next[key];
  }
  return changed;
}

/**
 * What to hand to `setOptions` so that the chart goes from the options `prev` to `next`, as a
 * declarative prop expects: only what changed, and a removed option or a removed field of a
 * group put back to its default (`undefined`).
 *
 * - `tasks` and `links` are compared by identity: the same array again is nothing, a new one is
 *   given to the core, which diffs it by id.
 * - The groups `setOptions` merges field by field (`MERGED_OPTION_GROUPS`) go by field, so
 *   `scheduling={{ snap: '1h' }}` after `{ snap: '1h', propagation: 'none' }` sends
 *   `{ scheduling: { propagation: undefined } }`, and a group that is dropped sends each of its
 *   fields as `undefined`, not the group as `undefined`: that would also reset the fields of the
 *   group that the props never had.
 * - Every other option goes whole when its data changed (`equalData`).
 *
 * @param prev - The options the chart has.
 * @param next - The options it should have.
 * @returns A patch, or `undefined` when there is nothing to change.
 */
export function diffOptions(prev: Fields, next: Fields): Record<string, unknown> | undefined {
  let patch: Record<string, unknown> | undefined;
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const before = prev[key];
    const after = next[key];
    if (Object.is(before, after)) continue;
    // A group that is dropped is diffed against an empty one, field by field, rather than sent as
    // `undefined`, which would put back every field of the group, also those that are not the
    // props' (the `expandedKeys` the user has set in an uncontrolled `hierarchy`).
    const dropped = after === undefined && isRecord(before);
    if (
      key !== 'tasks' &&
      key !== 'links' &&
      MERGED_OPTION_GROUPS.has(key) &&
      (isRecord(after) || dropped)
    ) {
      const fields = changedFields(isRecord(before) ? before : {}, isRecord(after) ? after : {});
      if (fields !== undefined) (patch ??= {})[key] = fields;
    } else if (key === 'tasks' || key === 'links' || !equalData(before, after)) {
      (patch ??= {})[key] = after;
    }
  }
  return patch;
}
