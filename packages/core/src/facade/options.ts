/**
 * The facade's options at the boundary: the shallow checks of every option
 * (the modules check the inside of their groups), the field-by-field merge of `setOptions`, and
 * the invalidation matrix that routes each option to what it invalidates.
 */

import { DEV, isObject, isRecord, isSize, type Issue, shortMessage } from '../shared';
import type { GanttCoreOptions, GanttEventName } from './types';

/** Every facade event, as a record so that the compiler keeps it complete. */
const EVENTS: Readonly<Record<GanttEventName, true>> = {
  tasksChange: true,
  taskDatesChange: true,
  taskProgressChange: true,
  linkCreate: true,
  linkDelete: true,
  linkClick: true,
  taskClick: true,
  taskDoubleClick: true,
  taskHoverChange: true,
  selectionChange: true,
  viewModeChange: true,
  rangeChange: true,
  expandedChange: true,
  scroll: true,
  editRollback: true,
  dirtyChange: true,
  historyChange: true,
  editRefused: true,
  issues: true,
  error: true,
};

/**
 * The event of an option-style handler key (`'onTaskClick'` → `'taskClick'`), `undefined` for a
 * key that is no event handler.
 *
 * @internal
 */
export function eventOfHandler(key: string): GanttEventName | undefined {
  if (!key.startsWith('on') || key.length < 3) return undefined;
  const name = key.charAt(2).toLowerCase() + key.slice(3);
  return name in EVENTS ? (name as GanttEventName) : undefined;
}

/** The before-hook options, passed to the change controller as they are. */
const HOOK_KEYS: ReadonlySet<string> = /* @__PURE__ */ new Set([
  'onBeforeTaskChange',
  'onBeforeLinkCreate',
]);

/**
 * Whether a key is an option-style handler of the facade: an event's or a before-hook's.
 *
 * @internal
 */
export function isHandlerKey(key: string): boolean {
  return HOOK_KEYS.has(key) || eventOfHandler(key) !== undefined;
}

/**
 * Issue codes of the facade's options (errors; the default is used instead, `suggested` when it
 * is a plain value):
 * - `'invalid-option'`: an option has the wrong type or an unusable value;
 * - `'unsupported-option'`: a value that is planned for a later release and not available yet,
 *   such as `scheduling.propagation: 'push-forward'`.
 */
export type OptionIssueCode = 'invalid-option' | 'unsupported-option';

/** An {@link Issue} of the facade's options. */
export type OptionIssue = Issue<OptionIssueCode>;

/**
 * What an option invalidates (see {@link OPTION_INVALIDATION}):
 * - `'store'`: the store pipeline, through `controller.update` with one `setData` command for
 *   the tasks, the links and the store's options of a call, so edit sessions and the history see
 *   one owner change and the model is derived once; the store recomputes only the stages whose
 *   inputs changed (the table on `StoreState`), and the snapshot whatever depends on them;
 * - `'view-mode'`: the store's view mode, then the timeline is rebased around the centre;
 * - `'rows'`: the store's expanded parents: visible rows, row metrics, bars;
 * - `'layout'`: row metrics (`rowHeight`, `headerRowHeight`) or bar geometry (`barHeight`,
 *   `barRadius`);
 * - `'timeline'`: the range, the scale and the infinite timeline's policy;
 * - `'now'`: the snapshot's `now` (the minute), read again when the `now` option changes;
 * - `'header'`: the header context (labels);
 * - `'scroll'`: the scroll options (initial scroll, behaviour, alignment, drag autoscroll in the
 *   interaction context);
 * - `'editing'`: the snapshot's `editing` part (the resolved flags), and with it the interaction
 *   context; nothing else is recomputed;
 * - `'handles'`: the snapshot's `handles` part (the resolved handle sizes);
 * - `'interaction'`: the interaction machine is recreated (a gesture in progress is cancelled);
 * - `'history'`: `history.configure`;
 * - `'handlers'`: `controller.setHandlers`, O(1) per handler.
 */
export type OptionTarget =
  | 'store'
  | 'view-mode'
  | 'rows'
  | 'layout'
  | 'timeline'
  | 'now'
  | 'header'
  | 'scroll'
  | 'editing'
  | 'handles'
  | 'interaction'
  | 'history'
  | 'handlers';

/** Keys of {@link GanttCoreOptions} besides the handlers. */
export type OptionKey = Exclude<keyof GanttCoreOptions, `on${string}`>;

/**
 * The invalidation matrix of `setOptions` as data: which parts each option invalidates.
 * `setOptions` routes every given key by it, and each part recomputes only what depends on what
 * changed (memoized by identity). Handlers (`on*`) invalidate `'handlers'` only.
 *
 * | Option | Store pipeline | Layout | Timeline | Interaction | Other snapshot parts |
 * | --- | --- | --- | --- | --- | --- |
 * | `tasks`, `links` | model → graph → conflicts (tree, rows when the tree changed) | bars (rows when they changed) | range (`'data'`) | context | — |
 * | `calendar`, `dates`, `scheduling.granularity` / `.alignInput` / `.durationMode` / `.defaultLinkType` | as for `tasks` | bars | range | context | — |
 * | `scheduling.snap`, `.keepDayPrecision` | snap (`.keepDayPrecision` also settings) | — | — | context | — |
 * | `scheduling.propagation`, `.skipNonWorkingDays`, `hierarchy.moveChildren`, `dataMode` | settings only | — | — | context | — |
 * | `hierarchy.childAnchor` | tree → conflicts, rows | rows, bars | — | context | — |
 * | `hierarchy.expandedKeys` | rows | rows, bars | — | — | — |
 * | `viewModes`, `viewMode` | view mode → snap | header rows | scale, range (`'view-mode'`) | context | — |
 * | `layout` | — | rows and / or bars | — | context (hit test) | — |
 * | `timeline`, `direction` | — | bars when the scale changed | range, scale, policy | — | — |
 * | `now` | — | — | range, scale, policy | — | `now` (the minute) |
 * | `locale` | — | — | header labels | — | — |
 * | `scroll` | — | — | requests | context (`autoScroll`) | — |
 * | `editing` | — | — | — | context | `editing` |
 * | `interaction` | — | — | — | machine recreated | `handles` (when a size changed) |
 * | `history` | — | — | — | — (history settings) | — |
 * | `on*` | — | — | — | — (handlers, O(1)) | — |
 *
 * @internal
 */
export const OPTION_INVALIDATION: Readonly<Record<OptionKey, readonly OptionTarget[]>> =
  /* @__PURE__ */ Object.freeze({
    tasks: ['store'],
    links: ['store'],
    dataMode: ['store'],
    calendar: ['store'],
    dates: ['store'],
    scheduling: ['store'],
    hierarchy: ['store', 'rows'],
    viewModes: ['store'],
    viewMode: ['view-mode'],
    layout: ['layout'],
    timeline: ['timeline'],
    now: ['timeline', 'now'],
    direction: ['timeline'],
    locale: ['header'],
    scroll: ['scroll'],
    editing: ['editing'],
    interaction: ['interaction', 'handles'],
    history: ['history'],
  });

/** Groups merged field by field by `setOptions`. */
const GROUPS: ReadonlySet<string> = /* @__PURE__ */ new Set([
  'calendar',
  'dates',
  'scheduling',
  'hierarchy',
  'layout',
  'timeline',
  'scroll',
  'interaction',
]);

/** Numeric fields of `interaction` and `interaction.handles`: finite, `0` or more. */
const INTERACTION_NUMBERS: readonly string[] = [
  'dragThreshold',
  'touchDragThreshold',
  'doubleClickTime',
  'doubleClickDistance',
];
const HANDLE_NUMBERS: readonly string[] = ['resize', 'progress', 'link', 'linkOffset'];

/** A boolean field that defaults to `true`, and one that defaults to `false`. */
const ON: readonly unknown[] = [true, false];
const OFF: readonly unknown[] = [false, true];

/**
 * The enum and boolean fields the facade checks, by option path: the values
 * each field takes, its default first. A path listed here as a field of another path is a nested
 * object of such fields (`scheduling.skipNonWorkingDays`). The modules check the other fields
 * (`calendar`, `scheduling.granularity` and `.snap`, `hierarchy.childAnchor`, `layout`,
 * `timeline`, `scroll`, `viewModes`).
 */
const FIELDS: Readonly<Record<string, Readonly<Record<string, readonly unknown[]>>>> = {
  dates: { endInclusive: ON },
  scheduling: {
    durationMode: ['calendar', 'working'],
    propagation: ['preserve-lag', 'none'],
    defaultLinkType: ['FS', 'SS', 'FF', 'SF'],
    alignInput: ['expand', 'nearest', 'reject'],
    keepDayPrecision: ON,
  },
  'scheduling.skipNonWorkingDays': { move: ON, resize: OFF, progress: ON },
  hierarchy: { moveChildren: ['all', 'following', 'none'] },
  editing: { move: ON, resize: ON, progress: ON, links: ON },
};

/** Values that are planned for a later release and not available yet, by option path. */
const LATER: Readonly<Record<string, readonly unknown[]>> = {
  'scheduling.propagation': ['push-forward'],
};

/** A checked option patch: the accepted values by key and the issues of each key given. */
export interface CheckedOptions {
  /** The values to apply, by key; an unusable value is replaced by `undefined` (its default). */
  readonly values: Readonly<Record<string, unknown>>;
  /** The issues of each key given; a key without issues maps to an empty list. */
  readonly issues: ReadonlyMap<string, readonly OptionIssue[]>;
}

const NO_ISSUES: readonly OptionIssue[] = /* @__PURE__ */ Object.freeze([]);

/**
 * Checks an options object at the boundary, key by key; never throws. Unknown keys (renderer
 * options) are ignored. Group objects are checked for their type here, and so are the enum and
 * boolean fields of `dates`, `scheduling`, `hierarchy` and `editing`, `interaction` and
 * `history`; the modules check the other fields (`resolveLayoutOptions`,
 * `resolveTimelineOptions`, …). An unusable field of a group is set to `undefined`, so that
 * `setOptions` returns it to its default instead of keeping the value it had.
 *
 * @internal
 */
export function checkOptions(input: unknown, creating: boolean): CheckedOptions {
  const values: Record<string, unknown> = {};
  const issues = new Map<string, readonly OptionIssue[]>();
  if (!isRecord(input)) {
    if (input !== undefined || creating) {
      issues.set('', [issue('', DEV ? `${show(input)} is not an options object` : '', input)]);
    }
    if (creating) values.tasks = Object.freeze([]);
    return { values, issues };
  }
  if (creating && !('tasks' in input)) {
    issues.set('tasks', [issue('tasks', DEV ? 'is missing, no tasks are shown' : '', undefined)]);
    values.tasks = Object.freeze([]);
  }
  for (const [key, value] of Object.entries(input)) {
    const found: OptionIssue[] = [];
    const accepted = checkOption(key, value, found);
    if (accepted === SKIP) continue;
    values[key] = accepted;
    issues.set(key, found.length === 0 ? NO_ISSUES : Object.freeze(found));
  }
  return { values, issues };
}

/** Marks a key the facade does not know. */
const SKIP: unique symbol = /* @__PURE__ */ Symbol('skip');

function checkOption(key: string, value: unknown, issues: OptionIssue[]): unknown {
  const fail = (message: string, fallback?: unknown): unknown => {
    issues.push(issue(key, DEV ? `${show(value)} ${message}` : '', value));
    return fallback;
  };
  if (isHandlerKey(key)) {
    return value === undefined || typeof value === 'function'
      ? value
      : fail(DEV ? 'is not a function' : '');
  }
  switch (key) {
    case 'tasks':
      return Array.isArray(value)
        ? value
        : fail(DEV ? 'is not an array of tasks' : '', Object.freeze([]));
    case 'links':
      return value === undefined || Array.isArray(value)
        ? value
        : fail(DEV ? 'is not an array of links' : '');
    case 'dataMode':
      return value === undefined || value === 'controlled' || value === 'uncontrolled'
        ? value
        : fail(DEV ? "is not 'controlled' or 'uncontrolled'" : '');
    case 'viewMode':
      return value === undefined || typeof value === 'string'
        ? value
        : fail(DEV ? 'is not a view mode id' : '');
    case 'viewModes':
      return value === undefined || isObject(value)
        ? value
        : fail(DEV ? 'is not a list of view modes or overrides' : '');
    case 'hierarchy':
      return isRecord(value) ? checkHierarchy(value, issues) : checkGroup(key, value, issues);
    case 'locale':
      return value === undefined || isLocale(value)
        ? value
        : fail(DEV ? 'is not a BCP 47 locale' : '');
    case 'direction':
      return value === undefined || value === 'ltr' || value === 'rtl'
        ? value
        : fail(DEV ? "is not 'ltr' or 'rtl'" : '');
    case 'now':
      return value === undefined || typeof value === 'function'
        ? value
        : fail(DEV ? 'is not a function' : '');
    case 'editing':
      if (isRecord(value)) return checkFields(key, value, issues);
      return value === undefined || typeof value === 'boolean'
        ? value
        : fail(DEV ? 'is not a boolean or { move, resize, progress, links }' : '');
    case 'history':
      return checkHistory(value, issues);
    case 'interaction':
      return isRecord(value) ? checkInteraction(value, issues) : checkGroup(key, value, issues);
    default:
      if (!GROUPS.has(key)) return SKIP;
      return isRecord(value) ? checkFields(key, value, issues) : checkGroup(key, value, issues);
  }
}

function checkGroup(key: string, value: unknown, issues: OptionIssue[]): unknown {
  if (value === undefined || isRecord(value)) return value;
  issues.push(issue(key, DEV ? `${show(value)} is not an options object` : '', value));
  return undefined;
}

/**
 * `value` (the object at `path`) with its fields listed in {@link FIELDS} checked: an unusable
 * one is reported with its default as `suggested` and set to `undefined`; a value listed in
 * {@link LATER} is `'unsupported-option'`. `value` itself when every field is usable.
 */
function checkFields(
  path: string,
  value: Readonly<Record<string, unknown>>,
  issues: OptionIssue[],
): Readonly<Record<string, unknown>> {
  const fields = FIELDS[path] ?? {};
  let next: Record<string, unknown> | undefined;
  for (const [field, given] of Object.entries(value)) {
    const allowed = Object.hasOwn(fields, field) ? fields[field] : undefined;
    const at = `${path}.${field}`;
    let checked: unknown = given;
    if (given === undefined) continue;
    if (Object.hasOwn(FIELDS, at)) {
      if (isRecord(given)) checked = checkFields(at, given, issues);
      else {
        report(issues, at, DEV ? 'is not an object of flags' : '', given);
        checked = undefined;
      }
    } else if (allowed !== undefined && !allowed.includes(given)) {
      const later = LATER[at]?.includes(given) === true;
      const message = !DEV
        ? ''
        : later
          ? `is not supported yet, ${show(allowed[0])} is used`
          : `is not ${allowed.map(show).join(' or ')}`;
      report(issues, at, message, given, allowed[0], later);
      checked = undefined;
    }
    if (checked === given) continue;
    next ??= { ...value };
    next[field] = checked;
  }
  return next === undefined ? value : Object.freeze(next);
}

/** Reports an unusable value; `message` follows the value (pass `DEV ? text : ''`). */
function report(
  issues: OptionIssue[],
  path: string,
  message: string,
  value: unknown,
  suggested?: unknown,
  later = false,
): void {
  const text = DEV ? `${show(value)} ${message}` : '';
  issues.push(issue(path, text, value, suggested, later ? 'unsupported-option' : 'invalid-option'));
}

function checkHierarchy(
  value: Readonly<Record<string, unknown>>,
  issues: OptionIssue[],
): Readonly<Record<string, unknown>> {
  const keys = value.expandedKeys;
  if (keys === undefined || keys === 'all' || Array.isArray(keys)) {
    return checkFields('hierarchy', value, issues);
  }
  report(
    issues,
    'hierarchy.expandedKeys',
    DEV ? "is not 'all' or a list of task ids" : '',
    keys,
    'all',
  );
  return checkFields('hierarchy', Object.freeze({ ...value, expandedKeys: undefined }), issues);
}

function checkHistory(value: unknown, issues: OptionIssue[]): unknown {
  if (value === undefined || typeof value === 'boolean') return value;
  if (!isRecord(value)) {
    const message = DEV ? `${show(value)} is not a boolean or { enabled, limit }` : '';
    issues.push(issue('history', message, value));
    return undefined;
  }
  const { enabled, limit } = value;
  const next: { enabled?: unknown; limit?: unknown } = {};
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    issues.push(issue('history.enabled', DEV ? `${show(enabled)} is not a boolean` : '', enabled));
  } else if (enabled !== undefined) next.enabled = enabled;
  const usable =
    limit === Infinity || (typeof limit === 'number' && Number.isInteger(limit) && limit >= 0);
  if (limit !== undefined && !usable) {
    const message = DEV ? `${show(limit)} is not a whole number, 0 or more, or Infinity` : '';
    issues.push(issue('history.limit', message, limit, 100));
  } else if (limit !== undefined) next.limit = limit;
  return Object.freeze(next);
}

function checkInteraction(
  value: Readonly<Record<string, unknown>>,
  issues: OptionIssue[],
): Readonly<Record<string, unknown>> {
  // An unusable size is set to `undefined`: its default, also over a value set before.
  const sizes = (
    group: Readonly<Record<string, unknown>>,
    fields: readonly string[],
    prefix: string,
  ): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(group).map(([field, size]) => {
        if (!fields.includes(field) || size === undefined || isSize(size)) return [field, size];
        report(issues, `${prefix}.${field}`, DEV ? 'is not a finite number, 0 or more' : '', size);
        return [field, undefined];
      }),
    );
  const next = sizes(value, INTERACTION_NUMBERS, 'interaction');
  const { handles } = next;
  if (isRecord(handles)) {
    next.handles = Object.freeze(sizes(handles, HANDLE_NUMBERS, 'interaction.handles'));
  } else if (handles !== undefined) {
    report(issues, 'interaction.handles', DEV ? 'is not an object' : '', handles);
    next.handles = undefined;
  }
  return Object.freeze(next);
}

/**
 * `patch` merged over `options` (see `GanttCoreOptionsPatch`): groups field by field, the others
 * replaced; a group keeps its identity when its fields are unchanged, and so does the whole
 * object. Never mutates either.
 *
 * @internal
 */
export function mergeOptions<T extends object>(
  options: T,
  patch: Readonly<Record<string, unknown>>,
): T {
  const current = options as Readonly<Record<string, unknown>>;
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    const group = current[key];
    next[key] =
      GROUPS.has(key) && isRecord(value) && isRecord(group)
        ? reuse(group, { ...group, ...value })
        : value;
  }
  return reuse(current, next) as T;
}

/**
 * `prev` when it has the same own keys with `Object.is`-equal values as `next`, else `next`
 * frozen.
 *
 * @internal
 */
export function reuse<T extends object>(prev: T | undefined, next: T): T {
  if (prev !== undefined && shallowEqual(prev, next)) return prev;
  return Object.freeze(next);
}

/**
 * Whether two objects have the same own keys with `Object.is`-equal values.
 *
 * @internal
 */
export function shallowEqual(a: object, b: object): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  const x = a as Readonly<Record<string, unknown>>;
  const y = b as Readonly<Record<string, unknown>>;
  return keys.every((key) => key in y && Object.is(x[key], y[key]));
}

/**
 * The targets of the given option keys (a key outside the matrix is a handler).
 *
 * @internal
 */
export function targetsOf(keys: Iterable<string>): ReadonlySet<OptionTarget> {
  const targets = new Set<OptionTarget>();
  const matrix = OPTION_INVALIDATION as Readonly<Record<string, readonly OptionTarget[]>>;
  for (const key of keys) {
    const listed = matrix[key];
    if (listed !== undefined) for (const target of listed) targets.add(target);
    else if (isHandlerKey(key)) targets.add('handlers');
  }
  return targets;
}

/**
 * Builds an option issue. `message` is the development text (pass `DEV ? text : ''`);
 * production keeps the short form.
 *
 * @internal
 */
export function issue(
  path: string,
  message: string,
  value: unknown,
  suggested?: unknown,
  code: OptionIssueCode = 'invalid-option',
): OptionIssue {
  const found: OptionIssue = {
    code,
    severity: 'error',
    message: !DEV
      ? shortMessage(code, path)
      : path === ''
        ? `options: ${message}`
        : `${path}: ${message}`,
    value,
    ...(path === '' ? {} : { path }),
    ...(suggested === undefined ? {} : { suggested }),
  };
  return Object.freeze(found);
}

/**
 * The issues of an option group with paths from the root of the options (`'padding'` →
 * `'timeline.padding'`, `'day.pxPerDay'` → `'viewModes.day.pxPerDay'`, no path → the group), so
 * that the production message `'<path>: <code>'` names the option; the development message
 * starts with the path too. An issue whose path already starts with the group is kept, and so
 * is an empty list.
 *
 * @internal
 */
export function qualifyIssues(group: string, issues: readonly Issue[]): readonly Issue[] {
  if (issues.length === 0) return issues;
  return Object.freeze(
    issues.map((found) => {
      const { code, message, path = '' } = found;
      if (path === group || path.startsWith(`${group}.`) || path.startsWith(`${group}[`)) {
        return found;
      }
      const full = path === '' ? group : path.startsWith('[') ? group + path : `${group}.${path}`;
      const text = !DEV
        ? shortMessage(code, full)
        : message.startsWith(`${full}: `)
          ? message
          : `${full}: ${message}`;
      return Object.freeze({ ...found, path: full, message: text });
    }),
  );
}

/**
 * Whether two issue lists are equal item by item, field by field (`Object.is`).
 *
 * @internal
 */
export function sameIssues(a: readonly Issue[], b: readonly Issue[]): boolean {
  return (
    a === b ||
    (a.length === b.length &&
      a.every((found, i) => {
        const other = b[i];
        return other !== undefined && shallowEqual(found, other);
      }))
  );
}

function isLocale(value: unknown): boolean {
  if (typeof value !== 'string' || value === '') return false;
  try {
    Intl.getCanonicalLocales(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * A value for a message: strings quoted, objects by kind, the rest as `String()`.
 *
 * @internal
 */
export function show(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'function') return 'a function';
  return typeof value === 'object' && value !== null ? 'an object' : String(value);
}
