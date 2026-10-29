import type { ActiveLinkRecord, GestureKind, LinkRecord, TaskRecord } from '@ganttlane/core';

import type { DisposableNode } from '../../shared';

export type { DisposableNode };

/** What opens a task's tooltip. */
export type TooltipTrigger = 'hover' | 'click' | 'focus' | 'none';

/** The side of its anchor a tooltip prefers; it flips to the other when there is no room. */
export type TooltipPlacement = 'top' | 'bottom';

/** A button of a popover: it calls `onSelect` with the popover's context and closes it. */
export interface TooltipAction<TContext = unknown> {
  /** The button's text. */
  readonly label: string;
  /** Called when the button is chosen (click, Enter, Space). */
  readonly onSelect: (context: TContext) => void;
}

/** The structured content form: sections of text and action buttons. Every field is optional. */
export interface TooltipSections<TContext = unknown> {
  /** First line, emphasised. */
  readonly title?: string | undefined;
  /** Second line. */
  readonly subtitle?: string | undefined;
  /** Third line. */
  readonly details?: string | undefined;
  /** Buttons under the text (menu items in a link menu). */
  readonly actions?: readonly TooltipAction<TContext>[] | undefined;
}

/**
 * What a popover shows, safe by type:
 *
 * - a `string` is inserted as **text**, never parsed as HTML;
 * - a `Node` is appended as it is (it is moved, so a render function that returns the same node
 *   twice shows it once);
 * - `{ html }` is the **only** way to insert markup: it is parsed and inserted as it is, so
 *   sanitising it is the caller's responsibility (never pass it data you do not trust);
 * - an object of {@link TooltipSections} is rendered as title, subtitle, details and buttons
 *   (every part is text);
 * - a {@link DisposableNode} (`{ node, dispose }`) is a `Node` that is told when the popover is
 *   done with it: `dispose()` is called once when the popover closes, is made again from new
 *   inputs, or is replaced. It is for nodes someone else keeps alive (a framework's portal
 *   host). Unlike a plain `Node` it takes pointer events when the popover stays open (a link
 *   menu, a tooltip opened by a click), so that what is in it can be used.
 *
 * Empty content (`null`, `''`, whitespace, `{}`, `{ html: '' }`) hides the popover.
 *
 * @typeParam TContext - What the actions' `onSelect` receive.
 */
export type TooltipContent<TContext = unknown> =
  string | Node | DisposableNode | { readonly html: string } | TooltipSections<TContext>;

/**
 * The chart's read helpers a popover's render function may use.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface TooltipApi<TData = unknown> {
  /** The record of a task, as `GanttCore.getTask`. */
  getTask(id: TaskRecord['id']): TaskRecord<TData> | undefined;
  /** A link of the graph, as `GanttCore.getLink`. */
  getLink(id: string): LinkRecord | undefined;
  /** Closes the popover. */
  hide(): void;
}

/**
 * The dragged task's values as previewed during a gesture: what its dates and
 * lengths would be if it were dropped now.
 */
export interface TaskPreview {
  /** New first moment. */
  readonly start: Date;
  /** New end in the semantics of the input (the last day for a day-precision task). */
  readonly end: Date;
  /** New end of the half-open interval. */
  readonly endExclusive: Date;
  /** Progress in percent, `0` … `100`. */
  readonly progress: number;
  /** Working days of that span through the work calendar, so they follow the move. */
  readonly workingDays: number;
}

/**
 * What a task tooltip's render function is told.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface TaskTooltipContext<TData = unknown> {
  /** The task's record (the committed one, also during a drag: see `preview`). */
  readonly task: TaskRecord<TData>;
  /** While dragging this task: the previewed dates, lengths and progress. */
  readonly preview: TaskPreview | undefined;
  /** Whether this task is being dragged now. */
  readonly isDragging: boolean;
  /** The gesture being dragged, while `isDragging`. */
  readonly gesture: GestureKind | undefined;
  /** The task's parent. */
  readonly parent: TaskRecord<TData> | undefined;
  /** Links into the task: `source` is the predecessor, `lag` the gap. */
  readonly predecessors: readonly ActiveLinkRecord[];
  /** Links out of the task: `target` is the successor, `lag` the gap. */
  readonly successors: readonly ActiveLinkRecord[];
  /** The chart's locale (BCP 47, the core's `locale` option), for `Intl`. */
  readonly locale: string;
  /** Read helpers and `hide()`. */
  readonly api: TooltipApi<TData>;
}

/**
 * What a link menu's render function is told.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface LinkMenuContext<TData = unknown> {
  /** The clicked link. */
  readonly link: LinkRecord;
  /** The task it starts from. */
  readonly source: TaskRecord<TData> | undefined;
  /** The task it ends at. */
  readonly target: TaskRecord<TData> | undefined;
  /**
   * Whether the link may be removed from here: editing links is on, the link is editable and
   * `linkMenu.onRemove` is set.
   */
  readonly canRemove: boolean;
  /** Removes the link through `linkMenu.onRemove` and closes the menu; does nothing if `!canRemove`. */
  remove(): void;
  /** The chart's locale (BCP 47, the core's `locale` option), for `Intl`. */
  readonly locale: string;
  /** Read helpers and `hide()`. */
  readonly api: TooltipApi<TData>;
}

/**
 * The `tooltip` option.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface TooltipOptions<TData = unknown> {
  /**
   * What opens the tooltip. Default `'hover'`. `'focus'` is planned for when bars are
   * focusable: until then it opens nothing, like `'none'`.
   */
  readonly trigger?: TooltipTrigger | undefined;
  /** The tooltip follows the cursor and sits above it, instead of sitting on the bar. Default `false`. */
  readonly followCursor?: boolean | undefined;
  /** Keep the tooltip while a bar is dragged, showing the previewed values. Default `true`. */
  readonly showWhileDragging?: boolean | undefined;
  /**
   * The content, called when the tooltip opens and when its inputs change (another task, new
   * previewed values), never on a mere mouse move. `null` hides it. Default: the task's name,
   * dates, progress and working days.
   */
  readonly render?:
    | ((context: TaskTooltipContext<TData>) => TooltipContent<TaskTooltipContext<TData>> | null)
    | undefined;
  /** Milliseconds a hovered bar waits before its tooltip opens; `0` for none. Default `150`. */
  readonly delay?: number | undefined;
  /** The side of the bar (or the cursor) the tooltip prefers. Default `'top'`. */
  readonly placement?: TooltipPlacement | undefined;
}

/**
 * The `linkMenu` option.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface LinkMenuOptions<TData = unknown> {
  /**
   * The content of the menu a click on a link opens. `null` shows no menu. Default: a menu
   * with one action, remove, when the link can be removed.
   */
  readonly render?:
    | ((context: LinkMenuContext<TData>) => TooltipContent<LinkMenuContext<TData>> | null)
    | undefined;
  /**
   * Removes a link when the user chooses the default action or calls `context.remove()`.
   * `createGantt` defaults it to the chart's own `removeLink`; give your own to confirm, or to
   * remove the link from your data in a controlled setup. A bare renderer (`mountRenderer`) has
   * no default: without it nothing can be removed from the menu.
   */
  readonly onRemove?: ((link: LinkRecord) => unknown) | undefined;
}

/** The `highlightTooltip` option. */
export interface HighlightTooltipOptions {
  /** The label follows the cursor instead of staying where it opened. Default `false`. */
  readonly followCursor?: boolean | undefined;
}
