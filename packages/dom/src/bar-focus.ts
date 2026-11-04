import {
  type GanttCore,
  type NudgeGesture,
  resolvePermissions,
  type ScrollToTaskOptions,
  type TaskId,
} from '@ganttlane/core';

import type { Announcer } from './announce';
import { type Dispose, listen } from './dom-utils';
import { modifiersOf } from './dom-utils/pointer';
import { taskIdIn } from './input';

/** What the bars' focus needs from a core. Every `GanttCore` has it. */
export type BarFocusCore = Pick<
  GanttCore,
  'getSnapshot' | 'send' | 'focusTask' | 'scrollToTask' | 'getLayoutMetrics' | 'nudge' | 'on'
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
  /** Whether the arrow keys edit a bar now (`keyboard.edit`). */
  readonly edit: () => boolean;
  /** Says what became of a keyboard change. */
  readonly announcer: Announcer;
}

/** The bars' focus of one renderer, see {@link mountBarFocus}. */
export interface BarFocus {
  /** Moves the browser's focus to the bar of a task and scrolls to it. */
  readonly focus: (id: TaskId) => void;
  /**
   * Call it before every draw: a bar with the browser's focus is the focused task, also after a
   * `focusTask(undefined)`, or it would not be kept in the document.
   */
  claim(): void;
  /**
   * Draws, and then the focus follows `snapshot.focusedTask`, and a bar that went away or was moved:
   * a browser may take the focus from a node that is moved or removed.
   *
   * @param draw - Draws the layers; does not throw.
   */
  draw(draw: () => void): void;
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
 * - **Focus.** A bar with the browser's focus, however it got it, is `focusTask`, and takes that back
 *   at the next draw from a `focusTask(undefined)`, which does not move the focus. A press focuses a
 *   bar by itself, also with the pointer captured on the scroller, and shows no ring. A `focusTask`
 *   from elsewhere moves the focus only while a bar has it: the surface that holds the focus keeps
 *   it, so a list beside the chart and the bars share one focused task and do not take it from each
 *   other. `focus` is how to move it onto a bar from anywhere.
 * - **A bar that goes away or is moved.** Firefox and WebKit send no `focusout` for an element that
 *   leaves the document, and Chromium sends one that looks like any other, also for a node that only
 *   moves when rows are sorted. So what happens during a draw says nothing, and the end of the draw
 *   looks at where the focus is now, and hands it to the tab stop, which is that same bar if it is
 *   still there.
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
  const { core, scroller, signal, enabled, flush, edit, announcer } = options;
  const taskId = taskIdIn(core);
  /** Whether a bar had the browser's focus when last looked at. */
  let held = false;
  let armed = false;
  /** Whether the layers are drawing: a bar that loses the focus now is being moved or removed. */
  let drawing = false;
  /** Whether the task was told to let go of the focus while a bar had it. */
  let letGo = false;

  const activeElement = (): Element | null | undefined =>
    (scroller.getRootNode() as Partial<DocumentOrShadowRoot>).activeElement;
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

  /** Moves a task one step from the keyboard, says how it went and keeps the bar in view. */
  const nudge = (id: TaskId, gesture: NudgeGesture, direction: -1 | 1): void => {
    void core.nudge(id, gesture, direction).then((result) => {
      if (result.status === 'committed') core.scrollToTask(id, NEAREST);
      announcer.report(id, result);
    });
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
      // Its node is being moved or removed, or the window lost the focus and keeps the bar as the
      // place to return to: the end of the draw hands the focus on, and the browser gives it back.
      if (drawing || !scroller.ownerDocument.hasFocus()) return;
      held = false;
      // A bar or a row of the same tasks takes it: that says so itself, with no gap between.
      const next = (event.relatedTarget as Partial<Element> | null)?.closest?.(
        '.gantt__bar,[data-row]',
      );
      if (core.getSnapshot().focusedTask === id && idOf(next) === undefined) {
        core.focusTask(undefined);
      }
    });
    // The task is told to let go of the focus while a bar has it, from outside: before the next
    // draw the focus goes to the chart, or a bar would claim it again. Not when the bar's own
    // `focusout` did it (`held` is off by then).
    const off = core.on('focusChange', (record) => {
      if (record === null && held && !drawing) letGo = true;
    });
    signal.addEventListener('abort', off);
    on('keydown', (event, bar, id) => {
      const snapshot = core.getSnapshot();
      const { feedback, layout } = snapshot;
      // Keys typed into something drawn in a label are that thing's.
      if (event.target !== bar || feedback.phase !== 'idle') return;
      const { key } = event;
      if ((key === 'ArrowLeft' || key === 'ArrowRight') && edit()) {
        // Left and Right edit a task that can be edited this way, and scroll the chart otherwise
        // (and with Ctrl, Cmd, or Alt alone, which belong to the browser and the system).
        const gesture = !event.shiftKey ? 'move' : event.altKey ? 'resize-start' : 'resize-end';
        const can = resolvePermissions(
          snapshot.state.derived.model.taskById.get(id),
          snapshot.editing,
        );
        if (
          event.ctrlKey ||
          event.metaKey ||
          (event.altKey && !event.shiftKey) ||
          !(gesture === 'move' ? can.move : can.resize)
        ) {
          return;
        }
        nudge(id, gesture, key === 'ArrowLeft' ? -1 : 1);
      } else if (key === 'Enter' || key === ' ') {
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
    claim(): void {
      if (!enabled() || letGo || core.getSnapshot().focusedTask !== undefined) return;
      const id = idOf(barOf(activeElement()));
      if (id !== undefined) core.focusTask(id);
    },
    draw(draw: () => void): void {
      if (letGo) {
        letGo = false;
        // The bar of a task whose row is gone is handed on by the end of this draw, like any.
        const id = idOf(barOf(activeElement()));
        if (id !== undefined && core.getSnapshot().layout.rows.rowOf(id) !== undefined) {
          held = false;
          scroller.focus({ preventScroll: true });
        }
      }
      drawing = true;
      draw();
      drawing = false;
      if (!enabled()) {
        release();
        return;
      }
      if (!armed) arm();
      const active = activeElement();
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
