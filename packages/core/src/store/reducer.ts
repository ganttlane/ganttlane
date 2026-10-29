/**
 * The reducer of the store (Command pattern): a pure function from a
 * state and a command to the next state.
 */

import { collapseAll, expandAll, setExpanded, toggleExpanded } from '../hierarchy';
import { type NormalizedModel, patchTasks, type Task, type TaskId } from '../model';
import type { ChangeSet, TaskPatch } from '../schedule';
import { assertNever, isRecord } from '../shared';
import { deriveState, reuse, sameValue, shallowEqual, type StoreInputs } from './pipeline';
import { createSessionBase, rollbackDraft } from './session';
import type {
  Draft,
  DraftLayer,
  SetDataCommand,
  StoreCommand,
  StoreExpandedKeys,
  StoreInit,
  StoreOptions,
  StoreState,
} from './types';

const NO_OPTIONS: StoreOptions = /* @__PURE__ */ Object.freeze({});

/**
 * The first state of a store: the inputs of `init` with every derived stage computed.
 *
 * @param init - Tasks, links, options and the initial UI state.
 * @returns A frozen state.
 */
export function createStoreState<TData = unknown>(init: StoreInit<TData>): StoreState<TData> {
  return deriveState<TData>(undefined, {
    tasks: init.tasks,
    links: init.links,
    options: mergeOptions(NO_OPTIONS, init.options ?? NO_OPTIONS),
    viewModeId: init.viewMode ?? 'day',
    expandedKeys: init.expandedKeys ?? 'all',
    draft: undefined,
    session: undefined,
  });
}

/**
 * Applies a command to a state (see each command type). Pure: never mutates `state`, the
 * command or the caller's data, and returns `state` itself when the command changes nothing, so
 * the snapshot keeps its identity. Derived data is recomputed only where an input changed (the
 * table on {@link StoreState}); every other part of the state keeps its identity.
 *
 * @param state - The current state.
 * @param command - What to change.
 * @returns The next state.
 */
export function reduceStore<TData>(
  state: StoreState<TData>,
  command: StoreCommand<TData>,
): StoreState<TData> {
  switch (command.type) {
    case 'setTasks':
      return update(state, { tasks: command.tasks, draft: undefined });
    case 'setLinks':
      return update(state, { links: command.links });
    case 'setOptions':
      return update(state, { options: mergeOptions(state.options, command.options) });
    case 'setData':
      return update(state, dataInputs(state, command));
    case 'setViewMode':
      return update(state, { viewModeId: command.id });
    case 'setExpandedKeys':
      return expand(state, command.keys);
    case 'setExpanded':
      return expand(
        state,
        setExpanded(state.derived.hierarchy, state.expandedKeys, command.id, command.expanded),
      );
    case 'toggleExpanded':
      return expand(state, toggleExpanded(state.derived.hierarchy, state.expandedKeys, command.id));
    case 'expandAll':
      return expand(state, expandAll(state.derived.hierarchy));
    case 'collapseAll':
      return expand(state, collapseAll());
    case 'applyChangeSet':
      return state.settings.dataMode === 'controlled'
        ? update(state, {
            draft: draftOf(
              state.draft,
              commitLayer(state.draft?.committedLayer, command.changeSet),
              undefined,
            ),
          })
        : update(state, {
            tasks: applyToTasks(state.tasks, command.changeSet, state.derived.model),
            draft: undefined,
          });
    case 'setDraft': {
      const { draft } = state;
      const current = draft?.previewLayer;
      const { changeSet } = command;
      const preview = changeSet === current?.changeSet ? current : changeSet && layerOf(changeSet);
      return update(state, { draft: draftOf(draft, draft?.committedLayer, preview) });
    }
    case 'beginSession':
      return state.session ? state : update(state, { session: createSessionBase(state) });
    case 'commitSession':
      return update(state, { session: undefined });
    case 'rollbackSession':
      return rollback(state);
    default:
      return assertNever(command, 'Unknown store command');
  }
}

/** The state with some inputs replaced; `state` when they are the same. */
function update<TData>(
  state: StoreState<TData>,
  inputs: Partial<StoreInputs<TData>>,
): StoreState<TData> {
  const { settings: _settings, derived: _derived, lastDataChange: _change, ...current } = state;
  const next = { ...current, ...inputs };
  return shallowEqual(current, next) ? state : deriveState(state, next);
}

/** The inputs a `setData` command replaces: only those it gives (see `SetDataCommand`). */
function dataInputs<TData>(
  state: StoreState<TData>,
  command: SetDataCommand<TData>,
): Partial<StoreInputs<TData>> {
  const inputs: { -readonly [K in keyof StoreInputs<TData>]?: StoreInputs<TData>[K] } = {};
  if (command.options !== undefined) {
    inputs.options = mergeOptions(state.options, command.options);
  }
  if (command.tasks !== undefined) {
    inputs.tasks = command.tasks;
    inputs.draft = undefined;
  }
  if ('links' in command) inputs.links = command.links;
  return inputs;
}

/** The state with new expanded keys; an equal list keeps the current one. */
function expand<TData>(state: StoreState<TData>, keys: StoreExpandedKeys): StoreState<TData> {
  const current = state.expandedKeys;
  const same =
    keys === current ||
    (keys !== 'all' &&
      current !== 'all' &&
      keys.length === current.length &&
      keys.every((key, i) => key === current[i]));
  return same ? state : update(state, { expandedKeys: keys });
}

/**
 * The draft of two layers (see {@link Draft}): `current` when it has the same layers, `undefined`
 * without any.
 */
function draftOf(
  current: Draft | undefined,
  committed: DraftLayer | undefined,
  preview: DraftLayer | undefined,
): Draft | undefined {
  if (current?.committedLayer === committed && current?.previewLayer === preview) return current;
  const top = preview ?? committed;
  if (top === undefined) return undefined;
  let { patches } = top;
  if (preview !== undefined && committed !== undefined) {
    const both = new Map(committed.patches);
    for (const [id, patch] of preview.patches) both.set(id, patch);
    patches = both;
  }
  return Object.freeze({
    changeSet: top.changeSet,
    patches,
    committed: committed !== undefined,
    committedLayer: committed,
    previewLayer: preview,
  });
}

/** A draft layer of a change set. */
function layerOf(changeSet: ChangeSet): DraftLayer {
  return Object.freeze({ changeSet, patches: patchesOf(changeSet) });
}

/**
 * The committed layer with a change set committed over controlled data: the change set itself,
 * or, over changes the owner has not applied yet, those of other tasks followed by its own
 * (`reason` and `conflicts` are the new change set's). `current` for an empty change set or the
 * one it shows.
 */
function commitLayer(
  current: DraftLayer | undefined,
  changeSet: ChangeSet,
): DraftLayer | undefined {
  if (changeSet.changes.length === 0 || changeSet === current?.changeSet) return current;
  if (current === undefined) return layerOf(changeSet);
  const ids = new Set(changeSet.changes.map((change) => change.id));
  const kept = current.changeSet.changes.filter((change) => !ids.has(change.id));
  return layerOf(
    Object.freeze({ ...changeSet, changes: Object.freeze([...kept, ...changeSet.changes]) }),
  );
}

/** The `rollbackSession` command: back to the base of the open session. */
function rollback<TData>(state: StoreState<TData>): StoreState<TData> {
  const base = state.session;
  if (base === undefined) return state;
  if (state.settings.dataMode === 'uncontrolled') {
    return update(state, {
      tasks: base.tasks,
      links: base.links,
      draft: undefined,
      session: undefined,
    });
  }
  const changeSet = rollbackDraft(state, base);
  return update(state, {
    draft: draftOf(state.draft, changeSet && layerOf(changeSet), undefined),
    session: undefined,
  });
}

/** `after` of each change by task id; of two changes of one task the later wins. */
function patchesOf(changeSet: ChangeSet): Map<TaskId, TaskPatch> {
  const patches = new Map<TaskId, TaskPatch>();
  for (const change of changeSet.changes) patches.set(change.id, change.after);
  return patches;
}

/** Group options that `setOptions` merges field by field. */
const GROUPS: ReadonlySet<string> = /* @__PURE__ */ new Set([
  'calendar',
  'dates',
  'scheduling',
  'hierarchy',
]);

/**
 * `patch` merged over `options` (see {@link StoreOptions}): groups field by field, other options
 * replaced. A value equal to the current one (`sameValue`: arrays, plain objects and dates by
 * content, functions by identity) keeps the current one, so groups and the whole object keep
 * their identity when nothing changed and nothing downstream is rebuilt.
 */
function mergeOptions(options: StoreOptions, patch: StoreOptions): StoreOptions {
  const next: Record<string, unknown> = { ...options };
  const current = options as Readonly<Record<string, unknown>>;
  for (const [key, value] of Object.entries(patch)) {
    const old = current[key];
    if (GROUPS.has(key) && isRecord(value)) {
      const base = isRecord(old) ? old : undefined;
      next[key] = reuse(base, merged(base, value));
    } else {
      next[key] = sameValue(old, value) ? old : value;
    }
  }
  return reuse(options, next as StoreOptions);
}

/** The fields of `patch` over `base`, each kept as it is in `base` when equal. */
function merged(
  base: Readonly<Record<string, unknown>> | undefined,
  patch: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    next[key] = base !== undefined && sameValue(base[key], value) ? base[key] : value;
  }
  return next;
}

/**
 * The tasks with the `after` of each change written back by `patchTasks` (uncontrolled data),
 * frozen like the rest of the snapshot. `tasks` itself when no task changes.
 */
function applyToTasks<TData>(
  tasks: readonly Task<TData>[],
  changeSet: ChangeSet,
  model: NormalizedModel<TData>,
): readonly Task<TData>[] {
  const next = patchTasks(tasks, changeSet, model);
  return next === tasks ? tasks : Object.freeze(next);
}
