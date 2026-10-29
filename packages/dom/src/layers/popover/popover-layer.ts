import type {
  CalendarDay,
  DateTimeMs,
  DayKey,
  GanttSnapshot,
  LinkRecord,
  TaskId,
  TaskPatch,
  TaskRecord,
} from '@ganttlane/core';
import { fromDayKey, toDate, toDayKey } from '@ganttlane/core';

import {
  intersectRects,
  listen,
  placePopover,
  pointRect,
  type Rect,
  showsNothing,
  type Side,
  type Size,
  viewportRect,
} from '../../dom-utils';
import { createHtml, disposableOf, px, setAttr, setCssVars } from '../../shared';
import type { LayerContext, LayerSlots, RendererLayer } from '../types';
import { fillContent, isEmptyContent } from './content';
import { defaultTaskContent } from './task-content';
import type {
  LinkMenuContext,
  TaskPreview,
  TaskTooltipContext,
  TooltipAction,
  TooltipApi,
  TooltipContent,
} from './types';

const DAY = 86_400_000;

type Kind = 'task' | 'link' | 'day';

interface Point {
  readonly x: number;
  readonly y: number;
}

/** What to show and where; {@link Shown} adds what is measured when it is shown. */
interface Request {
  readonly kind: Kind;
  /** Rendered into the popover; empty content shows nothing (FR-TIP-3). */
  readonly content: TooltipContent | null | undefined;
  /** Handed to the actions' `onSelect`. */
  readonly context: unknown;
  readonly menu: boolean;
  /** Opened by a click: hover logic leaves it alone and an outside press closes it. */
  readonly sticky: boolean;
  readonly side: Side;
  /** The anchor in page coordinates; called again whenever the popover is placed. */
  readonly anchor: (snapshot: GanttSnapshot) => Rect;
  /** The anchor follows the pointer, so every pointer move places the popover again. */
  readonly follow: boolean;
  /** The task a task tooltip is about, and the scroller's page box its bar is placed against. */
  readonly taskId?: TaskId | undefined;
  readonly origin?: Rect | undefined;
  /**
   * What the popover is made from (the record, the links around it, the locale, the strings, its
   * options, the previewed values of a drag), asked on every update: the list is compared with
   * the one it was made from, and a difference makes the popover again. `undefined` ends it (its
   * task or link is gone, what opened it is switched off).
   */
  readonly watch?: ((snapshot: GanttSnapshot) => readonly unknown[] | undefined) | undefined;
  /** Makes the popover again from the current inputs, in place. */
  readonly again?: (() => void) | undefined;
}

interface Shown extends Request {
  /** What `watch` said when the popover was made. */
  readonly made: readonly unknown[] | undefined;
  readonly el: HTMLDivElement;
  readonly actions: readonly TooltipAction[];
  readonly size: Size;
  /** The layer's box: popover positions are relative to it. */
  readonly layer: Rect;
  /** Where the popover may be: the layer clipped to the viewport. */
  readonly bounds: Rect;
  /** Where the focus was before the first of these popovers opened: Escape gives it back. */
  readonly restore: Element | null;
  /** The bar that shows the task, which the popover describes (`aria-describedby`). */
  readonly at: Element | undefined;
  /** Ends the life of the content when it is a `DisposableNode`: called once, by `remove`. */
  readonly dispose: (() => void) | undefined;
  /** What the content owns outside the popover (a portal), when it is a `DisposableNode`. */
  readonly owns: ((target: Node) => boolean) | undefined;
}

/**
 * The popover layer as {@link createPopoverLayer} returns it: a {@link RendererLayer} that can
 * also be told to close its popover, which is what `MountedRenderer.hideTooltip()` (and the
 * chart's `hideTooltip()`) calls.
 */
export interface PopoverLayer extends RendererLayer<LayerSlots['popover']> {
  /** Closes the popover that is open, if any. A tooltip the hover still asks for stays closed. */
  hide(): void;
}

type Instance = Pick<RendererLayer, 'update' | 'destroy'> & Pick<PopoverLayer, 'hide'>;

/**
 * The popover layer: tooltips, the link menu and the labels of highlighted and holiday days,
 * drawn into `div.gantt__layer` (HTML, a sibling of the scroller: never clipped or scrolled
 * away) one at a time (FR-TIP-1 … FR-TIP-6, FR-EDIT-8, FR-UI-3).
 *
 * ```
 * div.gantt__layer
 *   div.gantt__popover[data-kind="task|link|day"][data-placement][data-interactive][role]
 *     div.gantt__popover-title / -subtitle / -details          (the structured form)
 *     div.gantt__popover-actions > button.gantt__popover-action[data-action]
 * ```
 *
 * **Triggers.** A task tooltip opens by `tooltip.trigger`: `hover` (the default) follows
 * `snapshot.feedback.hover` after `tooltip.delay`, at once when another tooltip is open;
 * `click` follows the core's `taskClick`; `focus` is reserved for P1, when bars become focusable
 * (it opens nothing yet; `showTask` is where a `focusin` handler will come in); `none` never
 * opens it. While a bar is dragged
 * the tooltip shows `feedback.patch` (new dates, working days) unless `showWhileDragging` is off.
 * A click on a link (`linkClick`) opens the link menu; hovering a highlighted day (its label) or
 * a holiday (the calendar's name) opens a label. A hover does not open a tooltip over a link
 * menu or a tooltip with actions: those are reached by the pointer and keep the focus.
 *
 * **Content** is rendered by `fillContent`: text by default, `Node`s as they are, markup only for
 * `{ html }`. `tooltip.render` runs when a tooltip opens and when its inputs change (another
 * task, a new record, new previewed values), never on a mere pointer move. A `render` that
 * throws closes the popover that was open and rethrows (from `update`, or from the timer of a
 * delayed hover); it is not asked again for the same inputs.
 *
 * **Content with a lifetime.** A `DisposableNode` (`{ node, dispose, attached?, owns? }`) is shown
 * as its `node`, and `dispose` is called once when the popover is done with it: when it closes (in
 * any of the ways below, and on destroy), when it is replaced by another popover, and when it is
 * made again, in which case the new content has been made first and the old is disposed once the
 * new is in place (so the two may share a node: a node that is already the only child of the
 * popover is not moved, and the focus in it stays). `attached` is called once the popover is in
 * the chart and before it is measured, each time the content is shown, and the content that shows
 * nothing after it (no text and no element that draws without text) is disposed at once, so
 * content that is drawn by someone else, in the document, is judged by what it drew. `owns` names
 * what the content renders elsewhere in the page (a portal): a press on it is not a press outside,
 * and a scroll of it does not close the popover. Such a popover takes pointer events when it stays
 * open (`sticky`: a link menu, a click tooltip), so that what is in it can be used. Where the focus
 * is in the content, a popover that is made again leaves it there; a menu that opens takes the
 * focus to its first button unless the content has taken it already.
 *
 * **Position** comes from `placePopover` (above the anchor, flipped and shifted into the chart
 * and the viewport): the anchor is the bar (a rectangle from the snapshot's layout plus the
 * scroller's page position) or, with `followCursor` and for days and menus, the pointer.
 * Layout is read when a popover opens (the chart's box, the scroller's, the popover's size),
 * never in `update` and never on scroll: a bar-anchored tooltip is placed again from those
 * cached boxes and the snapshot's scroll offsets, so it follows its bar while the chart scrolls
 * or the bar is dragged (a made-again tooltip reuses the boxes and measures only itself); the
 * pointer follows from the last pointer event. With an automatic height (`data-height="auto"`)
 * the page scrolls the chart: the scroller's box has moved with it and the core's scroll offset
 * is that same page offset, so the bar's anchor takes no scroll offset.
 *
 * **Locale and strings (FR-I18N-1, FR-I18N-2).** The default task tooltip and link menu write
 * their dates and numbers in the chart's locale (`snapshot.header.locale`) and take their words
 * from `context.strings`; both reach `tooltip.render` and `linkMenu.render` (`context.locale`).
 * When the locale or the strings change under an open task tooltip or link menu, it is made
 * again from the current inputs, where it is and with the focus where it was; a day label is the
 * application's own text and stays.
 *
 * **Staying current.** An open tooltip or menu is made again, in the same element, when its
 * task's record or the links and parent around it change, when the options that make it
 * change, or when its link changes; it closes when its task or link is gone, when a click
 * tooltip's trigger is no longer `click`, and when editing links is turned off under a link
 * menu. The context of a link menu asks again whenever `remove()` or `canRemove` is used: the
 * `onRemove` set now, `editing.links` and the link as they are now.
 *
 * **Closing.** Escape closes any popover (a dismissed tooltip stays closed until the hover
 * changes) and gives the focus back to where it was before the popover opened (a menu always, as
 * it takes the focus when it opens; another popover when it held it); so does choosing an action,
 * before its `onSelect` runs. A tooltip closes when the hover leaves its bar, unless it has
 * actions or opened by click: those stay until an outside pointer down (the target is the first
 * of the event's composed path, so a chart in a shadow root works). A scroll of the page or of
 * anything but the chart closes the popover that is open (its boxes are stale), and a scroll of
 * the chart (or of the pin that holds its header) closes everything but a task tooltip, which
 * follows its bar. A scroll never cancels a hover that is still waiting, and a drag preview
 * that a scroll closed comes back with the next update.
 *
 * **Accessibility.** The bar a tooltip describes carries `aria-describedby`; when the node
 * stops showing that task (the bar left the window and its nodes were dropped, and the bar that
 * comes back is a new node) the attribute is moved to the node that shows it, or removed.
 *
 * @returns A new layer, one per chart instance.
 */
export function createPopoverLayer(): PopoverLayer {
  let instance: Instance | undefined;
  return {
    mount(context): void {
      instance = createInstance(context);
    },
    update(snapshot): void {
      instance?.update(snapshot, undefined);
    },
    hide(): void {
      instance?.hide();
    },
    destroy(): void {
      instance?.destroy();
      instance = undefined;
    },
  };
}

function createInstance(ctx: LayerContext<LayerSlots['popover']>): Instance {
  const { root, document, scroller } = ctx;
  const own = { signal: ctx.signal };
  /** `div.gantt`: the scroller's parent, which also holds the pin of an automatic height. */
  const chartRoot = scroller.parentElement ?? scroller;
  let snapshot: GanttSnapshot | undefined;
  let pointer: Point | undefined;
  let shown: Shown | undefined;
  /** The task a hover or a drag asks for. */
  let wanted: TaskId | undefined;
  /** The label under the pointer (`''` for none). */
  let day = '';
  /**
   * The scroller's left edge in the page, measured when a day label needs it and kept until
   * something may have moved it: a scroll, a press, the pointer coming in, a new viewport.
   */
  let scrollerLeft: number | undefined;
  /** One pending show per source: tasks (0) and days (1). */
  const timers: (number | undefined)[] = [];

  /** Runs `fn` after `ms` (at once for 0) in a slot, replacing its pending run; no `fn` cancels. */
  const after = (slot: 0 | 1, fn?: () => void, ms = 0): void => {
    clearTimeout(timers[slot]);
    timers[slot] = fn && ms > 0 ? setTimeout(fn, ms) : undefined;
    if (fn && ms <= 0) fn();
  };

  /** The focused element of the chart's tree: inside a shadow root `document` only names the host. */
  const activeElement = (): Element | null =>
    (root.getRootNode() as Partial<Pick<DocumentOrShadowRoot, 'activeElement'>>).activeElement ??
    null;

  /** Takes `aria-describedby` off a bar, if it still points at the popover `id`. */
  const unmark = (at: Element | undefined, id: string): void => {
    if (at?.getAttribute('aria-describedby') === id) at.removeAttribute('aria-describedby');
  };

  /**
   * Whether a node belongs to a popover: it is inside it, or it is something the content renders
   * elsewhere in the page and says it owns (the portal of a select, a menu or a date picker).
   */
  const belongs = (popover: Shown | undefined, node: Node | null): boolean =>
    popover !== undefined &&
    node !== null &&
    (popover.el.contains(node) || popover.owns?.(node) === true);

  /**
   * Removes the popover that is shown (and disposes its content, once its place is clean);
   * pending shows are left alone.
   */
  const remove = (): void => {
    if (shown === undefined) return;
    const { at, el, dispose } = shown;
    unmark(at, el.id);
    el.remove();
    shown = undefined;
    dispose?.();
  };
  /** Closes the popover that is shown and cancels the shows that are waiting. */
  const close = (): void => {
    after(0);
    after(1);
    remove();
  };
  const api: TooltipApi = {
    getTask: (id) => ctx.getTask(id),
    getLink: (id) => ctx.getLink(id),
    hide: close,
  };

  /** Places the popover from its cached boxes: no layout is read here. */
  const place = (): void => {
    if (shown === undefined || snapshot === undefined) return;
    const { el, layer } = shown;
    const at = placePopover({
      anchor: shown.anchor(snapshot),
      size: shown.size,
      bounds: shown.bounds,
      side: shown.side,
    });
    setCssVars(el, {
      '--gantt-popover-x': px(at.x - layer.x),
      '--gantt-popover-y': px(at.y - layer.y),
    });
    setAttr(el, 'data-placement', at.side);
  };

  /**
   * Runs what makes the content (an application's `render`, the text of a popover): if it
   * throws, the popover that was open is closed, nothing of it is left to describe the new
   * inputs, and the error goes on (from `update`, or from the timer of a delayed hover).
   */
  const guard = <T>(make: () => T): T => {
    try {
      return make();
    } catch (error) {
      close();
      throw error;
    }
  };

  /**
   * Points `aria-describedby` of the bar that shows the task of a task tooltip at it. A bar that
   * leaves the window loses its nodes and the one that comes back has new ones, so the node the
   * attribute was on may be gone (or show nothing): it moves to the node that shows the task, or
   * is taken off.
   */
  const mark = (): void => {
    if (shown?.taskId === undefined) return;
    const { taskId, at, el } = shown;
    const now =
      at?.isConnected && at.getAttribute('data-task-id') === String(taskId)
        ? at
        : [...scroller.querySelectorAll('.gantt__bar')].find(
            (bar) => bar.getAttribute('data-task-id') === String(taskId),
          );
    if (now !== at) {
      unmark(at, el.id);
      now?.setAttribute('aria-describedby', el.id);
      shown = { ...shown, at: now };
    }
  };

  /**
   * Shows a popover in place of the one that is open. `remake` is for the same popover made
   * again from new inputs: its element, its boxes and the element to give the focus back to are
   * kept, and only its own size is measured. The focus, if the popover being replaced held it,
   * goes to the first button of the new one, unless the new content still holds it (a node that
   * stayed where it was, or one that took the focus when it was attached).
   */
  const present = (request: Request, remake = false): void => {
    const prior = remake ? shown : undefined;
    const hosted = disposableOf(request.content);
    const held = belongs(shown, activeElement());
    const restore = shown && (remake || held) ? shown.restore : activeElement();
    let el = prior?.el;
    if (!el) {
      close();
      el = createHtml(document, 'div', {
        class: 'gantt__popover',
        id: ctx.id('popover'),
        role: request.menu ? 'menu' : 'tooltip',
        'data-kind': request.kind,
      });
    }
    const actions = fillContent(document, el, request.content, request.menu);
    // Content with a lifetime is drawn by its owner once it is in the document: judged below.
    if (hosted === undefined && isEmptyContent(el)) {
      close();
      return;
    }
    // A node with a lifetime is for something that is used (a menu) when the popover stays.
    setAttr(el, 'data-interactive', actions.length > 0 || (hosted && request.sticky));
    if (!prior) root.append(el);
    hosted?.attached?.();
    // What it drew shows nothing, or closed the popover that was being made again (`hide()` in an
    // effect): there is no popover. Elements around nothing show nothing (FR-TIP-3).
    if (hosted !== undefined && (showsNothing(el) || (prior !== undefined && shown !== prior))) {
      close();
      el.remove();
      hosted.dispose();
      return;
    }
    const layer = prior?.layer ?? root.getBoundingClientRect();
    const { width, height } = el.getBoundingClientRect();
    shown = {
      ...request,
      // A popover with buttons has to be reachable: it stays when the pointer leaves the bar.
      sticky: request.sticky || actions.length > 0,
      made: snapshot && request.watch?.(snapshot),
      el,
      actions,
      size: { width, height },
      layer,
      bounds: prior?.bounds ?? intersectRects(layer, viewportRect(document)) ?? layer,
      restore,
      at: prior?.at,
      dispose: hosted?.dispose,
      owns: hosted?.owns,
    };
    // The new content was made and shown first, so that it may share its node with the old.
    prior?.dispose?.();
    mark();
    place();
    if ((held || (request.menu && !remake)) && !belongs(shown, activeElement())) {
      el.querySelector('button')?.focus({ preventScroll: true });
    }
  };

  // ---- task tooltips ----

  /** The dates, lengths and progress a dragged task would have if it were dropped now. */
  const previewOf = (snap: GanttSnapshot, task: TaskRecord, patch: TaskPatch): TaskPreview => {
    const { calendar, endInclusive } = snap.state.derived.model.options;
    const ms = patch.endExclusive - patch.start;
    const inclusive = (patch.precision ?? task.precision) === 'day' && endInclusive && ms > 0;
    return {
      start: toDate(patch.start),
      end: toDate((patch.endExclusive - (inclusive ? DAY : 0)) as DateTimeMs),
      endExclusive: toDate(patch.endExclusive),
      progress: patch.progress,
      workingDays: calendar.countWorkingTime(patch.start, patch.endExclusive) / DAY,
    };
  };

  const taskContext = (snap: GanttSnapshot, task: TaskRecord): TaskTooltipContext => {
    const { feedback } = snap;
    const { graph } = snap.state.derived;
    const isDragging = feedback.phase === 'dragging' && feedback.id === task.id;
    return {
      task,
      preview: isDragging && feedback.patch ? previewOf(snap, task, feedback.patch) : undefined,
      isDragging,
      gesture: isDragging ? feedback.gesture : undefined,
      parent: task.parentId === undefined ? undefined : ctx.getTask(task.parentId),
      predecessors: graph.predecessorsOf(task.id),
      successors: graph.successorsOf(task.id),
      locale: snap.header.locale,
      api,
    };
  };

  /**
   * The bar's box in page coordinates, from the snapshot and the scroller's cached box. In a
   * fixed height the scroller scrolls the rows under its box, so the offset is subtracted; with
   * an automatic height the page does, the scroller's box has moved with the page already and
   * the core's offset is that same page offset.
   */
  const barAnchor =
    (id: TaskId, origin: Rect) =>
    (snap: GanttSnapshot): Rect => {
      const bar = snap.layout.getBarRect(id);
      if (bar === undefined) return origin;
      const scrolled = chartRoot.getAttribute('data-height') === 'auto' ? 0 : snap.scrollTop;
      return {
        x: origin.x + bar.x - snap.timeline.scrollLeft,
        y: origin.y + snap.layout.rows.headerHeight + bar.y - scrolled,
        width: bar.width,
        height: bar.height,
      };
    };

  /**
   * Shows the tooltip of a task, from the record as it is now. `remake` is the same tooltip
   * made again (a new record, new previewed values, new options): it is updated in place.
   */
  const showTask = (id: TaskId, remake = false): void => {
    const record = ctx.getTask(id);
    if (snapshot === undefined || record === undefined) {
      close();
      return;
    }
    const { trigger, followCursor, placement, render } = ctx.display.tooltip;
    const context = taskContext(snapshot, record);
    const content = guard(() =>
      typeof render === 'function'
        ? (render(context) as TooltipContent | null)
        : defaultTaskContent(context, ctx.strings),
    );
    const prior = remake && shown?.taskId === id ? shown : undefined;
    const origin = prior?.origin ?? scroller.getBoundingClientRect();
    const bar = barAnchor(id, origin);
    present(
      {
        kind: 'task',
        // The actions of a task tooltip are called with its context, whatever the type says.
        content,
        context,
        menu: false,
        sticky: trigger === 'click',
        side: placement ?? 'top',
        follow: followCursor === true,
        anchor: followCursor
          ? (snap) => (pointer ? pointRect(pointer.x, pointer.y) : bar(snap))
          : bar,
        taskId: id,
        origin,
        watch: (snap) => {
          const task = ctx.getTask(id);
          const { tooltip } = ctx.display;
          // A click tooltip stays only while clicking is what opens tooltips.
          return task && (trigger !== 'click' || tooltip.trigger === 'click')
            ? [
                task,
                context.parent && ctx.getTask(context.parent.id),
                snap.state.derived.graph,
                snap.feedback.id === id && snap.feedback.patch,
                snap.header.locale,
                ctx.strings,
                tooltip,
              ]
            : undefined;
        },
        again: () => {
          showTask(id, true);
        },
      },
      prior !== undefined,
    );
  };

  /** Opens, updates or closes the tooltip the pointer or a drag asks for. */
  const syncHover = (snap: GanttSnapshot): void => {
    const { trigger = 'hover', showWhileDragging = true, delay = 150 } = ctx.display.tooltip;
    const { phase, gesture, id, hover } = snap.feedback;
    const dragging = phase === 'dragging' && gesture !== 'link-create';
    const want = dragging
      ? showWhileDragging && trigger !== 'none'
        ? id
        : undefined
      : trigger === 'hover' && phase !== 'linking' && hover.kind === 'task'
        ? hover.id
        : undefined;
    if (want === undefined) {
      if (wanted === undefined) return;
      wanted = undefined;
      after(0);
      if (shown?.kind === 'task' && !shown.sticky) close();
    } else if (want !== wanted) {
      wanted = want;
      after(
        0,
        () => {
          // A link menu or a tooltip with buttons is for the pointer to reach, not for a hover to
          // replace (it would take the focus away); a drag is the one thing that does.
          if (dragging || !shown?.sticky) showTask(want);
        },
        shown?.kind === 'task' || dragging ? 0 : delay,
      );
    }
  };

  // ---- the link menu ----

  /** The menu of `link`, anchored at `box`; `remake` is the same menu made again. */
  const openLink = (link: LinkRecord, box: Rect, remake = false): void => {
    if (snapshot === undefined) return;
    const { render } = ctx.display.linkMenu;
    const { strings } = ctx;
    const source = ctx.getTask(link.source);
    const target = ctx.getTask(link.target);
    const editing = snapshot.editing.links;
    /**
     * The link as it is now, when it can be removed from here now: the handler that is set, the
     * editing option and the link's own flag are read when they are asked about, not when the
     * menu opened (the context may be kept, or the click come a frame after a change).
     */
    const removable = (): LinkRecord | undefined => {
      const now = ctx.getLink(link.id);
      return typeof ctx.display.linkMenu.onRemove === 'function' &&
        snapshot?.editing.links &&
        now?.editable
        ? now
        : undefined;
    };
    const context: LinkMenuContext = {
      link,
      source,
      target,
      get canRemove(): boolean {
        return removable() !== undefined;
      },
      remove: () => {
        const now = removable();
        if (now === undefined) return;
        if (shown?.context === context) close();
        ctx.display.linkMenu.onRemove?.(now);
      },
      locale: snapshot.header.locale,
      api,
    };
    const content = guard(() =>
      typeof render === 'function'
        ? (render(context) as TooltipContent | null)
        : context.canRemove
          ? {
              title: strings.linkTitle(
                source?.name ?? String(link.source),
                target?.name ?? String(link.target),
                context.locale,
              ),
              actions: [{ label: strings.removeLink, onSelect: () => context.remove() }],
            }
          : null,
    );
    present(
      {
        kind: 'link',
        content,
        context,
        menu: true,
        sticky: true,
        side: 'bottom',
        follow: false,
        anchor: () => box,
        watch: (snap) => {
          const now = ctx.getLink(link.id);
          // Editing links went off under a menu that was opened with it on: it closes.
          return now && (!editing || snap.editing.links)
            ? [
                now,
                ctx.getTask(link.source),
                ctx.getTask(link.target),
                snap.header.locale,
                ctx.strings,
                ctx.display.linkMenu,
              ]
            : undefined;
        },
        // The menu stays where it opened, with the focus where it was.
        again: () => {
          const now = ctx.getLink(link.id);
          if (now) openLink(now, box, true);
        },
      },
      remake,
    );
  };
  const showLink = (link: LinkRecord): void => {
    openLink(link, pointer ? pointRect(pointer.x, pointer.y) : scroller.getBoundingClientRect());
  };

  // ---- highlighted and holiday days ----

  /** The label of the day under the pointer: highlight label and holiday name; `''` for none. */
  const dayText = (target: Element, clientX: number, snap: GanttSnapshot): string => {
    if (target.closest('.gantt__bar, .gantt__link') || !target.closest('.gantt__body')) return '';
    const hit = target.closest('[data-highlight]');
    const key = (
      hit === null
        ? toDayKey(
            snap.header.scale.xToDate(
              clientX -
                (scrollerLeft ??= scroller.getBoundingClientRect().left) +
                snap.timeline.scrollLeft,
            ),
          )
        : Number(hit.getAttribute('data-day'))
    ) as DayKey;
    const label = ctx.display.highlightDays.find(
      (item) => item.id === hit?.getAttribute('data-highlight'),
    )?.label;
    let text = label;
    if (typeof label === 'function') {
      const date = fromDayKey(key);
      const { weekday, year, month, day: dayOfMonth } = snap.header.adapter.getParts(date);
      const calendarDay: CalendarDay = { dayKey: key, date, weekday, year, month, day: dayOfMonth };
      text = label(calendarDay);
    }
    return [text, snap.state.derived.model.options.calendar.explain(key).label]
      .filter(Boolean)
      .join(' · ');
  };

  const showDay = (text: string): void => {
    const follow = ctx.display.highlightTooltip.followCursor === true;
    const fixed = pointer && pointRect(pointer.x, pointer.y);
    present({
      kind: 'day',
      content: text,
      context: undefined,
      menu: false,
      sticky: false,
      side: ctx.display.tooltip.placement ?? 'top',
      follow,
      anchor: () =>
        follow && pointer
          ? pointRect(pointer.x, pointer.y)
          : (fixed ?? root.getBoundingClientRect()),
    });
  };

  // ---- input ----

  /**
   * Closes the popover that is open and gives the focus back to where it was before it opened:
   * always for a menu (it takes the focus when it opens), for another popover when it held it.
   *
   * @returns What was shown.
   */
  const dismiss = (): Shown | undefined => {
    const popover = shown;
    if (popover) {
      const held = belongs(popover, activeElement());
      close();
      if (popover.menu || held) (popover.restore as HTMLElement | null)?.focus();
    }
    return popover;
  };

  listen(
    scroller,
    'pointermove',
    (event) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (shown?.follow) ctx.scheduler.schedule(place);
      if (snapshot?.feedback.phase !== 'idle') return;
      const text = dayText(event.target as Element, event.clientX, snapshot);
      if (text === day) return;
      day = text;
      if (text === '') {
        after(1);
        if (shown?.kind === 'day') close();
      } else {
        after(
          1,
          () => {
            showDay(text);
          },
          shown?.kind === 'day' ? 0 : (ctx.display.tooltip.delay ?? 150),
        );
      }
    },
    { ...own, passive: true },
  );
  listen(
    scroller,
    'pointerenter',
    () => {
      scrollerLeft = undefined;
    },
    { ...own, passive: true },
  );
  listen(
    scroller,
    'pointerleave',
    () => {
      day = '';
      after(1);
      if (shown?.kind === 'day') close();
    },
    own,
  );
  listen(
    document,
    'keydown',
    (event) => {
      if (event.key === 'Escape') dismiss();
    },
    own,
  );
  listen(
    document,
    'pointerdown',
    (event) => {
      pointer = { x: event.clientX, y: event.clientY };
      scrollerLeft = undefined;
      if (!shown?.sticky) return;
      // Inside a shadow root the event's target is the host: the composed path knows the element.
      const target = (event.composedPath()[0] ?? event.target) as Element;
      if (belongs(shown, target)) return;
      // A press on a bar is the start of the click that replaces a click tooltip.
      if (shown.kind !== 'task' || !target.closest('.gantt__bar')) {
        // What was kept from a hover by it is free to open again (the hover is asked for anew).
        wanted = undefined;
        close();
      }
    },
    { ...own, capture: true },
  );
  /**
   * A scroll. The chart's own (the scroller, or the pin of an automatic height, which the
   * renderer scrolls along with it) moves the bars under a task tooltip, which follows them; any
   * other scroll, the page's included, moves the chart or the boxes the popover was placed from,
   * so the popover that is open closes. Waiting hovers are not touched: they measure when they open.
   */
  const onScroll = (event: Event): void => {
    scrollerLeft = undefined;
    // The page scrolling has a document for a target, which has no class list.
    const target = event.target as Partial<Element>;
    if (
      !shown ||
      (shown.kind === 'task' && (target === scroller || target.classList?.contains('gantt__pin')))
    )
      return;
    // What the popover holds (a long list in it, or in a portal it owns) moves nothing it was
    // placed from.
    if (belongs(shown, event.target as Node | null)) return;
    remove();
    // A drag preview is asked for again by the next update, while the drag lasts.
    if (snapshot?.feedback.phase === 'dragging') wanted = undefined;
  };
  listen(document, 'scroll', onScroll, { ...own, capture: true, passive: true });
  // A scroll event does not leave a shadow root: the chart's own is heard on its root.
  listen(chartRoot, 'scroll', onScroll, { ...own, capture: true, passive: true });
  // The actions of the open popover (`root` takes no pointer events itself).
  listen(
    root,
    'click',
    (event) => {
      const index = (event.target as Element).closest('[data-action]')?.getAttribute('data-action');
      if (index == null || shown === undefined) return;
      // The focus goes back before `onSelect` runs, so that an action that moves it (a dialog)
      // has the last word.
      const popover = dismiss();
      popover?.actions[Number(index)]?.onSelect(popover.context);
    },
    own,
  );

  const offs = [
    ctx.on('taskClick', (record) => {
      if (ctx.display.tooltip.trigger === 'click') showTask(record.id);
    }),
    ctx.on('linkClick', showLink),
  ];

  return {
    hide: close,
    update(snap): void {
      snapshot = snap;
      syncHover(snap);
      const now = shown?.watch?.(snap);
      if (shown?.watch && now === undefined) remove();
      else if (now?.some((value, i) => value !== shown?.made?.[i])) shown?.again?.();
      mark();
      place();
    },
    destroy(): void {
      for (const off of offs) off();
      close();
      snapshot = undefined;
      pointer = undefined;
    },
  };
}
