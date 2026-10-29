/**
 * The React page of the playground (`/react/`), plan steps 5.2 to 5.4: a fixture debug table and
 * `<Gantt>` from `@ganttlane/react`, which is all the page uses of the library.
 *
 * - **Controlled data.** The page owns the `tasks` and `links` of the chart. `onTasksChange` writes
 *   every committed change into the page's tasks with `patchTasks`, `onLinksChange` keeps the
 *   links, and `onEditRollback` writes the inverse of a cancelled session back. The debug table
 *   shows the page's tasks, so it follows every drag.
 * - **View and edit mode.** `editing` is `false` in view mode (no drag, no session) and `true` in
 *   edit mode; leaving edit mode cancels an open session.
 * - **Save and Cancel.** "Begin editing", "Save" and "Cancel" are `edit.begin()`, `edit.commit()`
 *   and `edit.rollback()` on the `ref` handle of the chart; the panel shows `edit.getChanges()`
 *   and follows the chart's state with `useGanttState`.
 * - **Runtime options.** Theme, locale (with a Ukrainian pack of strings) and the mode are props:
 *   changing one is a `setOptions` of that option alone, no remount.
 * - **Slots.** With "React slots" (or `?slots=1`) the tooltip (opened by a click) and the bar
 *   labels are React, drawn through portals (step 5.3), in the context the page provides. The
 *   tooltip has an input that renames the task in the page's own (controlled) tasks, so that every
 *   keystroke makes the tooltip again: the input keeps the focus (the phase 5 review).
 * - **Event log.** What the chart reported, the newest on top.
 *
 * Query string (all optional): `fixture`, `mode` (`view` | `edit`, default `edit`), `theme`
 * (`auto` | `light` | `dark`), `locale` (`en` | `uk`), `slots=1`. `window.__ganttReact` is the
 * `ref` handle of the mounted chart, the hook of the e2e specs (`null` when it is unmounted).
 *
 * Nothing here reads `window` while it renders: `/react-ssr/` renders this tree on a server.
 */
import type { ThemeOption } from '@ganttlane/dom';
import type { Fixture, FixtureEntry, FixtureLink, FixtureTask } from '@ganttlane/fixtures';
import { findFixture } from '@ganttlane/fixtures';
import type {
  BarLabelContext,
  ChangeSet,
  GanttHandle,
  Link,
  Task,
  TaskId,
  TaskTooltipContext,
} from '@ganttlane/react';
import { Gantt, patchTasks, useGanttState } from '@ganttlane/react';
import type { ChangeEvent, ReactElement } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  version,
} from 'react';

import type { DebugRow } from './fixture-view';
import {
  DEBUG_COLUMNS,
  entriesOf,
  FIXTURE_GROUPS,
  readSelection,
  summarize,
  toDebugRows,
  writeSelection,
} from './fixture-view';
import { restoreLinks } from './plan-links';
import { describeChanges } from './session-view';
import { UKRAINIAN } from './strings-uk';

/** Edit mode lets the user change the plan; view mode only shows it (`editing: false`). */
export type Mode = 'view' | 'edit';
export type Locale = 'en' | 'uk';

/** The runtime options the page's controls set. */
export interface Settings {
  readonly mode: Mode;
  readonly theme: ThemeOption;
  readonly locale: Locale;
  /** Whether the tooltip and the bar labels are React (`renderTooltip`, `renderBarLabel`). */
  readonly slots: boolean;
}

const THEMES: readonly ThemeOption[] = ['auto', 'light', 'dark'];
const LOCALES: readonly Locale[] = ['en', 'uk'];
const MODES: readonly Mode[] = ['edit', 'view'];

const oneOf = <T extends string>(values: readonly T[], value: string | null, fallback: T): T =>
  values.find((candidate) => candidate === value) ?? fallback;

/**
 * The settings a query string asks for (`?mode=view&theme=dark&locale=uk&slots=1`).
 *
 * @param search - `location.search`, or `''` on a server.
 * @returns The settings; the defaults for what is absent or unknown.
 */
export function readSettings(search: string): Settings {
  const params = new URLSearchParams(search);
  return {
    mode: oneOf(MODES, params.get('mode'), 'edit'),
    theme: oneOf(THEMES, params.get('theme'), 'auto'),
    locale: oneOf(LOCALES, params.get('locale'), 'en'),
    slots: params.get('slots') === '1',
  };
}

function DebugTableRow({ row }: { row: DebugRow }): ReactElement {
  return (
    <tr data-flagged={row.flags.length > 0 ? '' : undefined}>
      {DEBUG_COLUMNS.map(({ key }) => {
        if (key === 'flags') {
          return (
            <td key={key}>
              {row.flags.map((flag) => (
                <span key={flag} className="flag">
                  {flag}
                </span>
              ))}
            </td>
          );
        }
        return (
          <td
            key={key}
            style={
              key === 'name' ? { paddingInlineStart: `${0.5 + row.depth * 1.25}rem` } : undefined
            }
          >
            {row[key]}
          </td>
        );
      })}
    </tr>
  );
}

/** A context of the page, which the slot content below reads: it is the page's, not the chart's. */
export const PageContext = createContext('page');

/**
 * The tooltip of the slots: React with a state of its own, a counter, the page's context, and an
 * input that renames the task in the page's tasks (a keystroke is a new `tasks`).
 */
function TaskCard({
  context,
  onRename,
}: {
  context: TaskTooltipContext;
  onRename: (id: TaskId, name: string) => void;
}): ReactElement {
  const page = useContext(PageContext);
  const [clicks, setClicks] = useState(0);
  return (
    <div className="react-tooltip" data-testid="react-tooltip">
      <strong data-testid="react-tooltip-title">{context.task.name}</strong>
      <input
        type="text"
        aria-label="Task name"
        data-testid="react-tooltip-rename"
        value={context.task.name}
        onChange={(event) => {
          onRename(context.task.id, event.target.value);
        }}
      />
      <button
        type="button"
        data-testid="react-tooltip-counter"
        onClick={() => {
          setClicks((count) => count + 1);
        }}
      >
        Clicked {clicks}
      </button>
      <small data-testid="react-tooltip-context">{page}</small>
    </div>
  );
}

/**
 * The label of the slots: the name with a mark, in the page's context. It counts the labels that
 * are mounted (`window.__reactLabels`), so that a test can tell a portal that was left behind.
 */
function BarLabel({ context }: { context: BarLabelContext }): ReactElement {
  const page = useContext(PageContext);
  useEffect(() => {
    const counted = window as { __reactLabels?: number };
    counted.__reactLabels = (counted.__reactLabels ?? 0) + 1;
    return () => {
      counted.__reactLabels = (counted.__reactLabels ?? 1) - 1;
    };
  }, []);
  return (
    <span className="react-label" data-page={page}>
      ★ {context.name}
    </span>
  );
}

/** One line of the event log. */
interface LogLine {
  readonly id: number;
  readonly text: string;
}

/** The newest 30 lines of what the chart reported. */
function useEventLog(): {
  readonly lines: readonly LogLine[];
  readonly note: (text: string) => void;
} {
  const [lines, setLines] = useState<readonly LogLine[]>([]);
  const count = useRef(0);
  const note = useCallback((text: string): void => {
    count.current += 1;
    const line = { id: count.current, text };
    setLines((previous) => [line, ...previous].slice(0, 30));
  }, []);
  return { lines, note };
}

interface EditControlsProps {
  readonly chart: GanttHandle;
  readonly mode: Mode;
  /** The last answer of Save or Cancel, shown while no session is open. */
  readonly result: string;
  readonly onBegin: () => void;
  readonly onClose: (how: 'commit' | 'rollback') => void;
}

/**
 * "Begin editing", "Save" and "Cancel" and the panel of `edit.getChanges()`. The session is part
 * of the chart's state (`state.session`), read with `useGanttState` from the `ref` handle, which is
 * a source of snapshots like the instance `useGantt` returns: the buttons and the panel follow
 * every change of the chart, with no state of the page's own.
 */
function EditControls({ chart, mode, result, onBegin, onClose }: EditControlsProps): ReactElement {
  const { session } = useGanttState(chart, (snapshot) => snapshot.state);
  const open = session !== undefined;
  const changes = chart.edit.getChanges();
  return (
    <>
      <p className="picker">
        <button type="button" disabled={mode !== 'edit' || open} onClick={onBegin}>
          Begin editing
        </button>
        <button
          type="button"
          disabled={!open}
          onClick={() => {
            onClose('commit');
          }}
        >
          Save
        </button>
        <button
          type="button"
          disabled={!open}
          onClick={() => {
            onClose('rollback');
          }}
        >
          Cancel
        </button>
      </p>
      <pre className="chart-status" data-testid="edit-changes">
        {changes === undefined
          ? result ||
            'No edit session. "Begin editing" opens one: Save keeps its changes, Cancel reverts them.'
          : `Editing, ${chart.edit.isDirty ? 'changed' : 'not changed yet'}:\n${describeChanges(changes)}`}
      </pre>
    </>
  );
}

interface FixtureViewProps {
  readonly entry: FixtureEntry;
  readonly settings: Settings;
  readonly onSettings: (settings: Settings) => void;
}

/**
 * Everything about one fixture: its description, the debug table of the page's tasks, the controls
 * and the chart. Keyed by the fixture, so a new fixture is a new chart and new page state.
 */
function FixtureView({ entry, settings, onSettings }: FixtureViewProps): ReactElement {
  const fixture: Fixture = useMemo(() => entry.load(), [entry]);
  // The page owns the data (controlled): the chart reports, the page applies.
  const [tasks, setTasks] = useState<readonly Task[]>(fixture.tasks);
  const [links, setLinks] = useState<readonly Link[]>(fixture.links);
  // The page's tasks are the fixture's, patched: plain data in the shape of the fixture's own types
  // (`Task` only differs from `FixtureTask` in `| undefined` on optional fields).
  const shown = useMemo(
    () => ({
      ...fixture,
      tasks: tasks as readonly FixtureTask[],
      links: links as readonly FixtureLink[],
    }),
    [fixture, tasks, links],
  );
  const rows = useMemo(() => toDebugRows(shown), [shown]);
  const [chart, setChart] = useState<GanttHandle | null>(null);
  const chartRef = useRef<GanttHandle | null>(null);
  const [result, setResult] = useState('');
  const { lines, note } = useEventLog();
  const { mode, theme, locale, slots } = settings;

  // The `ref` handle: for the page's controls, and `window.__ganttReact` for the e2e specs.
  const bind = useCallback((instance: GanttHandle | null): void => {
    chartRef.current = instance;
    (window as { __ganttReact?: GanttHandle | null }).__ganttReact = instance;
    setChart(instance);
  }, []);

  /** Writes a change set (`onTasksChange`) or the inverse of a session (`onEditRollback`). */
  const apply = (changes: ChangeSet): void => {
    const model = chartRef.current?.core.getSnapshot().state.derived.model;
    if (model !== undefined) setTasks((current) => patchTasks(current, changes, model));
  };

  /** The tooltip's input renames a task in the page's own tasks. */
  const rename = (id: TaskId, name: string): void => {
    setTasks((current) => current.map((task) => (task.id === id ? { ...task, name } : task)));
  };

  const begin = (): void => {
    const answer = chartRef.current?.edit.begin();
    setResult('');
    note(`edit.begin: ${answer?.status ?? 'no chart'}`);
  };

  const close = (how: 'commit' | 'rollback'): void => {
    const answer = chartRef.current?.edit[how]();
    if (answer === undefined) return;
    setResult(
      'changes' in answer
        ? `${how === 'commit' ? 'Saved' : 'Cancelled'}:\n${describeChanges(answer.changes)}`
        : `${how}: ${answer.status}`,
    );
    note(`edit.${how}: ${answer.status}`);
  };

  const set = (change: Partial<Settings>): void => {
    onSettings({ ...settings, ...change });
  };
  const onMode = (event: ChangeEvent<HTMLSelectElement>): void => {
    const next = oneOf(MODES, event.target.value, 'edit');
    // Leaving edit mode ends an open session, as Cancel does.
    if (next !== 'edit' && chartRef.current?.edit.isOpen === true) close('rollback');
    set({ mode: next });
  };

  const { expandedKeys, ...hierarchy } = fixture.options?.hierarchy ?? {};
  return (
    <>
      <p className="description">{fixture.description}</p>
      <p className="summary" data-testid="fixture-summary">
        {summarize(shown, rows)}
      </p>
      <div className="table-wrap">
        <table className="debug-table" data-testid="debug-table" data-fixture={entry.id}>
          <caption>Fixture {fixture.name}</caption>
          <thead>
            <tr>
              {DEBUG_COLUMNS.map(({ key, label }) => (
                <th key={key} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <DebugTableRow key={row.key} row={row} />
            ))}
          </tbody>
        </table>
      </div>
      <section className="stub">
        <h2>Renderer (@ganttlane/react)</h2>
        <p className="picker">
          <span className="control">
            <label htmlFor="mode">Mode</label>{' '}
            <select id="mode" name="mode" value={mode} onChange={onMode}>
              {MODES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </span>
          <span className="control">
            <label htmlFor="theme">Theme</label>{' '}
            <select
              id="theme"
              name="theme"
              value={theme}
              onChange={(event) => {
                set({ theme: oneOf(THEMES, event.target.value, 'auto') });
              }}
            >
              {THEMES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </span>
          <span className="control">
            <label htmlFor="locale">Locale</label>{' '}
            <select
              id="locale"
              name="locale"
              value={locale}
              onChange={(event) => {
                set({ locale: oneOf(LOCALES, event.target.value, 'en') });
              }}
            >
              {LOCALES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </span>
          <span className="control">
            <input
              id="slots"
              name="slots"
              type="checkbox"
              checked={slots}
              onChange={(event) => {
                set({ slots: event.target.checked });
              }}
            />{' '}
            <label htmlFor="slots">React slots</label>
          </span>
          <button
            type="button"
            onClick={() => {
              const last = tasks.at(-1);
              if (last !== undefined)
                chartRef.current?.scrollToTask(last.id, { behavior: 'smooth' });
            }}
          >
            Scroll to last task
          </button>
        </p>
        {chart !== null && (
          <EditControls chart={chart} mode={mode} result={result} onBegin={begin} onClose={close} />
        )}
        <Gantt
          ref={bind}
          className="chart"
          tasks={tasks}
          links={links}
          onTasksChange={(changeSet) => {
            apply(changeSet);
            note(`tasksChange: ${changeSet.reason}, ${String(changeSet.changes.length)} tasks`);
          }}
          onLinksChange={setLinks}
          onEditRollback={(changes) => {
            apply(changes);
            setLinks((current) => restoreLinks(current, changes.links));
            note(`editRollback: ${String(changes.changes.length)} tasks`);
          }}
          onDirtyChange={({ isDirty }) => {
            note(`dirtyChange: ${isDirty ? 'changed' : 'unchanged'}`);
          }}
          onEditRefused={({ gesture, reason }) => {
            note(`editRefused: ${gesture} ${reason}`);
          }}
          onIssues={({ source, issues }) => {
            note(
              `issues (${source}): ${issues.map((issue) => issue.path ?? issue.code).join(', ') || 'none'}`,
            );
          }}
          defaultExpandedKeys={expandedKeys}
          calendar={fixture.calendar}
          dates={fixture.options?.dates}
          scheduling={fixture.options?.scheduling}
          hierarchy={hierarchy}
          // The chart opens on the plan, not on today (the fixtures are dated in the past).
          scroll={{ initial: 'first-task' }}
          editing={mode === 'edit'}
          theme={theme}
          locale={locale}
          // A prop that goes away goes back to its default: `en` has no pack.
          strings={locale === 'uk' ? UKRAINIAN : undefined}
          {...(slots && {
            tooltip: { trigger: 'click' as const },
            display: { barLabel: 'outside' as const },
            renderTooltip: (context: TaskTooltipContext) => (
              <TaskCard context={context} onRename={rename} />
            ),
            renderBarLabel: (context: BarLabelContext) => <BarLabel context={context} />,
          })}
        />
        <ol className="chart-status" data-testid="react-events">
          {lines.map((line) => (
            <li key={line.id}>{line.text}</li>
          ))}
        </ol>
      </section>
    </>
  );
}

/**
 * The page: the fixture picker and the fixture's view. The picker and the settings outlive a
 * fixture; the chart, and the data the page holds for it, do not.
 *
 * @param props - `search` is the query string (`location.search`; `''` on a server).
 * @returns The page.
 */
export function App({ search }: { readonly search: string }): ReactElement {
  const [initial] = useState(() => readSelection(search));
  const [entry, setEntry] = useState<FixtureEntry>(initial.entry);
  const [unknownId, setUnknownId] = useState(initial.unknownId);
  const [settings, setSettings] = useState(() => readSettings(search));

  const onChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const next = findFixture(event.target.value);
    if (!next) return;
    setEntry(next);
    setUnknownId(undefined);
    writeSelection(next.id);
  };

  return (
    <>
      <h1>React · fixtures</h1>
      {/* The React that renders this page: the playground is built with 19 and with 18.3. */}
      <p className="description" data-testid="react-version">{`React ${version}`}</p>
      <p className="picker">
        <label htmlFor="fixture">Fixture</label>
        <select id="fixture" name="fixture" value={entry.id} onChange={onChange}>
          {FIXTURE_GROUPS.map(({ group, label }) => (
            <optgroup key={group} label={label}>
              {entriesOf(group).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </p>
      {unknownId !== undefined && (
        <p className="notice" role="status">
          Unknown fixture &quot;{unknownId}&quot;, showing {entry.id}.
        </p>
      )}
      {/* A new fixture is a new chart, as on the vanilla page. */}
      <FixtureView key={entry.id} entry={entry} settings={settings} onSettings={setSettings} />
    </>
  );
}
