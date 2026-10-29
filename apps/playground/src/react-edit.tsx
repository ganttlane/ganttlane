/**
 * The editing page of React (`/react-edit/`, plan step 6.1): `/edit/` for `<Gantt>`. A chart to
 * drag bars on, by hand or from the e2e scenarios (`e2e/journeys/`), with a log of what the chart
 * reports, and the same test hook as the vanilla page (`window.__ganttEdit`, the contract of
 * `harness.ts`), so that one scenario runs on both.
 *
 * - **Controlled data.** The page owns the `tasks` and `links` of the chart, as an application
 *   does. `onTasksChange` writes every change into them with `patchTasks` (a drag, and also an
 *   undo, a redo and an edit session's rollback), `onLinksChange` keeps the links, and
 *   `onEditRollback` restores the links a cancelled session took away.
 * - **Options as props.** `mount(config)` takes the options of the chart (`viewMode` becomes
 *   `defaultViewMode`; `today` becomes `now`; `width` is the width of the container), and
 *   `update(patch)` changes `theme`, `locale`, `editing`, … while the chart runs: new props, which
 *   the component turns into a `setOptions` of those options alone. A locale brings the strings
 *   of its language along.
 * - **Builds.** The page is wrapped in `<StrictMode>`, which does something only in the
 *   development builds (`/dev/react-edit/`, and `/react-18/react-edit/` for React 18.3, see
 *   `vite.config.ts`).
 *
 * Nothing but `mount` and `update` is a control: specs drive the chart with the real mouse and
 * keyboard, and call its methods through `chart`, the `ref` handle.
 */
import '@ganttlane/dom/styles.css';
import './playground.css';

import type { ChangeSet, GanttHandle, Link, Task } from '@ganttlane/react';
import { Gantt, patchTasks } from '@ganttlane/react';
import type { ReactElement } from 'react';
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import type { EditHarness, HarnessConfig, OwnedTask, RuntimeOptions } from './harness';
import { restoreLinks } from './plan-links';
import { createRecorder } from './recorder';
import { UKRAINIAN } from './strings-uk';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('#app not found');

const mountPoint = document.createElement('div');
const log = document.createElement('ol');
log.dataset.testid = 'edit-log';
log.className = 'chart-status';
app.append(
  Object.assign(document.createElement('h1'), { textContent: 'React editing · drag the bars' }),
  Object.assign(document.createElement('p'), {
    textContent:
      'The page owns the tasks and the links. Drag a bar to move it, its edges to resize it, the ' +
      'lower end of the done part for the progress, a circle beside a bar onto another bar for a ' +
      'link (or click both). Escape cancels a drag.',
  }),
  mountPoint,
  log,
);

/** What the chart reported: the lists the e2e specs read, and the visible log (text only). */
const recorder = createRecorder((text) => {
  log.append(Object.assign(document.createElement('li'), { textContent: text }));
});

/**
 * What the component hands the hook: the `ref` handle of the chart, the page's own tasks, and the
 * way into its state for `update`.
 */
interface Bridge {
  handle: GanttHandle | null;
  tasks: readonly Task[];
  update: ((patch: RuntimeOptions) => void) | undefined;
}
const bridge: Bridge = { handle: null, tasks: [], update: undefined };

/** The chart and the data the page owns for it. Remounted (a new `key`) by `mount`. */
function Plan({ config }: { readonly config: HarnessConfig }): ReactElement {
  const {
    tasks: initialTasks,
    links: initialLinks,
    viewMode,
    hierarchy,
    // The page is controlled; the options of the chart that this page does not take as they are.
    dataMode: _dataMode,
    today,
    width,
    ...options
  } = config;
  const [tasks, setTasks] = useState<readonly Task[]>(initialTasks ?? []);
  const [links, setLinks] = useState<readonly Link[]>(initialLinks ?? []);
  const [runtime, setRuntime] = useState<RuntimeOptions>({});
  const now = useMemo(() => (today === undefined ? undefined : () => today), [today]);
  const handle = useRef<GanttHandle | null>(null);
  // The `ref` handle: for the page itself, and for the test hook.
  const bind = useCallback((instance: GanttHandle | null): void => {
    handle.current = instance;
    bridge.handle = instance;
  }, []);

  useEffect(() => {
    bridge.update = (patch) => {
      setRuntime((current) => ({ ...current, ...patch }));
    };
    return () => {
      bridge.update = undefined;
    };
  }, []);
  useEffect(() => {
    bridge.tasks = tasks;
  }, [tasks]);

  /** Writes a change set (`onTasksChange`) or the inverse of a session (`onEditRollback`). */
  const apply = (changes: ChangeSet): void => {
    const model = handle.current?.core.getSnapshot().state.derived.model;
    if (model !== undefined) setTasks((current) => patchTasks(current, changes, model));
  };

  // `expandedKeys` is a prop of its own in React; the rest of `hierarchy` stays one object.
  const { expandedKeys, tree } = useMemo(() => {
    const { expandedKeys: keys, ...rest } = hierarchy ?? {};
    return { expandedKeys: keys, tree: rest };
  }, [hierarchy]);
  const shown = { ...options, ...runtime };
  return (
    <Gantt
      ref={bind}
      id="gantt"
      className="chart"
      style={width === undefined ? undefined : { width }}
      {...shown}
      tasks={tasks}
      links={links}
      defaultViewMode={viewMode}
      defaultExpandedKeys={expandedKeys}
      hierarchy={tree}
      now={now}
      // A prop that goes away goes back to its default: `en` has no pack.
      strings={shown.locale === 'uk' ? UKRAINIAN : undefined}
      {...recorder.handlers}
      onTasksChange={(changeSet) => {
        recorder.handlers.onTasksChange(changeSet);
        apply(changeSet);
      }}
      onLinksChange={setLinks}
      onEditRollback={(rolledBack) => {
        recorder.handlers.onEditRollback(rolledBack);
        apply(rolledBack);
        setLinks((current) => restoreLinks(current, rolledBack.links));
      }}
    />
  );
}

const root = createRoot(mountPoint);
let serial = 0;

function mount(config: HarnessConfig = {}): void {
  recorder.reset();
  log.replaceChildren();
  serial += 1;
  // A new `key` is a new chart and new data, as a new `mount` is on the vanilla page. The chart is
  // there when `mount` returns, as it is on the vanilla page.
  flushSync(() => {
    root.render(
      <StrictMode>
        <Plan key={serial} config={config} />
      </StrictMode>,
    );
  });
}

function owned(id: Task['id']): OwnedTask | undefined {
  const task = bridge.tasks.find((candidate) => candidate.id === id);
  if (task?.start === undefined || task.end === undefined) return undefined;
  return { start: String(task.start), end: String(task.end), progress: task.progress ?? 0 };
}

const harness: EditHarness = {
  renderer: 'react',
  mount,
  update: (patch) => {
    bridge.update?.(patch);
  },
  owned,
  changes: recorder.changes,
  events: recorder.events,
  get chart() {
    return bridge.handle ?? undefined;
  },
  get core() {
    return bridge.handle?.core;
  },
};
window.__ganttEdit = harness;

mount();

import.meta.hot?.dispose(() => {
  root.unmount();
  app.replaceChildren();
  delete window.__ganttEdit;
});
