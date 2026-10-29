/**
 * The memoized pipeline of the store: options → settings, inputs → derived data
 * (`docs/architecture.md` §4). The previous state is the memo: a stage is reused while the
 * inputs it reads keep their identity, so the reducer stays pure.
 */

import { createWorkCalendar } from '../calendar';
import { buildHierarchy, visibleRows } from '../hierarchy';
import type { ModelIssue, NormalizedModel, TaskId, TaskModel, TaskSpan } from '../model';
import { normalizeModel } from '../model';
import { resolveSnap, resolveViewModes, type ViewMode } from '../scale';
import { buildLinkGraph, type Conflict, detectConflicts, type ScheduleState } from '../schedule';
import { DEV, shortMessage } from '../shared';
import { DEFAULT_GRANULARITY, type Granularity, parseGranularity } from '../time';
import { rebaseSession } from './session';
import type {
  DataChange,
  IdDiff,
  StoreIssue,
  StoreOptions,
  StoreSchedulingOptions,
  StoreSettings,
  StoreState,
} from './types';

/**
 * The inputs of a state; everything else is derived from them.
 *
 * @internal
 */
export type StoreInputs<TData> = Omit<StoreState<TData>, 'settings' | 'derived' | 'lastDataChange'>;

/** The active view mode and the issue of an unknown id. */
interface ViewPart {
  readonly viewMode: ViewMode;
  readonly issues: readonly StoreIssue[];
}

const NO_STATE: ScheduleState = /* @__PURE__ */ new Map();
const NO_ISSUES: readonly StoreIssue[] = /* @__PURE__ */ Object.freeze([]);

/**
 * The state for `inputs`, reusing every part of `prev` whose inputs are unchanged (see the table
 * on {@link StoreState}); `prev` itself when nothing changed.
 *
 * @internal
 */
export function deriveState<TData>(
  prev: StoreState<TData> | undefined,
  inputs: StoreInputs<TData>,
): StoreState<TData> {
  const settings = resolveSettings(prev, inputs.options);
  const old = prev?.derived;
  const { tasks, links, viewModeId, expandedKeys } = inputs;

  const model =
    old && prev.tasks === tasks && prev.links === links && prev.settings.model === settings.model
      ? old.model
      : normalizeModel({ tasks, links }, settings.model);
  const hierarchy =
    old && prev.settings.hierarchy === settings.hierarchy && sameTree(old.model, model)
      ? old.hierarchy
      : buildHierarchy(model, settings.hierarchy);
  const graph = old?.model === model ? old.graph : buildLinkGraph(model);
  const conflicts =
    old?.hierarchy === hierarchy && old.graph === graph
      ? old.conflicts
      : byTask(detectConflicts(NO_STATE, { model, hierarchy, graph }));
  const rows =
    old?.hierarchy === hierarchy && prev?.expandedKeys === expandedKeys
      ? old.rows
      : visibleRows(hierarchy, expandedKeys);
  const view: ViewPart =
    old && prev.settings.viewModes === settings.viewModes && prev.viewModeId === viewModeId
      ? old
      : pickViewMode(settings, viewModeId);
  const snap =
    old?.viewMode === view.viewMode && prev?.settings.snap === settings.snap
      ? old.snap
      : resolveSnap({ viewMode: view.viewMode, ...settings.snap });

  const derived = reuse(old, {
    model,
    hierarchy,
    graph,
    conflicts,
    rows,
    viewMode: view.viewMode,
    snap,
    issues: view.issues,
  });
  const lastDataChange =
    prev?.derived.model === model
      ? prev.lastDataChange
      : diffModels(prev, model, prev?.settings.model === settings.model);
  // An open session compares its base under the options in use (see `EditSessionBase.model`); a
  // new base is built from this state's own derived data.
  const { session } = inputs;
  return reuse(prev, {
    ...inputs,
    session:
      session !== undefined && session === prev?.session
        ? rebaseSession(session, prev.settings, settings)
        : session,
    settings,
    derived,
    lastDataChange,
  });
}

/**
 * Whether two models give the same tree: what `buildHierarchy` reads (ids in order, `parentId`,
 * the caller's `parentAnchor` and `followParent`) is unchanged.
 */
function sameTree(a: NormalizedModel, b: NormalizedModel): boolean {
  if (a === b) return true;
  const { tasks } = b;
  return (
    a.tasks.length === tasks.length &&
    a.tasks.every((x, i) => {
      const y = tasks[i];
      return (
        x.id === y?.id &&
        x.parentId === y.parentId &&
        x.task.parentAnchor === y.task.parentAnchor &&
        x.task.followParent === y.task.followParent
      );
    })
  );
}

/** {@link StoreSettings} of `options`, reusing the parts of `prev` whose fields are unchanged. */
function resolveSettings<TData>(
  prev: StoreState<TData> | undefined,
  options: StoreOptions,
): StoreSettings {
  if (prev?.options === options) return prev.settings;
  const old = prev?.settings;
  const before = prev?.options;
  const { dates, scheduling: s = {}, hierarchy: h = {} } = options;
  const calendar =
    old && before?.calendar === options.calendar
      ? old.calendar
      : createWorkCalendar(options.calendar);
  const granularity =
    old && before?.scheduling?.granularity === s.granularity ? old.granularity : granularityOf(s);
  return reuse(old, {
    dataMode: options.dataMode ?? 'uncontrolled',
    calendar,
    model: reuse(old?.model, {
      calendar: calendar.calendar,
      granularity: s.granularity,
      alignInput: s.alignInput,
      endInclusive: dates?.endInclusive,
      durationMode: s.durationMode,
      defaultLinkType: s.defaultLinkType,
    }),
    hierarchy: reuse(old?.hierarchy, { childAnchor: h.childAnchor }),
    propagation: reuse(old?.propagation, {
      // The planned `'push-forward'` is the default until it exists, as in the facade.
      propagation: s.propagation === 'push-forward' ? undefined : s.propagation,
      moveChildren: h.moveChildren,
      skipNonWorkingDays: s.skipNonWorkingDays,
      keepDayPrecision: s.keepDayPrecision,
    }),
    granularity,
    snap: reuse(old?.snap, { option: s.snap, granularity, keepDayPrecision: s.keepDayPrecision }),
    viewModes:
      old && before?.viewModes === options.viewModes
        ? old.viewModes
        : resolveViewModes(options.viewModes),
  });
}

/** The parsed granularity; the default when it is missing or invalid (the model reports it). */
function granularityOf(scheduling: StoreSchedulingOptions): Granularity {
  if (scheduling.granularity === undefined) return DEFAULT_GRANULARITY;
  const parsed = parseGranularity(scheduling.granularity);
  return parsed.ok ? parsed.value : DEFAULT_GRANULARITY;
}

/** The view mode with the requested id, else `'day'`, else the first one (never empty). */
function pickViewMode(settings: StoreSettings, id: string): ViewPart {
  const modes = settings.viewModes.modes as readonly [ViewMode, ...ViewMode[]];
  const found = modes.find((mode) => mode.id === id);
  if (found) return { viewMode: found, issues: NO_ISSUES };
  const viewMode = modes.find((mode) => mode.id === 'day') ?? modes[0];
  const code = 'unknown-view-mode';
  // The path of the option (`viewMode`), so that the facade passes the issue on as it is.
  const path = 'viewMode';
  const issue: StoreIssue = Object.freeze({
    code,
    severity: 'warning',
    message: DEV
      ? `${path}: unknown view mode ${JSON.stringify(id)}, using ${JSON.stringify(viewMode.id)}`
      : shortMessage(code, path),
    path,
    value: id,
  });
  return { viewMode, issues: Object.freeze([issue]) };
}

/** Conflicts grouped by the task they are shown on, in model order. */
function byTask(conflicts: readonly Conflict[]): ReadonlyMap<TaskId, readonly Conflict[]> {
  const map = new Map<TaskId, Conflict[]>();
  for (const conflict of conflicts) {
    const list = map.get(conflict.id);
    if (list) list.push(conflict);
    else map.set(conflict.id, [conflict]);
  }
  for (const list of map.values()) Object.freeze(list);
  return map;
}

/**
 * `prev` when it has the same fields as `next` (compared with `Object.is`), else `next` frozen.
 *
 * @internal
 */
export function reuse<T extends object>(prev: T | undefined, next: T): T {
  return prev !== undefined && shallowEqual(prev, next) ? prev : Object.freeze(next);
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
 * Whether two option values are equal: primitives with `Object.is`, arrays item by item, plain
 * objects key by key, dates by their time; anything else (functions, class instances) only when
 * it is the same object.
 *
 * @internal
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  }
  if (a instanceof Date) return b instanceof Date && Object.is(a.getTime(), b.getTime());
  if (!isPlain(a) || !isPlain(b)) return false;
  const x = a as Readonly<Record<string, unknown>>;
  const y = b as Readonly<Record<string, unknown>>;
  const keys = Object.keys(x);
  return (
    keys.length === Object.keys(y).length &&
    keys.every((key) => Object.hasOwn(y, key) && sameValue(x[key], y[key]))
  );
}

/** Whether an object is a plain one (an object literal or `Object.create(null)`). */
function isPlain(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** {@link DataChange} from the model of `prev` to `next`; `sameOptions`: both normalized alike. */
function diffModels<TData>(
  prev: StoreState<TData> | undefined,
  next: NormalizedModel<TData>,
  sameOptions: boolean,
): DataChange {
  const before = prev?.derived.model;
  const tasks = diffById(
    before?.taskById,
    next.taskById,
    (a, b) => a.task === b.task && (sameOptions || sameValues(a, b)),
  );
  const links = diffById(
    before?.linkById,
    next.linkById,
    (a, b) =>
      a.link === b.link &&
      a.source === b.source &&
      a.target === b.target &&
      a.type === b.type &&
      a.lag === b.lag &&
      a.editable === b.editable,
  );
  const version = prev ? prev.lastDataChange.version + 1 : 0;
  return Object.freeze({ ...tasks, version, links });
}

/**
 * Whether two models of one task (of the same input object) have the same normalized values:
 * what options can change (kind, validity, precision, duration mode, progress, the whole span,
 * the issues).
 */
function sameValues(a: TaskModel, b: TaskModel): boolean {
  return (
    a.valid === b.valid &&
    a.type === b.type &&
    a.precision === b.precision &&
    a.durationMode === b.durationMode &&
    a.progress === b.progress &&
    sameSpan(a.span, b.span) &&
    sameIssues(a.issues, b.issues)
  );
}

function sameSpan(x: TaskSpan | undefined, y: TaskSpan | undefined): boolean {
  if (x === y) return true;
  if (x === undefined || y === undefined) return false;
  const d = x.duration;
  const e = y.duration;
  return (
    x.start === y.start &&
    x.endExclusive === y.endExclusive &&
    x.end === y.end &&
    x.progressDate === y.progressDate &&
    d.calendarDays === e.calendarDays &&
    d.workingDays === e.workingDays &&
    d.nonWorkingDays === e.nonWorkingDays &&
    d.ms === e.ms &&
    d.workingMs === e.workingMs
  );
}

function sameIssues(a: readonly ModelIssue[], b: readonly ModelIssue[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i];
      return (
        x.code === y?.code &&
        x.severity === y.severity &&
        x.path === y.path &&
        x.message === y.message &&
        Object.is(x.value, y.value) &&
        Object.is(x.suggested, y.suggested)
      );
    })
  );
}

function diffById<Id, T>(
  prev: ReadonlyMap<Id, T> | undefined,
  next: ReadonlyMap<Id, T>,
  same: (a: T, b: T) => boolean,
): IdDiff<Id> {
  const added: Id[] = [];
  const updated: Id[] = [];
  for (const [id, item] of next) {
    const old = prev?.get(id);
    if (old === undefined) added.push(id);
    else if (!same(old, item)) updated.push(id);
  }
  const removed: Id[] = [];
  if (prev) for (const id of prev.keys()) if (!next.has(id)) removed.push(id);
  return Object.freeze({
    added: Object.freeze(added),
    removed: Object.freeze(removed),
    updated: Object.freeze(updated),
  });
}
