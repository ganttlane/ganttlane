import type {
  HitTarget,
  InteractionModifiers,
  KeyInput,
  PointerInput,
  TaskId,
  TaskPart,
} from '@ganttlane/core';

/**
 * Where the scrolled content of a chart lies on the page, measured once when a press starts
 * (`measureFrame`) and reused for the whole gesture: reading it again on every move would force
 * a layout while the preview is changing the DOM.
 */
export interface PointerFrame {
  /** Client x of the content's left edge at `scrollLeft = 0` (the scroller's padding box). */
  readonly left: number;
  /** Client y of the scroller's top edge (the sticky header starts there). */
  readonly top: number;
  /** Client width of the scroller in CSS px: what the scrollbar does not take. */
  readonly width: number;
  /** Client height of the scroller in CSS px. */
  readonly height: number;
  /**
   * Page px per CSS px of the scroller (`rect.width / offsetWidth`): `1`, unless an ancestor is
   * scaled with a CSS `transform`, which scales what the pointer reports but not the scroll
   * offsets, the sizes and the coordinates of the chart.
   */
  readonly scaleX: number;
  /** The same vertically. */
  readonly scaleY: number;
  /**
   * Client y of the bottom edge of the sticky header: where the rows that are visible begin. It
   * is not `top` plus the header's height, because the header sticks to the page when a chart of
   * automatic height scrolls with it (and an application may offset that).
   */
  readonly bodyTop: number;
}

/**
 * The scroll state a pointer position is placed with. Take it from the core snapshot
 * (`timeline.scrollLeft`, `scrollTop`, `layout.rows.headerHeight`), not from the element: it is
 * the state the interaction machine anchors a drag to, so a pointer event and the machine's
 * `timeline` events always agree, whatever the element has scrolled to since the core was told.
 */
export interface PointerScroll {
  /** Content x at the left edge of the viewport. */
  readonly scrollLeft: number;
  /** Body y at the bottom edge of the sticky header. */
  readonly scrollTop: number;
  /** Height of the sticky header, in px. */
  readonly headerHeight: number;
}

/** Page px per CSS px of one axis; `1` for an element that has no size to compare (NaN). */
const scaleOf = (shown: number, laidOut: number): number => shown / laidOut || 1;

/**
 * Measures the scroller for {@link pointerInput}. Forces layout: call it when a press starts
 * (and once before the first hover), never from a move or scroll handler.
 *
 * @param scroller - The scroll container (`.gantt__scroller`).
 * @param header - The chart's sticky header, if it has one: the rows that are visible begin at
 *   its bottom edge. Without it they begin at the top of the scroller.
 * @returns Where its content lies on the page.
 */
export function measureFrame(scroller: HTMLElement, header?: Element | null): PointerFrame {
  const rect = scroller.getBoundingClientRect();
  const scaleX = scaleOf(rect.width, scroller.offsetWidth);
  const scaleY = scaleOf(rect.height, scroller.offsetHeight);
  const top = rect.top + scroller.clientTop * scaleY;
  return {
    left: rect.left + scroller.clientLeft * scaleX,
    top,
    width: scroller.clientWidth,
    height: scroller.clientHeight,
    scaleX,
    scaleY,
    bodyTop: header?.getBoundingClientRect().bottom ?? top,
  };
}

/**
 * Whether a press is on the scroller's scrollbar, outside its client box: the browser scrolls
 * with it, and capturing the pointer would take the scrollbar away.
 *
 * @param event - A `pointerdown`.
 * @param frame - The scroller's {@link measureFrame}.
 * @returns `true` for a scrollbar press.
 */
export function pointerOnScrollbar(event: PointerEvent, frame: PointerFrame): boolean {
  return (
    event.clientX - frame.left >= frame.width * frame.scaleX ||
    event.clientY - frame.top >= frame.height * frame.scaleY
  );
}

/**
 * Whether a pointer is not over a row of the chart: left of it, over its sticky header, or on
 * or past a scrollbar. The content under such a point is scrolled out of sight (a bar under the
 * header, a row below the viewport), so a pointer there, which a captured gesture can have, has
 * no target: do not let the core hit-test the layout for it.
 *
 * @param event - A pointer event.
 * @param frame - The scroller's {@link measureFrame}.
 * @returns `true` outside the visible body.
 */
export function pointerOutsideBody(event: PointerEvent, frame: PointerFrame): boolean {
  return (
    pointerOnScrollbar(event, frame) || event.clientX < frame.left || event.clientY < frame.bodyTop
  );
}

const modifiersOf = (event: MouseEvent | KeyboardEvent): InteractionModifiers => ({
  alt: event.altKey,
  shift: event.shiftKey,
  ctrl: event.ctrlKey,
  meta: event.metaKey,
});

/**
 * Turns a pointer event into the interaction machine's input in content coordinates
 * (`PointerInput`): `x = (clientX - frame.left) / scaleX + scrollLeft`
 * on the time scale, and `y = (clientY - frame.top) / scaleY + scrollTop - headerHeight` in body
 * pixels (the page's px are converted to the chart's first: they differ under a CSS scale). A
 * release outside the chart simply has coordinates outside it. A chart whose page scrolls it
 * (`height: 'auto'`) has a scroller that already moves with the page: its `scrollTop` is that
 * very offset, so the caller passes `0`.
 *
 * @param type - `'down'`, `'move'` or `'up'`.
 * @param event - The `pointerdown`, `pointermove` or `pointerup` (or `pointerleave`).
 * @param frame - The scroller's {@link measureFrame}.
 * @param scroll - The scroll state, see {@link PointerScroll}.
 * @param target - What the DOM says is under the pointer (see {@link hitTargetOf}); omitted, the
 *   machine hit-tests the layout.
 * @returns The input to `core.send`.
 */
export function pointerInput(
  type: PointerInput['type'],
  event: PointerEvent,
  frame: PointerFrame,
  scroll: PointerScroll,
  target?: HitTarget,
): PointerInput {
  return {
    type,
    pointerId: event.pointerId,
    x: (event.clientX - frame.left) / frame.scaleX + scroll.scrollLeft,
    y: (event.clientY - frame.top) / frame.scaleY + scroll.scrollTop - scroll.headerHeight,
    time: event.timeStamp,
    button: event.button,
    pointerType: event.pointerType,
    isPrimary: event.isPrimary,
    modifiers: modifiersOf(event),
    target,
    event,
  };
}

/**
 * Turns a key event into the machine's input: `Escape` cancels a gesture, and any key re-reads
 * the modifiers (Alt mid-drag re-snaps the preview).
 *
 * @param event - A `keydown` (or an Alt `keyup`).
 * @returns The input to `core.send`.
 */
export function keyInput(event: KeyboardEvent): KeyInput {
  return { type: 'key', key: event.key, modifiers: modifiersOf(event) };
}

/**
 * What the DOM says is under the pointer, through the unstyled contract: a link or its hit path
 * (`[data-link-id]`, found with `closest`), or a part of a bar (`.gantt__bar[data-task-id]`; the
 * element's own `data-handle` or `data-side` tells the handle, anything else is the body). A row
 * carries a `data-task-id` too, but it is no bar.
 *
 * Returns `undefined` when the DOM cannot tell, so that the machine hit-tests the layout
 * instead (`hitTest`, the same permissions and handle sizes as drawn): nothing of the chart is
 * under the element, or the resolver cannot place the bar's id. Never feed it the target of a
 * captured pointer: events of a captured pointer all have the capturing element as target.
 *
 * @param element - The event's target.
 * @param taskId - Maps the text of `data-task-id` back to the task's id (attributes are text,
 *   ids may be numbers); `undefined` when it cannot do so unambiguously.
 * @returns The target, or `undefined` for the hit test.
 */
export function hitTargetOf(
  element: Element | null,
  taskId: (raw: string) => TaskId | undefined,
): HitTarget | undefined {
  const link = element?.closest('[data-link-id]')?.getAttribute('data-link-id');
  if (link !== null && link !== undefined) return { kind: 'link', id: link };
  const raw = element?.closest('.gantt__bar')?.getAttribute('data-task-id');
  const id = raw === null || raw === undefined ? undefined : taskId(raw);
  if (element === null || id === undefined) return undefined;
  const side = element.getAttribute('data-side');
  const handle = element.getAttribute('data-handle');
  const part: TaskPart =
    side === 'start'
      ? 'link-start'
      : side === 'end'
        ? 'link-end'
        : handle === 'resize-start' || handle === 'resize-end' || handle === 'progress'
          ? handle
          : 'body';
  return { kind: 'task', id, part };
}
