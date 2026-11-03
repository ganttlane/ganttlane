import type { GanttCore, ScrollToTaskOptions, TaskId } from '@ganttlane/core';

import { type Dispose, listen } from './dom-utils';
import { modifiersOf } from './dom-utils/pointer';
import { taskIdIn } from './input';

/** What the bars' focus needs from a core. Every `GanttCore` has it. */
export type BarFocusCore = Pick<
  GanttCore,
  'getSnapshot' | 'send' | 'focusTask' | 'scrollToTask' | 'getLayoutMetrics'
>;

/** Options of {@link mountBarFocus}. */
export interface BarFocusOptions {
  /** The chart's core. */
  readonly core: BarFocusCore;
  /** `div.gantt__scroller`, which holds the bars. */
  readonly scroller: HTMLElement;
  /** Owns the listeners (the instance's `AbortController`). */
  readonly signal: AbortSignal;
  /** Whether bars take the focus now (`keyboard.barFocus`). */
  readonly enabled: () => boolean;
  /** Draws what the core has now. */
  readonly flush: () => void;
}

/** The bars' focus of one renderer, see {@link mountBarFocus}. */
export interface BarFocus {
  /** Moves the browser's focus to the bar of a task and scrolls to it. */
  readonly focus: (id: TaskId) => void;
  /** Call it after every draw: the focus follows `snapshot.focusedTask`, and a bar that went away. */
  sync(): void;
  /** Lets go of the focused task, if a bar had it. */
  readonly dispose: Dispose;
}

/** The least scroll that shows a bar, at once: a key press is answered in that frame. */
const NEAREST: ScrollToTaskOptions = {
  align: 'nearest',
  alignY: 'nearest',
  behavior: 'instant',
  expand: false,
};

/**
 * The keyboard focus of the bars (`keyboard.barFocus`): a roving tabindex, one bar of the chart can
 * be tabbed to, and the keys walk from it. The bars layer draws `tabindex` and keeps the focused bar
 * in the document; this is the behaviour.
 *
 * - **Focus.** A bar with the browser's focus, however it got it, is `focusTask`. A press focuses a
 *   bar by itself, also with the pointer captured on the scroller, and shows no ring. A `focusTask`
 *   from elsewhere moves the focus only while a bar has it: the surface that holds the focus keeps
 *   it, so a list beside the chart and the bars share one focused task and do not take it from each
 *   other. `focus` is how to move it onto a bar from anywhere.
 * - **A bar that goes away.** Firefox and WebKit send no `focusout` for an element that leaves the
 *   document, so `sync` looks at where the focus is now, and hands it to the tab stop.
 * - **Scrolling.** Firefox does not scroll to an SVG group that takes the focus, and the others do it
 *   their own way, so a move never lets the browser scroll: it is always `preventScroll` and
 *   `scrollToTask`.
 * - **Keys,** on the bar itself and only while no gesture runs: Up and Down go to the bar of the row
 *   above and below (a row without one is skipped), Home and End to the first and last, Page Up and
 *   Page Down a page of rows. Enter and Space are a click (`ClickInput`, modifiers included). Left and
 *   Right stay the scroller's.
 *
 * The listeners are added when the option is first on, so a chart without it has none.
 *
 * @param options - See {@link BarFocusOptions}.
 * @returns What the renderer calls.
 */
export function mountBarFocus(options: BarFocusOptions): BarFocus {
  const { core, scroller, signal, enabled, flush } = options;
  const taskId = taskIdIn(core);
  /** Whether a bar had the browser's focus when last looked at. */
  let held = false;
  let armed = false;

  /** The bar of this chart a node is in. */
  const barOf = (node: EventTarget | null | undefined): SVGElement | null => {
    const bar = (node as Partial<Element> | null | undefined)?.closest?.<SVGElement>('.gantt__bar');
    return bar && scroller.contains(bar) ? bar : null;
  };
  /** The task of a bar or a row, when it is one of this chart's. */
  const idOf = (node: Element | null | undefined): TaskId | undefined =>
    taskId(node?.getAttribute('data-task-id') ?? '');
  const give = (bar: SVGElement | null | undefined): void => {
    bar?.focus({ preventScroll: true });
  };
  const place = (id: TaskId): void => {
    give(
      [...scroller.querySelectorAll<SVGElement>('.gantt__bar')].find(
        (bar) => bar.getAttribute('data-task-id') === String(id),
      ),
    );
    core.scrollToTask(id, NEAREST);
  };
  const release = (): void => {
    if (held) core.focusTask(undefined);
    held = false;
  };

  const focus = (id: TaskId): void => {
    if (!enabled() || core.getSnapshot().layout.getBarRect(id) === undefined) return;
    core.focusTask(id);
    // Drawn now, wherever it is: only a bar in the document can take the focus.
    flush();
    place(id);
    flush();
  };

  /** Hears what happens on a bar, while bars take the focus. */
  const on = <K extends 'focusin' | 'focusout' | 'keydown'>(
    type: K,
    handle: (event: HTMLElementEventMap[K], bar: SVGElement, id: TaskId) => void,
  ): void => {
    listen(
      scroller,
      type,
      (event) => {
        const bar = barOf(event.target);
        const id = idOf(bar);
        if (enabled() && bar !== null && id !== undefined) handle(event, bar, id);
      },
      { signal },
    );
  };

  const arm = (): void => {
    armed = true;
    on('focusin', (_event, bar, id) => {
      held = true;
      core.focusTask(id);
      // Tabbed to: it may be out of view (the task of a focused row in a list beside the chart).
      if (bar.matches(':focus-visible')) core.scrollToTask(id, NEAREST);
    });
    on('focusout', (event, _bar, id) => {
      const { focusedTask, layout } = core.getSnapshot();
      // Its bar is going away: `sync` hands the focus on.
      if (layout.getBarRect(id) === undefined) return;
      held = false;
      // A bar or a row of the same tasks takes it: that says so itself, with no gap between.
      const next = (event.relatedTarget as Partial<Element> | null)?.closest?.(
        '.gantt__bar,[data-row]',
      );
      if (focusedTask === id && idOf(next) === undefined) core.focusTask(undefined);
    });
    on('keydown', (event, bar, id) => {
      const { feedback, layout } = core.getSnapshot();
      // Keys typed into something drawn in a label are that thing's.
      if (event.target !== bar || feedback.phase !== 'idle') return;
      const { key } = event;
      if (key === 'Enter' || key === ' ') {
        if (!event.repeat) {
          const target = { kind: 'task', id, part: 'body' } as const;
          core.send({ type: 'click', target, modifiers: modifiersOf(event), event });
        }
      } else {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const index = layout.rows.rowOf(id)?.index ?? 0;
        const last = layout.rows.rows.length - 1;
        const { viewportHeight, headerHeight, rowHeight } = core.getLayoutMetrics();
        const page = Math.max(Math.floor((viewportHeight - headerHeight) / rowHeight) - 1, 1);
        // The row to look from, and the way to look: Page keys look back towards this bar.
        const moves: Readonly<Record<string, readonly [number, number]>> = {
          ArrowDown: [index + 1, 1],
          ArrowUp: [index - 1, -1],
          Home: [0, 1],
          End: [last, -1],
          PageDown: [Math.min(index + page, last), -1],
          PageUp: [Math.max(index - page, 0), 1],
        };
        const move = moves[key];
        if (move === undefined) return;
        for (let at = move[0]; at >= 0 && at <= last; at += move[1]) {
          const next = layout.barAt(at);
          if (next !== undefined) {
            focus(next.id);
            break;
          }
        }
      }
      // The arrows and Space would scroll the box otherwise.
      event.preventDefault();
    });
  };

  return {
    focus,
    sync(): void {
      if (!enabled()) {
        release();
        return;
      }
      if (!armed) arm();
      const active = (scroller.getRootNode() as Partial<DocumentOrShadowRoot>).activeElement;
      const bar = barOf(active);
      const { focusedTask } = core.getSnapshot();
      if (bar !== null) {
        if (focusedTask !== undefined && idOf(bar) !== focusedTask) place(focusedTask);
      } else if (held && (active === null || active === scroller.ownerDocument.body)) {
        give(scroller.querySelector<SVGElement>('.gantt__bar[tabindex="0"]'));
      } else {
        held = false;
      }
    },
    dispose: release,
  };
}
