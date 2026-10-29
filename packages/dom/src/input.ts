import type { GanttCore, GanttSnapshot, HitTarget, TaskId } from '@ganttlane/core';

import {
  createAutoScroller,
  type Dispose,
  type FrameSource,
  hitTargetOf,
  keyInput,
  listen,
  measureFrame,
  type PointerFrame,
  pointerInput,
  pointerOnScrollbar,
  pointerOutsideBody,
} from './dom-utils';
import { setAttr } from './shared';

/**
 * What the input needs from a core: events in, the snapshot out and its changes (the cursor and
 * the autoscroll follow the snapshot, whoever changed it). Every `GanttCore` has it.
 */
export type InputCore = Pick<GanttCore, 'send' | 'getSnapshot' | 'subscribe'>;

/** Options of {@link mountInput}. */
export interface InputOptions {
  /** The chart's core. */
  readonly core: InputCore;
  /** `div.gantt`: carries `data-cursor` while a gesture is in progress. */
  readonly root: HTMLElement;
  /** `div.gantt__scroller`: where pointer events are heard and captured, and what autoscroll moves. */
  readonly scroller: HTMLElement;
  /** Owns every listener of the input (the instance's `AbortController`). */
  readonly signal: AbortSignal;
  /** Frames for the autoscroll loop (the renderer's own source). */
  readonly frames: FrameSource;
  /**
   * Reports the scroller's position to the core and renders the outcome now
   * (`ScrollSync.report` and a flush): what the autoscroll calls after each step.
   */
  readonly report: () => void;
  /**
   * Tells when the chart's frame moved on screen without a pointer event (the page scrolled a
   * chart with an automatic height: `ScrollSync.onFrameMove`). The cached frame is then dropped
   * and measured again on the next pointer event. The input also drops it by itself when the
   * page, or any ancestor of the chart, scrolls or the window is resized.
   */
  readonly onFrameMove?: ((listener: () => void) => () => void) | undefined;
}

/** Nothing interactive is under the pointer. */
const EMPTY: HitTarget = { kind: 'empty' };

/**
 * A touch that moves farther than this (px) before it is released is a swipe, not a tap, on a bar
 * that cannot be moved; the default of the machine's own touch drag threshold.
 */
const TAP_SLOP = 8;

/**
 * Wires the pointer and the keyboard of a chart to the core's interaction machine
 * (`core.send`, FR-EDIT-1 … FR-EDIT-8, FR-LINK-4), and the machine's feedback back to the page.
 *
 * - **Events.** Pointer Events (mouse, touch, pen) are heard on the scroller, by delegation, and
 *   passed on with `pointerId`, `pointerType`, `isPrimary`, `button`, the modifiers and the
 *   event's time. A primary-button press **captures the pointer** on the scroller, so that moves
 *   and the release arrive wherever the pointer goes, outside the chart too; `pointercancel` and
 *   a lost capture send `cancel`. There are no native `click` / `dblclick` listeners: the machine
 *   decides between a click and a drag (and suppresses the click after a drag), the core reports
 *   `taskClick`, `taskDoubleClick` and `linkClick`.
 * - **Touch.** A touch that starts on a bar that may be moved (`data-movable`), on a resize or
 *   progress handle, or on a link handle is kept from turning into a scroll: the theme says
 *   `touch-action: none` there, but browsers that ignore it on SVG elements (Chromium) need the
 *   `touchstart` cancelled, which is done here. A touch on the body of any other bar is the
 *   browser's to pan with, so it is never a drag: the machine hears of it as a press and, if it
 *   is released within {@link TAP_SLOP} px, the release (a click), but one that travels farther is
 *   cancelled at the release, so that no refused drag (`editRefused`) is reported for a pan.
 * - **Coordinates.** Content `x` and body `y` (`pointerInput`): the scroller is measured when a
 *   press starts and the numbers are kept for the whole gesture, and when the pointer comes into
 *   the chart (for hover); the scroll offsets are the core's, so the rectangle is never read on a
 *   move and the scroll position never read from the element. The frame is dropped when the page
 *   or an ancestor scrolls or the window is resized (it moved on screen) and measured again by the
 *   next event. A CSS `transform: scale()` on an ancestor is converted (page px to chart px). A
 *   chart with an automatic height (`data-height="auto"` on the root) is scrolled by the page, so
 *   its scroller's rectangle already carries the offset that is the core's `scrollTop`, which is
 *   not added again. A press on the scrollbar is left to the browser.
 * - **Targets.** Where the DOM can tell, it does (`hitTargetOf`): a link by `data-link-id`, a
 *   bar or one of its handles by `data-task-id`, `data-handle` and `data-side`. The task id is
 *   read back from the attribute's text through the model, which is unambiguous unless a task
 *   id is a number and the same text is another task's id; then, as for anything that is no bar
 *   or link, the machine hit-tests the layout (`hitTest`). A pointer outside the visible body
 *   (over the sticky header, left of the chart, on or past a scrollbar) is an explicit empty
 *   target, captured or not: what the layout has there is scrolled out of sight. A captured
 *   pointer inside the body sends no target: all its events have the scroller as their target, so
 *   the layout decides (that is what a link drag needs). Moves while no gesture runs are sent too,
 *   for the hover and the cursor, but only when the element under the pointer changed; leaving
 *   the chart sends an empty target.
 * - **Keys, focus.** Any key (and the release of Alt) goes to the machine while a gesture is in
 *   progress or a link is armed: `Escape` cancels, Alt re-snaps. Otherwise keys are not sent. A
 *   press outside the chart, or the window losing focus, ends an armed link; the window losing
 *   focus ends a drag too (its release will not come here). These listeners (and the non-passive
 *   `touchstart`) are added once editing is on, so a read-only chart has none.
 * - **Effects** are read from the snapshot, not from what `send` returns: the facade acts on the
 *   effects of its own re-sends (a gesture cancelled by an API call) without returning them, and
 *   the snapshot has them all. The input follows the core's subscription, so it sees a change
 *   that no pointer event of its own caused too. `feedback.cursor` becomes `data-cursor` on the
 *   root while a gesture is in progress (the theme styles it; a captured pointer shows the
 *   scroller's cursor, whatever it is over); `feedback.link` is drawn by the overlay layer;
 *   `autoScroll` is the velocity of the autoscroll loop, started here and read again by the loop
 *   every frame, so it ends when the core says 0 (the pointer left the zone, the drag ended or
 *   was cancelled). Each step reaches the core through `report` (the scroll sync and a
 *   synchronous render), so `core.scroll` places the dragged bar under the still pointer again and
 *   grows the infinite timeline in the very frame that is painted with the new offset; the
 *   interaction machine gets its `timeline` event from `core.scroll`, so none is sent from here.
 * - **Destroying.** The signal ends the listeners and the subscription; the returned function
 *   stops the autoscroll and cancels a gesture in progress, so a core that outlives the chart is
 *   not left dragging.
 *
 * @param options - See {@link InputOptions}.
 * @returns Stops the autoscroll loop and cancels a gesture in progress; the listeners end with
 *   `options.signal`.
 */
export function mountInput(options: InputOptions): Dispose {
  const { core, root, scroller, signal, frames, report } = options;
  const { ownerDocument } = scroller;
  let frame: PointerFrame | undefined;
  /** The pointer this input captured, while it is held. */
  let captured: number | undefined;
  /** The element the last idle move was over, and the snapshot it was sent against. */
  let hovered: EventTarget | null = null;
  let hoveredIn: GanttSnapshot | undefined;
  /** A touch on a bar that cannot be moved, which the browser may pan with: where it went down. */
  let touch: { id: number; x: number; y: number } | undefined;
  /** Whether the listeners of editing are added. */
  let armed = false;
  /** `touch` when `event` is the pointer of that touch, else `undefined`. */
  const touchOf = (event: PointerEvent): typeof touch =>
    touch?.id === event.pointerId ? touch : undefined;

  const autoscroll = createAutoScroller({
    scroller,
    frames,
    velocity: () => core.getSnapshot().autoScroll,
    // The new offset reaches the core now, which places the dragged bar again (and grows the
    // infinite timeline), and the render happens now: the bar is drawn for the offset the frame
    // is painted with. The browser's own `scroll` event comes a frame later, with the same
    // offset, and changes nothing.
    scrolled: report,
  });
  /** Forgets where the chart is: it moved on screen. */
  const drop = (): void => {
    frame = undefined;
  };
  const stopFrameMoves = options.onFrameMove?.(drop);

  /** Measures the scroller now: rows begin where the header ends. */
  const measure = (): PointerFrame =>
    (frame = measureFrame(scroller, root.querySelector('.gantt__header')));

  /** Task ids are text in the DOM: `undefined` when the text is no id, or is two. */
  const taskId = (raw: string): TaskId | undefined => {
    const { taskById } = core.getSnapshot().state.derived.model;
    const number = Number(raw);
    const text = taskById.has(raw);
    const numeric = String(number) === raw && taskById.has(number);
    return text === numeric ? undefined : text ? raw : number;
  };

  const key = (event: KeyboardEvent): void => {
    if (core.getSnapshot().feedback.phase !== 'idle') core.send(keyInput(event));
  };

  /** The listeners of editing: a chart that cannot be edited needs none of them. */
  const arm = (): void => {
    armed = true;
    // `touch-action: none` on a bar is not enough: browsers that ignore `touch-action` on SVG
    // elements (Chromium does) take a touch for a pan after a few pixels and cancel the pointer.
    // So a touch that starts on a bar that may be moved, or on a handle, is kept from becoming
    // one here. Non-passive on purpose, and only `touchstart`: nothing else of a touch is held up.
    listen(
      scroller,
      'touchstart',
      (event) => {
        const target = event.target as Element | null;
        if (target?.closest('.gantt__bar[data-movable], .gantt__handle, .gantt__link-handle')) {
          event.preventDefault();
        }
      },
      { signal, passive: false },
    );
    listen(ownerDocument, 'keydown', key, { signal });
    listen(
      ownerDocument,
      'keyup',
      (event) => {
        if (event.key === 'Alt') key(event);
      },
      { signal },
    );
  };

  /** Shows what the core's feedback asks for: the cursor of a gesture, the autoscroll. */
  const sync = (): void => {
    const { feedback, autoScroll, editing } = core.getSnapshot();
    setAttr(root, 'data-cursor', feedback.phase === 'idle' ? undefined : feedback.cursor);
    if (autoScroll !== 0) autoscroll.start();
    if (!armed && Object.values(editing).includes(true)) arm();
  };

  /** What the DOM says is under a pointer that is not captured, `undefined` to hit-test. */
  const targetOf = (event: PointerEvent): HitTarget | undefined => {
    if (pointerOutsideBody(event, (frame ??= measure()))) return EMPTY;
    return event.pointerId === captured
      ? undefined
      : hitTargetOf(event.target as Element | null, taskId);
  };

  const forward = (
    type: 'down' | 'move' | 'up',
    event: PointerEvent,
    target: HitTarget | undefined,
  ): void => {
    const snapshot = core.getSnapshot();
    const scroll = {
      scrollLeft: snapshot.timeline.scrollLeft,
      // A chart that the page scrolls has a scroller that moves with it: its rectangle holds this.
      scrollTop: root.dataset.height === 'auto' ? 0 : snapshot.scrollTop,
      headerHeight: snapshot.layout.rows.headerHeight,
    };
    core.send(pointerInput(type, event, (frame ??= measure()), scroll, target));
  };

  const cancel = (pointerId?: number): void => {
    if (pointerId === captured) captured = undefined;
    if (touch?.id === pointerId) touch = undefined;
    core.send({ type: 'cancel', pointerId });
  };

  /** Ends whatever gesture or armed link there is, from outside the chart. */
  const abandon = (): void => {
    if (core.getSnapshot().feedback.phase === 'idle') return;
    captured = touch = undefined;
    core.send({ type: 'cancel' });
  };

  listen(
    scroller,
    'pointerdown',
    (event) => {
      // The one rectangle read of a gesture: what the moves and the release are placed with.
      if (pointerOnScrollbar(event, measure())) return;
      if (captured === event.pointerId) captured = undefined;
      const target = targetOf(event);
      if (event.isPrimary && event.button === 0) {
        try {
          scroller.setPointerCapture(event.pointerId);
          captured = event.pointerId;
        } catch {
          // A pointer the browser does not know (a synthetic event): the gesture works without.
        }
      }
      hovered = null;
      // The body of a bar that cannot be moved: the browser pans with a touch that starts there.
      touch =
        event.pointerType === 'touch' &&
        event.isPrimary &&
        target?.kind === 'task' &&
        target.part === 'body' &&
        !(event.target as Element).closest('[data-movable]')
          ? { id: event.pointerId, x: event.clientX, y: event.clientY }
          : undefined;
      forward('down', event, target);
    },
    { signal },
  );

  // The pointer coming into the chart: the place hover moves are measured against, read here
  // (once per entry) so that no move has to read it, and so that a page that scrolled or shifted
  // since the last visit is not remembered wrong.
  listen(scroller, 'pointerenter', measure, { signal });

  // Where the chart is on the page changes without a pointer event of ours when the page, or an
  // ancestor of the chart, scrolls and when the window is resized: whoever holds the frame has to
  // measure again. The chart's own scrolling (its scroller, its pin) does not move it.
  listen(
    ownerDocument,
    'scroll',
    (event) => {
      if (!root.contains(event.target as Node)) drop();
    },
    { signal, capture: true, passive: true },
  );
  const view = ownerDocument.defaultView;
  if (view) {
    listen(view, 'resize', drop, { signal, passive: true });
    // A drag whose release will not be heard here, and a link waiting for a click that went
    // elsewhere, are over when the window loses focus.
    listen(view, 'blur', abandon, { signal });
  }
  // A press elsewhere on the page ends an armed link (not a drag, whose pointer is held).
  listen(
    ownerDocument,
    'pointerdown',
    (event) => {
      if (captured === undefined && !root.contains(event.target as Node)) abandon();
    },
    { signal, capture: true, passive: true },
  );

  listen(
    scroller,
    'pointermove',
    (event) => {
      // The browser may take this touch for a pan and the bar cannot be dragged: the machine
      // hears of it at the release (a tap) or not at all, so it never refuses a drag.
      if (touchOf(event)) return;
      if (event.pointerId === captured) {
        forward('move', event, targetOf(event));
        return;
      }
      // Hover: the target is a function of the element, and of what the element shows (a scroll
      // or new data may bind it to another task), so the same element in the same snapshot says
      // nothing new.
      const snapshot = core.getSnapshot();
      if (
        event.target === hovered &&
        snapshot === hoveredIn &&
        snapshot.feedback.phase === 'idle'
      ) {
        return;
      }
      forward('move', event, targetOf(event));
      hovered = event.target;
      hoveredIn = core.getSnapshot();
    },
    { signal },
  );

  listen(
    scroller,
    'pointerup',
    (event) => {
      const target = targetOf(event);
      const pan = touchOf(event);
      if (event.pointerId === captured) captured = undefined;
      touch = pan ? undefined : touch;
      hovered = null;
      // A tap is a click; a touch that travelled farther was a swipe, and ends without one.
      if (pan && Math.hypot(event.clientX - pan.x, event.clientY - pan.y) >= TAP_SLOP) {
        cancel(event.pointerId);
      } else {
        forward('up', event, target);
      }
    },
    { signal },
  );

  listen(
    scroller,
    'pointercancel',
    (event) => {
      cancel(event.pointerId);
    },
    { signal },
  );

  // Also fired after every release, when the machine has finished with the pointer already
  // (`captured` was cleared by `pointerup`): only a capture lost in the middle cancels.
  listen(
    scroller,
    'lostpointercapture',
    (event) => {
      if (event.pointerId === captured) cancel(event.pointerId);
    },
    { signal },
  );

  listen(
    scroller,
    'pointerleave',
    (event) => {
      // A captured pointer does not leave until it is released.
      if (captured !== undefined) return;
      hovered = null;
      forward('move', event, EMPTY);
    },
    { signal },
  );

  // The input follows the core, not just its own sends: a gesture cancelled through the API
  // clears the cursor, and editing turned on later brings the listeners.
  const unsubscribe = core.subscribe(sync);
  signal.addEventListener('abort', unsubscribe);
  sync();

  return () => {
    stopFrameMoves?.();
    autoscroll.dispose();
    // The core may outlive the chart: it must not be left dragging.
    abandon();
  };
}
