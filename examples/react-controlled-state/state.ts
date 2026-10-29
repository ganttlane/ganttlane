import {
  type ChangeSet,
  type ExpandedKeys,
  type Link,
  patchTasks,
  type Task,
  type TaskId,
} from '@ganttlane/react';

import { links, tasks } from './data';
import { options } from './options';

/** The `model` a change set was computed on: `chart.core.getSnapshot().state.derived.model`. */
type Model = Parameters<typeof patchTasks>[2];

/** The five groups of the chart that this application owns. */
export type Field = 'tasks' | 'links' | 'viewMode' | 'selectedKeys' | 'expandedKeys';

/**
 * The application's state, which is the truth about five groups of the chart: they are given to
 * `<Gantt>` as props, and the chart follows them. (`last` is only for the inspector: what the
 * last action changed.)
 */
export interface State {
  readonly tasks: readonly Task[];
  readonly links: readonly Link[];
  readonly viewMode: string;
  readonly selectedKeys: readonly TaskId[];
  readonly expandedKeys: ExpandedKeys;
  readonly last: {
    readonly field: Field | undefined;
    /** For `tasks`: the tasks the change set changed. */
    readonly ids: readonly TaskId[];
    readonly note: string;
  };
}

export type Action =
  | { type: 'tasks'; changes: ChangeSet; model: Model }
  | { type: 'links'; links: readonly Link[] }
  | { type: 'viewMode'; id: string; by: string }
  | { type: 'selectedKeys'; keys: readonly TaskId[]; by: string }
  | { type: 'expandedKeys'; keys: ExpandedKeys; by: string }
  | { type: 'reset' };

export const initial: State = {
  tasks,
  links,
  viewMode: options.viewMode,
  selectedKeys: [],
  expandedKeys: 'all',
  last: { field: undefined, ids: [], note: 'The first state.' },
};

const sameKeys = (a: readonly TaskId[], b: readonly TaskId[]): boolean =>
  a.length === b.length && a.every((key, at) => key === b[at]);
const sameExpanded = (a: ExpandedKeys, b: ExpandedKeys): boolean =>
  typeof a === 'string' || typeof b === 'string' ? a === b : sameKeys(a, b);

/** The application's reducer: the one place where the chart's changes become state. */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'tasks': {
      // `patchTasks` writes a change set into your tasks, in the shape each one has, and returns
      // a new array (the same one if nothing changed). Passing it back ends the chart's draft.
      const next = patchTasks(state.tasks, action.changes, action.model);
      const ids = action.changes.changes.map((change) => change.id);
      return {
        ...state,
        tasks: next,
        last: {
          field: 'tasks',
          ids,
          note: `onTasksChange (${action.changes.reason}): patchTasks wrote ${String(ids.length)} ${ids.length === 1 ? 'task' : 'tasks'}.`,
        },
      };
    }
    case 'links':
      return {
        ...state,
        links: action.links,
        last: {
          field: 'links',
          ids: [],
          note: 'onLinksChange: your links, with the change applied.',
        },
      };
    case 'viewMode':
      if (action.id === state.viewMode) return state;
      return {
        ...state,
        viewMode: action.id,
        last: { field: 'viewMode', ids: [], note: `${action.by}: the view mode is ${action.id}.` },
      };
    case 'selectedKeys':
      // The same keys again are no change: do not give the chart a new array for nothing.
      if (sameKeys(action.keys, state.selectedKeys)) return state;
      return {
        ...state,
        selectedKeys: action.keys,
        last: { field: 'selectedKeys', ids: [], note: `${action.by}: the selection changed.` },
      };
    case 'expandedKeys':
      if (sameExpanded(action.keys, state.expandedKeys)) return state;
      return {
        ...state,
        expandedKeys: action.keys,
        last: { field: 'expandedKeys', ids: [], note: `${action.by}: the open phases changed.` },
      };
    case 'reset':
      return initial;
  }
}
