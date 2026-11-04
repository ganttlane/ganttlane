/**
 * The plan and the settings of the task list pages (`/task-list/`, `/react-task-list/`): one set
 * of query parameters and one set of tasks, so that one e2e spec (`e2e/task-list.spec.ts`) runs on
 * both renderers.
 *
 * - `height`: `fixed` (default, the chart scrolls itself) or `auto` (one box scrolls both);
 * - `tasks`: how many tasks, in groups of ten (default 60);
 * - `theme`: the chart's theme (default `light`);
 * - `list=0`: the chart alone, to compare;
 * - `barFocus=1`: bars take the keyboard focus (`keyboard.barFocus`);
 * - `multiple=1`: Ctrl or Cmd adds to the selection (`selection.multiple`);
 * - `edit=1`: the arrow keys edit the focused bar (`keyboard.edit`, with `barFocus=1`);
 * - `undo=1`: history is on and the undo keys work (`history`, `keyboard.undo`);
 * - `announce=1`: the selection is said in a live region (`keyboard.announce`);
 * - `cells=1`: the keys walk the cells of the list (`cellNavigation`).
 */
import type { GanttRow, Task } from '@ganttlane/dom';

/** What the query string asks for. */
export interface PlanSettings {
  readonly height: 'fixed' | 'auto';
  readonly count: number;
  readonly theme: 'light' | 'dark';
  readonly list: boolean;
  readonly barFocus: boolean;
  readonly multiple: boolean;
  readonly edit: boolean;
  readonly announce: boolean;
  readonly undo: boolean;
  readonly cells: boolean;
}

/** The height of the chart when it scrolls itself, and of the box when that scrolls both. */
export const PLAN_HEIGHT = 400;

/**
 * Reads the settings of the page.
 *
 * @param search - `location.search`.
 * @returns The settings.
 */
export function planSettings(search: string): PlanSettings {
  const params = new URLSearchParams(search);
  return {
    height: params.get('height') === 'auto' ? 'auto' : 'fixed',
    count: Number(params.get('tasks') ?? 60),
    theme: params.get('theme') === 'dark' ? 'dark' : 'light',
    list: params.get('list') !== '0',
    barFocus: params.get('barFocus') === '1',
    multiple: params.get('multiple') === '1',
    edit: params.get('edit') === '1',
    announce: params.get('announce') === '1',
    undo: params.get('undo') === '1',
    cells: params.get('cells') === '1',
  };
}

const DAY = 24 * 60 * 60 * 1000;
const day = (index: number): string =>
  new Date(Date.UTC(2026, 2, 2) + index * DAY).toISOString().slice(0, 10);

/**
 * A plan of `count` tasks: a group and nine tasks in it, again and again, each a few days after the
 * one before, so that the last bar is many screens away from the first, on both axes.
 *
 * @param count - How many tasks.
 * @returns The tasks; ids are `t0`, `t1`, …, and a group is every tenth.
 */
export function planTasks(count: number): Task[] {
  return Array.from({ length: count }, (_, index) => {
    const group = index - (index % 10);
    const start = index * 3;
    return {
      id: `t${String(index)}`,
      name: index === group ? `Group ${String(index / 10)}` : `Task ${String(index)}`,
      start: day(start),
      end: day(start + (index === group ? 27 : 3)),
      progress: index % 100,
      ...(index === group ? {} : { parentId: `t${String(group)}` }),
    };
  });
}

/** The dates of a row, as the Dates column shows them: what a drag is seen to change. */
export function datesOf({ record: { start } }: GanttRow): string {
  // The dates of a record have the task's own wall clock, so they are read as local.
  if (start === undefined) return '';
  const two = (value: number): string => String(value).padStart(2, '0');
  return `${two(start.getMonth() + 1)}-${two(start.getDate())}`;
}

/** The columns of the list. */
export const planColumns = [
  { id: 'name', header: 'Task' },
  { id: 'dates', header: 'Start', width: 70, align: 'end', value: datesOf },
] as const;

/** The options of the chart, for a height. */
export const planOptions = {
  viewMode: 'day',
  calendar: { weekends: [] },
  selection: { onClick: true, clearOnEmptyClick: true },
  timeline: { padding: '0d' },
  scroll: { initial: 'start', behavior: 'instant' },
  now: (): string => '2026-03-02',
} as const;

/** The options of the chart that follow the settings of the page. */
export const planChoices = ({
  barFocus,
  edit,
  announce,
  undo,
  multiple,
}: PlanSettings): {
  readonly keyboard: object;
  readonly selection: object;
  readonly history: boolean;
} => ({
  keyboard: { barFocus, edit, announce, undo },
  history: undo,
  selection: { ...planOptions.selection, multiple },
});

/** The sizes of the chart, for a height. */
export const planLayout = (height: PlanSettings['height']): object => ({
  rowHeight: 36,
  barHeight: 22,
  headerRowHeight: 28,
  height: height === 'auto' ? 'auto' : PLAN_HEIGHT,
});
