import type {
  GanttCore,
  HistoryResult,
  NudgeResult,
  TaskId,
  TaskPatch,
  TaskRecord,
} from '@ganttlane/core';

import { createHtml, previewOf, taskSummary } from './shared';
import type { GanttStrings } from './strings';

/** Told apart from the same text; spoken as nothing. */
const NO_BREAK_SPACE = String.fromCodePoint(0xa0);

/** What the announcements need from a core. Every `GanttCore` has it. */
export type AnnouncerCore = Pick<GanttCore, 'getSnapshot' | 'getTask'>;

/** Options of {@link mountAnnouncer}. */
export interface AnnouncerOptions {
  /** The chart's core. */
  readonly core: AnnouncerCore;
  /** `div.gantt`, which holds the live region. */
  readonly root: HTMLElement;
  /** Owns the region (the instance's `AbortController`). */
  readonly signal: AbortSignal;
  /** Whether there is a region now: something that can speak (`keyboard.announce`, `keyboard.edit`). */
  readonly enabled: () => boolean;
  /** Whether the selection is said now (`keyboard.announce`). */
  readonly selection: () => boolean;
  /** The chart's strings now. */
  readonly strings: () => GanttStrings;
  /** Whether a press on a bar selects it, and the bar says so itself (`aria-pressed`). */
  readonly pressed: () => boolean;
}

/** The live region of one renderer, see {@link mountAnnouncer}. */
export interface Announcer {
  /** Call it after every draw: the region follows the option, and the selection is announced. */
  sync(): void;
  /** Says what became of a keyboard change of a task. */
  report(id: TaskId, result: NudgeResult): void;
  /** Says what an undo or a redo did. */
  reportHistory(result: HistoryResult): void;
}

/**
 * The chart's live region (`role="status"`, polite, read whole), a visually hidden `div` that is in
 * the document while the chart announces, since a region that is added together with its text is
 * not always read. A message is the text of the region; one that repeats the last is told apart
 * with a no-break space, or it would not change the text and would not be read again.
 *
 * - **Keyboard changes** (`report`): the task described by its name, its new dates, its progress
 *   and its working days, from the change set, so that the words are right also for controlled
 *   data that the owner has not applied yet, and the number of other tasks the change moved. A
 *   change that left the task as it was says so. A pending operation says nothing: the key has
 *   done nothing.
 * - **Selection** (`sync`): a change of the selected tasks is announced, unless the focus is on a
 *   bar that says it is pressed, which a screen reader reads from the bar itself. So a selection
 *   made by `select()` or from a task list is announced also where a click does not select.
 *
 * @param options - See {@link AnnouncerOptions}.
 * @returns What the renderer calls.
 */
export function mountAnnouncer(options: AnnouncerOptions): Announcer {
  const { core, root, signal, enabled, selection, strings, pressed } = options;
  let region: HTMLElement | undefined;
  let last = '';
  let selected: readonly TaskId[] | undefined;

  const say = (text: string): void => {
    if (region === undefined) return;
    last = text === last ? text + NO_BREAK_SPACE : text;
    region.textContent = last;
  };
  const locale = (): string => core.getSnapshot().header.locale;
  /** The task as a change leaves it, in words. */
  const describe = (task: TaskRecord, patch: TaskPatch): string =>
    taskSummary(
      task,
      locale(),
      strings(),
      patch.progress,
      previewOf(core.getSnapshot(), task, patch),
    );

  signal.addEventListener('abort', () => {
    region?.remove();
    region = undefined;
  });

  return {
    sync(): void {
      if (!enabled()) {
        region?.remove();
        region = undefined;
        selected = undefined;
        return;
      }
      const { tasks } = core.getSnapshot().selection;
      if (region === undefined) {
        region = createHtml(root.ownerDocument, 'div', { class: 'gantt__live', role: 'status' });
        root.append(region);
        selected = tasks;
      }
      const before = selected;
      selected = tasks;
      if (before === undefined || tasks === before || !selection()) return;
      // A press on the bar that says it is pressed is told by the bar. Any other change is news,
      // also one that unpresses that bar.
      const changed = new Set(
        [
          ...before.filter((id) => !tasks.includes(id)),
          ...tasks.filter((id) => !before.includes(id)),
        ].map(String),
      );
      const active = (root.getRootNode() as Partial<DocumentOrShadowRoot>).activeElement;
      const bar = pressed() ? (active?.closest('.gantt__bar[aria-pressed]') ?? null) : null;
      if (changed.size === 1 && changed.has(bar?.getAttribute('data-task-id') ?? '')) return;
      const name = tasks[0] === undefined ? '' : (core.getTask(tasks[0])?.name ?? '');
      say(strings().selection(tasks.length, name === '' ? String(tasks[0]) : name, locale()));
    },
    report(id, result): void {
      const task = core.getTask(id);
      if (result.status === 'busy' || task === undefined) return;
      const words = strings();
      const where = locale();
      const change =
        result.status === 'committed'
          ? result.changeSet.changes.find((c) => c.id === id)
          : undefined;
      if (result.status !== 'committed' || change === undefined) {
        say(words.notChanged(task.name === '' ? String(id) : task.name, where));
        return;
      }
      say(
        words.taskChanged(describe(task, change.after), result.changeSet.changes.length - 1, where),
      );
    },
    reportHistory(result): void {
      if (result.status !== 'undone' && result.status !== 'redone') return;
      const { entry } = result;
      // The first task the entry moved, as the step left it; a link has nothing to describe.
      const change = entry.type === 'tasks' ? entry.changeSet.changes[0] : undefined;
      const task = change && core.getTask(change.id);
      const detail =
        change && task
          ? strings().taskChanged(
              describe(task, result.status === 'undone' ? change.before : change.after),
              entry.type === 'tasks' ? entry.changeSet.changes.length - 1 : 0,
              locale(),
            )
          : '';
      say(strings()[result.status === 'undone' ? 'undone' : 'redone'](detail, locale()));
    },
  };
}
