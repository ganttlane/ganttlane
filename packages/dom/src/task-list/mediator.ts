import type { GanttRow, GanttSnapshot, TaskRecord } from '@ganttlane/core';

import { listen } from '../dom-utils';
import { type TaskListHost, treeAction } from './model';

/** How long the list's own scrolling goes on counting as the user's, in ms. */
const LIST_DRIVES_MS = 120;
/** How far the arrow keys move the splitter, in px. */
const SPLITTER_STEP = 16;
/** What takes a click or a key for itself when it is drawn in a cell. */
const INTERACTIVE = 'a,button,input,select,textarea,label,[contenteditable]';

/** What a list hears of its rows, in both renderers. */
export interface TaskListRowHandlers<TData = unknown> {
  /**
   * A row was clicked, or Enter or Space pressed on it (not its toggle). Then the task is selected
   * and scrolled to, unless you call `event.preventDefault()`.
   */
  readonly onRowClick?:
    ((record: TaskRecord<TData>, event: MouseEvent | KeyboardEvent) => void) | undefined;
  /** A row was double-clicked. */
  readonly onRowDoubleClick?: ((record: TaskRecord<TData>, event: MouseEvent) => void) | undefined;
}

/** What {@link mediateTaskList} works with. */
export interface TaskListMediatorOptions<TData = unknown> {
  /** The chart. */
  readonly gantt: TaskListHost<TData>;
  /** The element that scrolls the rows, unless the chart's height is `'auto'`. */
  readonly body: HTMLElement;
  /** The splitter, which may be hidden. */
  readonly splitter: HTMLElement;
  /** The handlers now. */
  readonly handlers: () => TaskListRowHandlers<TData>;
  /** The width now, and its limits. */
  readonly width: () => { readonly width: number; readonly min: number; readonly max: number };
  /** The user moved the splitter; the list takes the width it can. */
  readonly resize: (width: number) => void;
}

/** A list and its chart kept together, see {@link mediateTaskList}. */
export interface TaskListMediator {
  /**
   * Call it after every draw of the rows: the browser's focus goes to the row of
   * `snapshot.focusedTask`, which may have just been drawn.
   */
  afterDraw(): void;
  /** Ends it: listeners, the lit row, the focused task, and the chart's row hover. */
  destroy(): void;
}

/** `closest` of an event's target, whatever window the target is from, and for a non-element. */
const closest = (target: EventTarget | null, selector: string): HTMLElement | null =>
  (target as Partial<Element> | null)?.closest?.<HTMLElement>(selector) ?? null;

/**
 * Keeps a list and its chart together (the Mediator of the architecture): neither knows the other,
 * and everything goes through the chart's public API, so what is drawn by whichever renderer behaves
 * the same.
 *
 * - **Scrolling.** With `layout.height: 'auto'` the list and the chart are in one box that scrolls,
 *   and there is nothing to do: they cannot differ. With a fixed or filling height each has its
 *   own scroller, and the chart's offset is the truth. Its scrolling is written to the list while
 *   the chart's position is reported, so in the same frame the event fires in. The list's own
 *   scrolling (a wheel, a touch, the keys) is sent to the chart with `scrollTo`, instantly; what
 *   the chart then reports is an echo of an older position while the list goes on moving, and
 *   writing it back would fight a fling, so for a moment after each of its scrolls the list does
 *   not listen. Both move natively, which keeps the momentum of a touch. A browser scrolls the
 *   one under the hand on another thread, so during a fast fling the other can be a frame behind;
 *   at rest they are the same to within a pixel.
 * - **Rows.** A click selects and scrolls to the task, the toggle opens or shuts its group, the
 *   keys walk the tree (`treeAction`). The pointer lights the chart's row (`setHoveredRow`).
 * - **Focus.** The row with the browser's focus is `focusTask`; a `focusTask` from elsewhere brings
 *   the browser's focus to that row, and a row that goes away hands it to the tab stop.
 * - **Row hover.** A chart shows none on its own: `display.rowHover` turns it on while the list is
 *   there, also after the chart was replaced with its state (a hidden `<Activity>`).
 * - **Splitter.** Pointer and keys; the view draws the width.
 *
 * Touches no global, and needs a DOM only when it is called: an effect's business.
 *
 * @typeParam TData - Type of `task.data`.
 * @param options - The chart, the elements and the handlers.
 * @returns What the view calls.
 */
export function mediateTaskList<TData>(options: TaskListMediatorOptions<TData>): TaskListMediator {
  const { gantt, body, splitter, handlers, width, resize } = options;
  const abort = new AbortController();
  const { signal } = abort;
  const snapshot = (): GanttSnapshot<TData> => gantt.core.getSnapshot();
  const paged = (): boolean => gantt.getAppearance().height === 'auto';
  const activeElement = (): Element | null | undefined =>
    (body.getRootNode() as Partial<DocumentOrShadowRoot>).activeElement;
  const clock = (): number => body.ownerDocument.defaultView?.performance.now() ?? 0;

  /** The row an event happened in; `undefined` outside the rows. */
  const hit = (event: Event): { row: GanttRow<TData>; node: HTMLElement } | undefined => {
    const node = closest(event.target, '[data-row]');
    const row = node === null ? undefined : gantt.getRows()[Number(node.dataset.row)];
    return node === null || row === undefined ? undefined : { row, node };
  };

  // ---- the row hover of the chart ----

  const claimHover = (): void => {
    if (!gantt.getAppearance().rowHover) gantt.setOptions({ display: { rowHover: true } });
  };
  claimHover();

  // ---- scrolling ----

  /** Where the list was last put, or last reported from: a scroll event from there is an echo. */
  let written = 0;
  /** Until when what the chart reports is an echo of the list's own scrolling. */
  let listDrives = 0;
  /** The chart's offset when it was last looked at. */
  let chartTop: number | undefined;
  const follow = (): void => {
    claimHover();
    const { scrollTop } = snapshot();
    // Only a move of the chart is news. Most changes of the snapshot are something else (a hover
    // that the browser reports as soon as the rows move under a still pointer), and the list may
    // have moved by itself since, with its scroll event still to come.
    if (scrollTop === chartTop) return;
    chartTop = scrollTop;
    if (paged() || clock() < listDrives || Math.abs(body.scrollTop - scrollTop) < 1) return;
    body.scrollTo({ top: scrollTop, behavior: 'instant' });
    written = body.scrollTop;
  };
  /** Follows the chart whatever it did: what scrolls the list may have changed. */
  const followAnew = (): void => {
    chartTop = undefined;
    follow();
  };
  const stopFollowing = gantt.core.subscribe(follow);
  const stopWatching = gantt.on('appearanceChange', followAnew);
  follow();
  listen(
    body,
    'scroll',
    () => {
      const top = body.scrollTop;
      if (paged() || Math.abs(top - written) < 1) return;
      written = top;
      listDrives = clock() + LIST_DRIVES_MS;
      gantt.scrollTo({ top, behavior: 'instant' });
    },
    { signal, passive: true },
  );

  // ---- rows ----

  /** A click or a key that means the task itself: selects it and shows it. */
  const activate = (row: GanttRow<TData>, event: MouseEvent | KeyboardEvent): void => {
    handlers().onRowClick?.(row.record, event);
    if (event.defaultPrevented) return;
    gantt.select([row.id]);
    gantt.scrollToTask(row.id, { align: 'nearest', alignY: 'nearest', expand: false });
  };
  listen(
    body,
    'click',
    (event) => {
      const found = hit(event);
      if (found === undefined || closest(event.target, INTERACTIVE) !== null) return;
      if (found.row.hasChildren && closest(event.target, '[data-toggle]') !== null) {
        gantt.toggle(found.row.id);
      } else {
        activate(found.row, event);
      }
    },
    { signal },
  );
  listen(
    body,
    'dblclick',
    (event) => {
      const found = hit(event);
      if (found === undefined || closest(event.target, '[data-toggle]') !== null) return;
      handlers().onRowDoubleClick?.(found.row.record, event);
    },
    { signal },
  );
  listen(
    body,
    'keydown',
    (event) => {
      const found = hit(event);
      if (found === undefined) return;
      // Keys typed into something drawn in a cell are that thing's.
      if (event.target !== found.node || event.altKey || event.ctrlKey || event.metaKey) return;
      const { rowHeight, viewportHeight, headerHeight } = gantt.getLayoutMetrics();
      const page = Math.max(Math.floor((viewportHeight - headerHeight) / rowHeight) - 1, 1);
      const action = treeAction(event.key, gantt.getRows(), found.row.id, page);
      if (action === undefined) return;
      if (action.type === 'focus') gantt.focusTask(action.id);
      else if (action.type === 'toggle') gantt.toggle(action.id);
      else activate(found.row, event);
      // The arrows and Space would scroll the box otherwise.
      event.preventDefault();
    },
    { signal },
  );
  listen(
    body,
    'pointerover',
    (event) => {
      if (event.pointerType === 'mouse') gantt.setHoveredRow(hit(event)?.row.id);
    },
    { signal, passive: true },
  );
  listen(
    body,
    'pointerleave',
    () => {
      gantt.setHoveredRow(undefined);
    },
    { signal, passive: true },
  );

  // ---- focus ----

  /** The task that had the focus at the last draw, to tell when its row went away with it. */
  let focusWas: unknown;
  listen(
    body,
    'focusin',
    (event) => {
      const found = hit(event);
      if (found !== undefined) gantt.focusTask(found.row.id);
    },
    { signal },
  );
  listen(
    body,
    'focusout',
    (event) => {
      const { focusedTask } = snapshot();
      // Only the row with the focus can lose it: the blur of a row that is being replaced, or
      // that the chart has already taken the focus from, says nothing.
      if (focusedTask === undefined) return;
      if (closest(event.target, '[data-row]')?.dataset.taskId !== String(focusedTask)) return;
      if (body.contains(event.relatedTarget as Node | null)) return;
      focusWas = undefined;
      gantt.focusTask(undefined);
    },
    { signal },
  );

  // ---- splitter ----

  let press: { readonly x: number; readonly width: number } | undefined;
  listen(
    splitter,
    'pointerdown',
    (event) => {
      if (event.button !== 0) return;
      press = { x: event.clientX, width: width().width };
      splitter.setPointerCapture(event.pointerId);
      splitter.setAttribute('data-resizing', '');
      // No text selection while dragging.
      event.preventDefault();
    },
    { signal },
  );
  listen(
    splitter,
    'pointermove',
    (event) => {
      if (press !== undefined) resize(press.width + event.clientX - press.x);
    },
    { signal, passive: true },
  );
  for (const type of ['pointerup', 'pointercancel'] as const) {
    listen(
      splitter,
      type,
      () => {
        press = undefined;
        splitter.removeAttribute('data-resizing');
      },
      { signal, passive: true },
    );
  }
  listen(
    splitter,
    'keydown',
    (event) => {
      const now = width();
      const next: Readonly<Record<string, number>> = {
        ArrowLeft: now.width - SPLITTER_STEP,
        ArrowRight: now.width + SPLITTER_STEP,
        Home: now.min,
        End: now.max,
      };
      const to = next[event.key];
      if (to === undefined) return;
      resize(to);
      event.preventDefault();
    },
    { signal },
  );

  return {
    afterDraw(): void {
      const { focusedTask } = snapshot();
      const active = activeElement();
      if (focusedTask === undefined) {
        // The row with the focus went away, and the focus with it: not out of the list.
        const lost =
          focusWas !== undefined && (active === null || active === body.ownerDocument.body);
        focusWas = undefined;
        if (lost) body.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true });
        return;
      }
      focusWas = focusedTask;
      const index = gantt.getRowMetrics(focusedTask)?.index;
      const node = body.querySelector<HTMLElement>(`[data-row="${String(index)}"]`);
      if (node === null || node.contains(active ?? null)) return;
      node.focus({ preventScroll: true });
      gantt.scrollToTask(focusedTask, {
        align: false,
        alignY: 'nearest',
        behavior: 'instant',
        expand: false,
      });
    },
    destroy(): void {
      abort.abort();
      stopFollowing();
      stopWatching();
      gantt.setHoveredRow(undefined);
      if (snapshot().focusedTask !== undefined) gantt.focusTask(undefined);
      gantt.setOptions({ display: { rowHover: undefined } });
    },
  };
}
