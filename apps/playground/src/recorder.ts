/**
 * What a chart reported, kept for the e2e specs (`e2e/`, plan steps 4.7 and 6.1): the change sets
 * of `onTasksChange`, and the other events as short strings, both in the order they came. The
 * editing pages of the vanilla renderer (`edit.ts`) and of React (`react-edit.tsx`) hand these
 * handlers to their chart, so that one scenario reads both the same way.
 *
 * The strings of `events`:
 *
 * - `change:<reason>`: a change set came (`change:move`, `change:undo`, …), in `changes` too;
 * - `click:<id>`, `dblclick:<id>`, `linkClick:<id>`;
 * - `linkCreate:<source>><target>`, `linkDelete:<source>><target>`;
 * - `refused:<gesture>:<reason>`: an edit the chart refused;
 * - `viewMode:<id>`, `dirty:<true|false>`, `history:<canUndo>:<canRedo>`, `rollback:<tasks>`
 *   (an edit session was cancelled, with the number of tasks it changed).
 *
 * Nothing about scrolling or the range is recorded (the infinite timeline reports those all the
 * time): the specs read the core's snapshot for them.
 */
import type { ChangeSet, GanttOptions } from '@ganttlane/dom';

/** The handlers the recorder provides. */
export type RecordedHandlers = {
  readonly [
    K in
      | 'onTasksChange'
      | 'onTaskClick'
      | 'onTaskDoubleClick'
      | 'onLinkClick'
      | 'onLinkCreate'
      | 'onLinkDelete'
      | 'onEditRefused'
      | 'onViewModeChange'
      | 'onDirtyChange'
      | 'onHistoryChange'
      | 'onEditRollback'
  ]-?: NonNullable<GanttOptions[K]>;
};

/** A recording. `changes` and `events` are the very arrays the pages put on their test hook. */
export interface Recorder {
  readonly changes: ChangeSet[];
  readonly events: string[];
  /** Forgets everything recorded (a new chart is mounted). */
  reset(): void;
  readonly handlers: RecordedHandlers;
}

/**
 * Makes a recorder.
 *
 * @param onLine - Called with a line of text for every record, to show a log on the page.
 * @returns The recorder.
 */
export function createRecorder(onLine?: (text: string) => void): Recorder {
  const changes: ChangeSet[] = [];
  const events: string[] = [];
  const note = (text: string): void => {
    events.push(text);
    onLine?.(text);
  };
  const handlers: RecordedHandlers = {
    onTasksChange: (changeSet) => {
      changes.push(changeSet);
      events.push(`change:${changeSet.reason}`);
      onLine?.(
        `${changeSet.reason} ${String(changeSet.changes[0]?.id)} (${String(changeSet.changes.length)} tasks)`,
      );
    },
    onTaskClick: (record) => {
      note(`click:${String(record.id)}`);
    },
    onTaskDoubleClick: (record) => {
      note(`dblclick:${String(record.id)}`);
    },
    onLinkClick: (link) => {
      note(`linkClick:${link.id}`);
    },
    onLinkCreate: (link) => {
      note(`linkCreate:${String(link.source)}>${String(link.target)}`);
    },
    onLinkDelete: (link) => {
      note(`linkDelete:${String(link.source)}>${String(link.target)}`);
    },
    onEditRefused: ({ gesture, reason }) => {
      note(`refused:${gesture}:${reason}`);
    },
    onViewModeChange: (viewMode) => {
      note(`viewMode:${viewMode.id}`);
    },
    onDirtyChange: ({ isDirty }) => {
      note(`dirty:${String(isDirty)}`);
    },
    onHistoryChange: ({ canUndo, canRedo }) => {
      note(`history:${String(canUndo)}:${String(canRedo)}`);
    },
    onEditRollback: (rolledBack) => {
      note(`rollback:${String(rolledBack.changes.length)}`);
    },
  };
  return {
    changes,
    events,
    reset: () => {
      changes.length = 0;
      events.length = 0;
    },
    handlers,
  };
}
