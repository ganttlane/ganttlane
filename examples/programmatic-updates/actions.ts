import type {
  Change,
  ChangeSet,
  Gantt,
  IssuesPayload,
  TaskPatch,
  UpdateTaskResult,
} from '@ganttlane/dom';

import { review } from './data';

/** The methods of the chart that the buttons call: a `Gantt` of `createGantt`, or a React handle. */
export type Chart = Pick<
  Gantt,
  'updateTask' | 'addLink' | 'removeLink' | 'setTasks' | 'getIssues' | 'core'
>;

/** What `addLink` and `removeLink` resolve to (their result types are not exported by name). */
type LinkResult = Awaited<ReturnType<Gantt['addLink']>> | Awaited<ReturnType<Gantt['removeLink']>>;

/** A button: a call of the chart, and the text of what it returned. */
export interface Action {
  /** The row of buttons it belongs to. */
  readonly group: string;
  readonly label: string;
  /** Makes the call; resolves to the call and its result, as text. */
  readonly run: (chart: Chart) => Promise<string>;
}

const DAY = 24 * 60 * 60 * 1000;

/** A floating time as the day it falls on, `2026-03-16`. */
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** A task's dates the way a task is written: the first and the last day. */
function span(patch: TaskPatch): string {
  const last = patch.endExclusive > patch.start ? patch.endExclusive - DAY : patch.start;
  return `${dayOf(patch.start)} to ${dayOf(last)}`;
}

/** One change of a change set, as a line: who, why, the dates and the progress when it changed. */
function changeLine({ id, cause, before, after }: Change): string {
  const progress =
    before.progress === after.progress ? '' : `, ${before.progress}% → ${after.progress}%`;
  return `${String(id)} (${cause}): ${span(before)} → ${span(after)}${progress}`;
}

/** What a result holds, shortened to what is worth reading (a result has more than this). */
function plain(result: UpdateTaskResult | LinkResult): unknown {
  const codes = (issues: readonly { code: string; path?: string | undefined }[] | undefined) =>
    issues?.map(({ code, path }) => (path === undefined ? code : `${code} (${path})`));
  switch (result.status) {
    case 'committed':
      return {
        status: result.status,
        // `changeSet.changes`: the task asked for, and what its links and children moved.
        changes: result.changeSet.changes.map(changeLine),
      };
    case 'unchanged':
      return { status: result.status, issues: codes(result.issues) };
    case 'rejected':
      return { status: result.status, reason: result.reason, issues: codes(result.issues) };
    case 'cancelled':
      return { status: result.status, reason: result.reason };
    case 'created':
      return { status: result.status, id: result.id, link: result.link };
    case 'deleted':
      return { status: result.status, id: result.id };
    case 'busy':
      return { status: result.status };
  }
}

/** The text of a call and what it resolved to. */
async function call(text: string, result: Promise<UpdateTaskResult | LinkResult>): Promise<string> {
  return `await gantt.${text}\n→ ${JSON.stringify(plain(await result), null, 2)}`;
}

/** What the buttons do, in the order they are shown. */
export const ACTIONS: readonly Action[] = [
  // ---- `updateTask`: a change from code, as a drag would make it ----
  {
    group: 'updateTask',
    label: 'Move Build',
    // `start` alone moves the task and keeps its length; successors follow, as in a drag.
    run: (chart) =>
      call(
        `updateTask('build', { start: '2026-03-23' })`,
        chart.updateTask('build', { start: '2026-03-23' }),
      ),
  },
  {
    group: 'updateTask',
    label: 'Resize Build',
    // `end` alone moves the end edge. A date-only `end` is the last day, as in the data.
    run: (chart) =>
      call(
        `updateTask('build', { end: '2026-03-26' })`,
        chart.updateTask('build', { end: '2026-03-26' }),
      ),
  },
  {
    group: 'updateTask',
    label: 'Reschedule Docs',
    // Both: the task gets exactly these dates.
    run: (chart) =>
      call(
        `updateTask('docs', { start: '2026-03-19', end: '2026-03-23' })`,
        chart.updateTask('docs', { start: '2026-03-19', end: '2026-03-23' }),
      ),
  },
  {
    group: 'updateTask',
    label: 'Build to 75%',
    run: (chart) =>
      call(`updateTask('build', { progress: 75 })`, chart.updateTask('build', { progress: 75 })),
  },

  // ---- the answers that are not `committed` ----
  {
    group: 'Not committed',
    label: 'Locked task',
    // `unchanged`: nothing to commit. A locked task is not changed from code either.
    run: (chart) =>
      call(
        `updateTask('discovery', { progress: 50 })`,
        chart.updateTask('discovery', { progress: 50 }),
      ),
  },
  {
    group: 'Not committed',
    label: 'End before start',
    // `rejected`: a value is unusable, and `issues` says which.
    run: (chart) =>
      call(
        `updateTask('design', { end: '2026-03-01' })`,
        chart.updateTask('design', { end: '2026-03-01' }),
      ),
  },
  {
    group: 'Not committed',
    label: 'Unknown task',
    // `rejected` again: the task has no bar to change.
    run: (chart) =>
      call(`updateTask('nope', { progress: 10 })`, chart.updateTask('nope', { progress: 10 })),
  },
  {
    group: 'Not committed',
    label: 'Past the freeze',
    // `cancelled`: `onBeforeTaskChange` said no (it runs for `updateTask` like for a drag).
    run: (chart) =>
      call(
        `updateTask('qa', { start: '2026-05-04' })`,
        chart.updateTask('qa', { start: '2026-05-04' }),
      ),
  },

  // ---- links and tasks ----
  {
    group: 'Links',
    label: 'addLink Docs → QA',
    // `created`, or `rejected` with a reason: `duplicate`, `cycle`, `unknown-task`, `invalid`.
    run: (chart) =>
      call(
        `addLink({ source: 'docs', target: 'qa' })`,
        chart.addLink({ source: 'docs', target: 'qa' }),
      ),
  },
  {
    group: 'Links',
    label: 'addLink QA → Design',
    // Design leads to QA, so this one would close a cycle: `rejected`.
    run: (chart) =>
      call(
        `addLink({ source: 'qa', target: 'design' })`,
        chart.addLink({ source: 'qa', target: 'design' }),
      ),
  },
  {
    group: 'Links',
    label: 'removeLink Docs → QA',
    // A link has the id `source:type:target` unless it has an `id`. `deleted`, or `rejected`.
    run: (chart) => call(`removeLink('docs:FS:qa')`, chart.removeLink('docs:FS:qa')),
  },
  {
    group: 'setTasks',
    label: 'Add Review',
    // `setTasks` answers nothing: it replaces the tasks, and the chart finds what changed by id.
    // Start from the chart's own tasks, which hold what the user dragged.
    run: (chart) => Promise.resolve(replaceTasks(chart, true)),
  },
  {
    group: 'setTasks',
    label: 'Remove Review',
    run: (chart) => Promise.resolve(replaceTasks(chart, false)),
  },
];

function replaceTasks(chart: Chart, add: boolean): string {
  const current = chart.core.getSnapshot().state.tasks;
  const without = current.filter((task) => task.id !== review.id);
  const next = add ? [...without, review] : without;
  chart.setTasks(next);
  const issues = chart.getIssues().data;
  return [
    `gantt.setTasks(${add ? '[...tasks, review]' : 'tasks.filter((task) => task.id !== review.id)'})`,
    `→ undefined, and now there are ${next.length} tasks`,
    `gantt.getIssues().data → ${issues.length === 0 ? '[]' : issues.map(({ code }) => code).join(', ')}`,
  ].join('\n');
}

/** A line for the status: what `onTasksChange` reported. */
export function changeText({ reason, changes }: ChangeSet): string {
  return `onTasksChange (${reason}): ${changes.map((change) => String(change.id)).join(', ')}`;
}

/** A line for the status: what `onIssues` reported. */
export function issuesText({ source, issues }: IssuesPayload): string {
  return `onIssues (${source}): ${issues.map((issue) => issue.code).join(', ') || 'none'}`;
}
