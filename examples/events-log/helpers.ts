import type { GanttOptions } from '@ganttlane/dom';

/** The kinds of event the filter shows and hides. */
export type GroupId =
  | 'pointer'
  | 'hover'
  | 'changes'
  | 'links'
  | 'view'
  | 'scroll'
  | 'selection'
  | 'refused'
  | 'issues'
  | 'edit';

/** The groups of the filter, with what is in each; a group that is `hidden` starts unchecked. */
export const GROUPS: readonly { id: GroupId; label: string; hidden?: boolean }[] = [
  { id: 'pointer', label: 'Clicks' },
  { id: 'hover', label: 'Hover', hidden: true },
  { id: 'changes', label: 'Changes' },
  { id: 'links', label: 'Links' },
  { id: 'view', label: 'View and range' },
  { id: 'scroll', label: 'Scroll' },
  { id: 'selection', label: 'Selection' },
  { id: 'refused', label: 'Refused' },
  { id: 'issues', label: 'Issues and errors' },
  { id: 'edit', label: 'Dirty and history' },
];

/** A line of the log. */
export interface Entry {
  /** Grows with every entry. */
  readonly id: number;
  /** The time it was logged, `12:03:04.123`. */
  readonly time: string;
  readonly group: GroupId;
  /** The name of the event, `taskClick`. */
  readonly name: string;
  /** What the event carried. */
  readonly text: string;
  /** How many events of this name it stands for: a run of `scroll` events is one line. */
  readonly count: number;
}

/** The log: every event of the chart calls this. */
export type Log = (group: GroupId, name: string, text: string) => void;

/** The most lines the log keeps; the oldest go first. */
const KEEP = 200;

const pad = (value: number, length = 2): string => String(value).padStart(length, '0');

/** A time of day with milliseconds, in the visitor's time zone. */
function clock(date: Date): string {
  const [h, m, s] = [date.getHours(), date.getMinutes(), date.getSeconds()].map((n) => pad(n));
  return `${h ?? ''}:${m ?? ''}:${s ?? ''}.${pad(date.getMilliseconds(), 3)}`;
}

/**
 * The log with one more event, newest first. A `scroll` that follows a `scroll` takes the place of
 * it (the line counts them), since one drag of a scrollbar is a hundred events.
 *
 * @param entries - The log so far.
 * @param group - The group of the event.
 * @param name - The name of the event.
 * @param text - What the event carried.
 * @returns A new list.
 */
export function append(
  entries: readonly Entry[],
  group: GroupId,
  name: string,
  text: string,
): Entry[] {
  const [last, ...older] = entries;
  const time = clock(new Date());
  if (last?.name === 'scroll' && name === 'scroll') {
    return [{ ...last, time, text, count: last.count + 1 }, ...older];
  }
  const entry: Entry = { id: (last?.id ?? 0) + 1, time, group, name, text, count: 1 };
  return [entry, ...entries].slice(0, KEEP);
}

/** What a line of the log says: the text of the event, and how many of them it stands for. */
export const lineText = ({ text, count }: Entry): string =>
  count > 1 ? `${text} (×${count})` : text;

/** A date as `2026-03-16`. */
const day = (date: Date): string => date.toLocaleDateString('en-CA');

/**
 * A handler for every event of a chart, each of which says what it carried. They are the
 * `on<Event>` options, and `gantt.on(name, handler)` takes the same functions.
 *
 * @param log - Where the lines go.
 * @returns The handlers: spread them into the options of the chart.
 */
export function loggingHandlers(log: Log) {
  return {
    // ---- pointer ----
    onTaskClick: (record) => {
      log('pointer', 'taskClick', record.name);
    },
    onTaskDoubleClick: (record) => {
      log('pointer', 'taskDoubleClick', record.name);
    },
    onLinkClick: (link) => {
      log('pointer', 'linkClick', link.id);
    },
    onTaskHoverChange: (record) => {
      log('hover', 'taskHoverChange', record === null ? 'the pointer left the bars' : record.name);
    },

    // ---- changes: one `tasksChange` for the action, then one convenience event per task ----
    onTasksChange: (changeSet) => {
      const ids = changeSet.changes.map((change) => String(change.id)).join(', ');
      log('changes', 'tasksChange', `${changeSet.reason}: ${ids}`);
    },
    onTaskDatesChange: (record, dates) => {
      log('changes', 'taskDatesChange', `${record.name}: ${day(dates.start)} to ${day(dates.end)}`);
    },
    onTaskProgressChange: (record, progress) => {
      log('changes', 'taskProgressChange', `${record.name}: ${Math.round(progress)}%`);
    },

    // ---- links ----
    onLinkCreate: (_link, id) => {
      log('links', 'linkCreate', id);
    },
    onLinkDelete: (link) => {
      log('links', 'linkDelete', link.id);
    },

    // ---- view, range, rows ----
    onViewModeChange: (viewMode) => {
      log('view', 'viewModeChange', viewMode.id);
    },
    onRangeChange: ({ start, end, reason }) => {
      log('view', 'rangeChange', `${reason}: ${day(start)} to ${day(end)}`);
    },
    onExpandedChange: (expandedKeys) => {
      log(
        'view',
        'expandedChange',
        expandedKeys === 'all' ? 'all' : `[${expandedKeys.join(', ')}]`,
      );
    },
    onScroll: ({ x, y, date }) => {
      log('scroll', 'scroll', `x ${Math.round(x)}, y ${Math.round(y)}, left edge ${day(date)}`);
    },

    // ---- selection ----
    onSelectionChange: (selectedKeys, selectedLink) => {
      log(
        'selection',
        'selectionChange',
        `tasks [${selectedKeys.join(', ')}], link ${selectedLink ?? 'none'}`,
      );
    },

    // ---- refusals, problems, errors ----
    onEditRefused: ({ gesture, id, target, reason, at }) => {
      const to = target === undefined ? '' : ` to ${String(target)}`;
      log('refused', 'editRefused', `${gesture} ${String(id)}${to}: ${reason}, at ${at}`);
    },
    onIssues: ({ source, issues }) => {
      log(
        'issues',
        'issues',
        `${source}: ${issues.map((issue) => issue.code).join(', ') || 'none'}`,
      );
    },
    onError: ({ error, source, name }) => {
      const message = error instanceof Error ? error.message : String(error);
      log('issues', 'error', `a ${source} (${name}) threw: ${message}`);
    },

    // ---- edit session and history ----
    onDirtyChange: ({ isDirty }) => {
      log('edit', 'dirtyChange', `isDirty ${String(isDirty)}`);
    },
    onEditRollback: ({ changes, links }) => {
      const text = `${changes.length} tasks, links +${links.added.length} −${links.removed.length}`;
      log('edit', 'editRollback', text);
    },
    onHistoryChange: ({ canUndo, canRedo }) => {
      log('edit', 'historyChange', `canUndo ${String(canUndo)}, canRedo ${String(canRedo)}`);
    },
  } satisfies Partial<GanttOptions>;
}
