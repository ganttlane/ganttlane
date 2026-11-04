import type { GanttCore } from '@ganttlane/core';

import type { Announcer } from './announce';
import { listen } from './dom-utils';

/** What the history keys need from a core. Every `GanttCore` has it. */
export type HistoryKeysCore = Pick<GanttCore, 'getSnapshot' | 'undo' | 'redo'>;

/** Options of {@link mountHistoryKeys}. */
export interface HistoryKeysOptions {
  /** The chart's core. */
  readonly core: HistoryKeysCore;
  /** `div.gantt__scroller`, which holds the bars. */
  readonly scroller: HTMLElement;
  /** Owns the listener (the instance's `AbortController`). */
  readonly signal: AbortSignal;
  /** Whether the keys undo now (`keyboard.undo`). */
  readonly enabled: () => boolean;
  /** Says what an undo or a redo did. */
  readonly announcer: Announcer;
}

/**
 * The keys of undo and redo (`keyboard.undo`): Ctrl or Cmd + Z undoes; Ctrl or Cmd + Shift + Z and
 * Ctrl + Y redo (Cmd + Y is the browser's history). Letters are read from `event.key`.
 *
 * - **Where.** Only a key pressed on the scroller itself or on a bar: an input, a `contenteditable`
 *   or a control of a slot keeps its own undo, and a focus outside the chart never gets here.
 * - **When.** Not during a gesture, and not while a change waits to be applied (a draft), or the
 *   key would cancel or contradict it.
 * - **The key.** Only a step that was taken is `preventDefault`ed: with no history, nothing to
 *   undo, or a step that could not be taken, the key stays with the browser.
 *
 * The listener is added when the option is first on, so a chart without it has none.
 *
 * @param options - See {@link HistoryKeysOptions}.
 * @returns What the renderer calls after every draw.
 */
export function mountHistoryKeys(options: HistoryKeysOptions): () => void {
  const { core, scroller, signal, enabled, announcer } = options;
  let armed = false;
  return (): void => {
    if (armed || !enabled()) return;
    armed = true;
    listen(
      scroller,
      'keydown',
      (event) => {
        const { target, key } = event;
        if (
          !enabled() ||
          event.altKey ||
          !(event.ctrlKey || event.metaKey) ||
          (target !== scroller && !(target as Partial<Element> | null)?.matches?.('.gantt__bar'))
        ) {
          return;
        }
        const letter = key.toLowerCase();
        const redo =
          letter === 'y' ? !event.metaKey && !event.shiftKey : letter === 'z' && event.shiftKey;
        if (!redo && !(letter === 'z' && !event.shiftKey)) return;
        const { feedback, state } = core.getSnapshot();
        if (feedback.phase !== 'idle' || state.draft !== undefined) return;
        const result = redo ? core.redo() : core.undo();
        if (result.status === 'undone' || result.status === 'redone') {
          announcer.reportHistory(result);
          event.preventDefault();
        }
      },
      { signal },
    );
  };
}
