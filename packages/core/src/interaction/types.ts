/**
 * Types of the interaction layer (`docs/architecture.md` §3, §4, §10): the pixel-level input a
 * renderer's input adapter feeds in, the effects that come out, what the hit test reports, the
 * feedback a renderer shows (cursor, tooltip) and the context the machine reads.
 */

import type { Layout, LinkPoint } from '../layout';
import type { EditingFlags, Link, NormalizedModel, TaskId } from '../model';
import type { ResolvedSnap, TimeRange } from '../scale';
import type {
  ChangeSet,
  LinkGraph,
  PropagationOptions,
  ScheduleHierarchy,
  TaskPatch,
} from '../schedule';
import type { DateAdapter } from '../time';
import type { AutoScrollOptions, TimelineState } from '../viewport';

/**
 * A gesture: dragging the whole bar (`'move'`), one of its edges, the progress handle, or a link
 * from a bar's link handle to another bar (`'link-create'`, by drag or by click-click).
 */
export type GestureKind = 'move' | 'resize-start' | 'resize-end' | 'progress' | 'link-create';

/**
 * The part of a task's bar under the pointer: the body, an edge's resize handle, the progress
 * handle, or a link handle outside the start or the end edge (see `barHandles`).
 */
export type TaskPart =
  'body' | 'resize-start' | 'resize-end' | 'progress' | 'link-start' | 'link-end';

/** A task's bar is under the pointer. */
export interface TaskTarget {
  /** Discriminant. */
  readonly kind: 'task';
  /** The task. */
  readonly id: TaskId;
  /** Which part of the bar. */
  readonly part: TaskPart;
}

/** A link is under the pointer; only renderers report it, as an explicit target. */
export interface LinkTarget {
  /** Discriminant. */
  readonly kind: 'link';
  /** The link (`LinkRecord.id`). */
  readonly id: string;
}

/** Nothing interactive is under the pointer. */
export interface EmptyTarget {
  /** Discriminant. */
  readonly kind: 'empty';
  /** The row under the pointer, when there is one. */
  readonly rowId?: TaskId | undefined;
}

/** What is under the pointer (see `hitTest`). */
export type HitTarget = TaskTarget | LinkTarget | EmptyTarget;

/** Modifier keys held during an input event. */
export interface InteractionModifiers {
  /** Alt / Option: snapping falls back to the data step (FR-SNAP-10). */
  readonly alt?: boolean | undefined;
  /** Shift. */
  readonly shift?: boolean | undefined;
  /** Control. */
  readonly ctrl?: boolean | undefined;
  /** Meta / Command. */
  readonly meta?: boolean | undefined;
}

/**
 * A pointer went down, moved or went up (Pointer Events, FR-EDIT-1). Coordinates are **content
 * pixels** of the context the event is sent with: `x` on the time scale (`TimelineState`: scale
 * `x = 0` is the left edge of the scrolled content, so `x = clientX - viewportLeft + scrollLeft`),
 * `y` in layout body pixels (the top of the first row is `0`, so the scroller's content y minus
 * `rows.headerHeight`, which includes `InteractionContext.scrollTop`). An `up` outside the chart
 * is sent like any other (pointer capture).
 */
export interface PointerInput {
  /** Discriminant. */
  readonly type: 'down' | 'move' | 'up';
  /** The pointer (`PointerEvent.pointerId`); a gesture follows the pointer that started it. */
  readonly pointerId: number;
  /** Content x, see above. */
  readonly x: number;
  /** Body y, see above. */
  readonly y: number;
  /** Timestamp in milliseconds (`event.timeStamp`), for double clicks. */
  readonly time: number;
  /** For `'down'`: the button, `0` (primary, default) starts gestures, any other is ignored. */
  readonly button?: number | undefined;
  /** `'mouse'`, `'pen'` or `'touch'`; touch uses its own drag threshold. */
  readonly pointerType?: string | undefined;
  /**
   * `PointerEvent.isPrimary`: the pointer is the primary one of its type (the only mouse, the
   * first finger of a touch). A primary `'down'` of the running gesture's pointer type means the
   * release of that gesture was lost; see `createInteraction`. Default `false`.
   */
  readonly isPrimary?: boolean | undefined;
  /** Modifier keys held. */
  readonly modifiers?: InteractionModifiers | undefined;
  /**
   * What the renderer knows is under the pointer (e.g. from the DOM element hit); when absent the
   * machine runs `hitTest` over the context's layout.
   */
  readonly target?: HitTarget | undefined;
  /** The renderer's own event, passed through to click effects. */
  readonly event?: unknown;
}

/**
 * A pointer was cancelled (`pointercancel`, lost capture) or the host aborts: the gesture of that
 * pointer, or with no `pointerId` any gesture, is cancelled and its preview rolled back.
 */
export interface CancelInput {
  /** Discriminant. */
  readonly type: 'cancel';
  /** The pointer; omitted: whatever is in progress. */
  readonly pointerId?: number | undefined;
}

/**
 * A key went down: `'Escape'` cancels the gesture (FR-EDIT-4); any key re-reads `modifiers`, so
 * pressing or releasing Alt mid-drag re-snaps the preview.
 */
export interface KeyInput {
  /** Discriminant. */
  readonly type: 'key';
  /** `KeyboardEvent.key`. */
  readonly key: string;
  /** Modifier keys held after this key event. */
  readonly modifiers?: InteractionModifiers | undefined;
}

/**
 * The timeline changed under a still pointer: a horizontal or vertical scroll (also drag
 * autoscroll), an infinite timeline extension or trim (new scale origin, compensated
 * `scrollLeft`), a zoom or rebase. The new state is the context's `timeline` and `scrollTop`; the
 * dragged bar is placed again so that it stays under the pointer in time, and a link gesture
 * looks again at what is under the pointer.
 */
export interface TimelineInput {
  /** Discriminant. */
  readonly type: 'timeline';
}

/** An input event of {@link Interaction.send}. */
export type InteractionEvent = PointerInput | CancelInput | KeyInput | TimelineInput;

/** Why a gesture or a link was refused. */
export type RefusalReason =
  /** Another operation of the change controller is pending (`context.busy`). */
  | 'busy'
  /** `editing`, `editable`, `locked`, `fixedDuration`, `linkable` or the task kind forbid it. */
  | 'permission'
  /** The task is gone from the model or has no bar. */
  | 'unknown-task'
  /** A link from a task to itself. */
  | 'self'
  /** The link would close a cycle of links (FR-LINK-7). */
  | 'cycle'
  /** The same link (source, target, type) exists. */
  | 'duplicate';

/**
 * The link a link gesture would create now, with the line to draw (FR-LINK-4). Points are content
 * pixels like {@link PointerInput}.
 */
export interface LinkPreview {
  /** The task the link starts from. */
  readonly source: TaskId;
  /** The link handle it was started from. */
  readonly side: 'start' | 'end';
  /** Centre of that link handle. */
  readonly from: LinkPoint;
  /** The pointer, or the target's anchor edge (by link type) when the link is valid. */
  readonly to: LinkPoint;
  /** The task under the pointer, if any. */
  readonly target: TaskId | undefined;
  /** The link that would be created; `undefined` without a valid target. */
  readonly link: Link | undefined;
  /** Why the task under the pointer is not a valid target. */
  readonly refusal: RefusalReason | undefined;
}

/** Shows a change set over the committed data (`ChangeController.preview`, FR-EDIT-5). */
export interface PreviewEffect {
  /** Discriminant. */
  readonly type: 'preview';
  /** The preview, computed with `conflicts: false`. */
  readonly changeSet: ChangeSet;
}

/** Removes the preview (`ChangeController.cancelPreview`, FR-EDIT-4). */
export interface CancelPreviewEffect {
  /** Discriminant. */
  readonly type: 'cancel-preview';
}

/**
 * Commits a change set (`ChangeController.commit`, which re-validates it and computes its
 * conflicts). It replaces the preview.
 */
export interface CommitEffect {
  /** Discriminant. */
  readonly type: 'commit';
  /** What the drag ends with. */
  readonly changeSet: ChangeSet;
}

/** Shows, moves or (with `undefined`) removes the link preview line. */
export interface LinkPreviewEffect {
  /** Discriminant. */
  readonly type: 'link-preview';
  /** The preview, `undefined` to remove it. */
  readonly preview: LinkPreview | undefined;
}

/** Creates a link (`ChangeController.createLink`, FR-LINK-4, FR-LINK-6). */
export interface CreateLinkEffect {
  /** Discriminant. */
  readonly type: 'create-link';
  /** The link: `source`, `target` and `type` (the default link type). */
  readonly link: Link;
}

/**
 * Starts, changes or (`velocity: 0`) stops the drag autoscroll (FR-EDIT-6): the renderer adds
 * `velocity` to its scroll offset every animation frame and reports the scroll with a
 * {@link TimelineInput}.
 */
export interface AutoScrollEffect {
  /** Discriminant. */
  readonly type: 'autoscroll';
  /** Signed speed in px per frame (`autoScrollVelocity`), `0` to stop. */
  readonly velocity: number;
}

/**
 * A dragged edge of the previewed bar lies outside the timeline range: grow the range to contain
 * `target` (`ensureContains`) so the bar can be dragged further (FR-TL-5). Asked once per target.
 */
export interface ExtendRangeEffect {
  /** Discriminant. */
  readonly type: 'extend-range';
  /**
   * What has to come into the range: the dragged edge of a resize (`start === end`, the edge's
   * instant); for a move, the whole previewed `[start, endExclusive)` when the bar is no wider
   * than the viewport, else only its leading edge (the end when it moved later, the start when
   * it moved earlier), so a long bar never asks for more than `maxSpan` allows. A milestone
   * exactly on an edge of the range counts as outside: its diamond sticks out.
   */
  readonly target: TimeRange;
}

/**
 * A click or double click (FR-EDIT-3): a press and release that never passed the drag threshold.
 * A double click follows the second of two clicks on the same target (the same task, whatever
 * part of its bar; the same link; the same empty row) within the double-click time and distance;
 * both clicks are reported, without delay. A cancelled press or a drag between them breaks it.
 */
export interface ClickEffect {
  /** Discriminant. */
  readonly type: 'click' | 'double-click';
  /** What was clicked (the target at the press). */
  readonly target: HitTarget;
  /** The `up` event's renderer event. */
  readonly event: unknown;
}

/** A gesture or a link was refused at its start or at its commit (FR-EDIT-7, FR-LINK-6). */
export interface RefusedEffect {
  /** Discriminant. */
  readonly type: 'refused';
  /** The gesture. */
  readonly gesture: GestureKind;
  /** The dragged task, or the link source. */
  readonly id: TaskId;
  /** For links: the target. */
  readonly target?: TaskId | undefined;
  /** Why. */
  readonly reason: RefusalReason;
  /**
   * When: the drag was about to start, or to be committed on release. A task that disappears
   * mid-drag ends the drag at once (its preview is rolled back), but its `'unknown-task'`
   * refusal comes with the release, `'commit'`; none comes when the drag is cancelled first.
   */
  readonly at: 'start' | 'commit';
}

/** The {@link InteractionFeedback} changed. */
export interface FeedbackEffect {
  /** Discriminant. */
  readonly type: 'feedback';
  /** The new feedback. */
  readonly feedback: InteractionFeedback;
}

/** An effect of {@link Interaction.send}; the caller applies them in order. */
export type InteractionEffect =
  | PreviewEffect
  | CancelPreviewEffect
  | CommitEffect
  | LinkPreviewEffect
  | CreateLinkEffect
  | AutoScrollEffect
  | ExtendRangeEffect
  | ClickEffect
  | RefusedEffect
  | FeedbackEffect;

/**
 * Where the machine is: nothing pressed, a press below the drag threshold, a date drag, or a link
 * gesture (dragged, or armed by a click on a link handle and waiting for the target click).
 */
export type InteractionPhase = 'idle' | 'pressed' | 'dragging' | 'linking';

/** A CSS cursor keyword for the chart. */
export type InteractionCursor =
  'default' | 'pointer' | 'grab' | 'grabbing' | 'ew-resize' | 'crosshair' | 'not-allowed';

/**
 * What a renderer shows for the interaction (FR-EDIT-8): the cursor, the hovered target, the
 * previewed values of the dragged task for the tooltip (new dates, working days through the
 * calendar) and the link preview. Frozen; a new object only when something changed.
 */
export interface InteractionFeedback {
  /** The phase. */
  readonly phase: InteractionPhase;
  /** The gesture pressed, dragged or linked. */
  readonly gesture: GestureKind | undefined;
  /** The task of that gesture (the link source while linking). */
  readonly id: TaskId | undefined;
  /** What is under the pointer: hovered, pressed, or the link target candidate. */
  readonly hover: HitTarget;
  /** The cursor to show. */
  readonly cursor: InteractionCursor;
  /** While dragging: the dragged task's previewed values. */
  readonly patch: TaskPatch | undefined;
  /** While linking: the link preview. */
  readonly link: LinkPreview | undefined;
}

/** The global `editing` option (`docs/api.md` §3): `false` disables all editing from the UI. */
export type EditingOption = boolean | EditingFlags;

/**
 * The global `editing` option with every flag spelled out (`resolveEditing`): what
 * `GanttSnapshot.editing` carries, so a renderer decides which handles to draw (together with the
 * task's own permissions, `resolvePermissions(model, snapshot.editing)`) without re-reading the
 * option. Frozen; also an {@link EditingOption}.
 */
export interface ResolvedEditing {
  /** Dragging the whole bar. */
  readonly move: boolean;
  /** Dragging an edge of a bar. */
  readonly resize: boolean;
  /** Dragging the progress handle. */
  readonly progress: boolean;
  /** Creating and deleting links from the UI. */
  readonly links: boolean;
}

/**
 * Everything the machine reads, current at the moment of each event. A structural type: the
 * facade (plan step 3.8) builds it from the store snapshot (`derived.model`, `.hierarchy`,
 * `.graph`, `.snap.snap`, `settings.propagation`), its layout and timeline state, and the change
 * controller (`busy: controller.pending`).
 */
export interface InteractionContext {
  /** The committed model (tasks, calendar, granularity, default link type). */
  readonly model: NormalizedModel;
  /** The task tree of the model. */
  readonly hierarchy: ScheduleHierarchy;
  /** The link graph of the model. */
  readonly graph: LinkGraph;
  /** Rows and bars in body pixels, placed with `timeline.scale`; hit-tested. */
  readonly layout: Layout;
  /** Range, scale, scroll offset and viewport width: pointer ↔ time and autoscroll. */
  readonly timeline: TimelineState;
  /**
   * The body's vertical scroll offset in px, default `0`. The machine keeps the pointer in
   * viewport y (`y - scrollTop`) like it keeps viewport x, so after a vertical scroll (reported
   * with a `timeline` event) a link gesture hit-tests and draws at the new content y.
   */
  readonly scrollTop?: number | undefined;
  /**
   * Snap settings of the active view mode (`resolveSnap`); its `keepDayPrecision` also goes to
   * the preview's `propagate` (FR-SNAP-7).
   */
  readonly snap: ResolvedSnap;
  /** Calendar math for snapping (week starts, months). */
  readonly adapter: DateAdapter;
  /**
   * Propagation policy, `moveChildren` and `skipNonWorkingDays` (`move` default `true`, `resize`
   * `false`, `progress` `true`). Previews always run with `conflicts: false`.
   */
  readonly propagation?: PropagationOptions | undefined;
  /** The global `editing` option; default `true`. */
  readonly editing?: EditingOption | undefined;
  /** `scroll.autoScroll`: zone and speed (default 40 px, 20 px per frame), or `false` for none. */
  readonly autoScroll?: AutoScrollOptions | false | undefined;
  /** The change controller is pending (`ChangeController.pending`): no gesture starts or commits. */
  readonly busy?: boolean | undefined;
}

/** Sizes of the bar handles in px, see `barHandles`. */
export interface HandleOptions {
  /** Width of each resize zone inside the bar, at most a third of the bar. Default 8. */
  readonly resize?: number | undefined;
  /** Half-size of the progress handle box around the done part's bottom end. Default 6. */
  readonly progress?: number | undefined;
  /** Radius of the link handles. Default 6. */
  readonly link?: number | undefined;
  /** Distance of the link handles' centres outside the bar edges. Default 10. */
  readonly linkOffset?: number | undefined;
}

/**
 * {@link HandleOptions} with the defaults applied (`resolveHandles`): the sizes the machine hit
 * tests with and a renderer draws the handles with (`GanttSnapshot.handles`). Frozen.
 */
export interface ResolvedHandles {
  /** Width of each resize zone inside the bar. */
  readonly resize: number;
  /** Half-size of the progress handle box. */
  readonly progress: number;
  /** Radius of the link handles. */
  readonly link: number;
  /** Distance of the link handles' centres outside the bar edges. */
  readonly linkOffset: number;
}

/** Options of `createInteraction`; defaults in `INTERACTION_DEFAULTS`. */
export interface InteractionOptions {
  /** Distance in px a mouse or pen press must travel to become a drag. Default 3. */
  readonly dragThreshold?: number | undefined;
  /** The same for touch. Default 8. */
  readonly touchDragThreshold?: number | undefined;
  /** Longest time between two clicks of a double click, ms. Default 500. */
  readonly doubleClickTime?: number | undefined;
  /** Farthest distance between two clicks of a double click, px. Default 6. */
  readonly doubleClickDistance?: number | undefined;
  /** Handle sizes for hit testing (renderers draw the handles with the same sizes). */
  readonly handles?: HandleOptions | undefined;
}

/**
 * The interaction state machine of `createInteraction`. Its members need no `this`.
 */
export interface Interaction {
  /**
   * Feeds one input event with the context current at that moment and returns the effects to
   * apply, in order (frozen). Odd input never throws: unknown pointers, keys and events that do
   * not apply to the current phase are ignored. A context that breaks its contracts (a negative
   * viewport width, a scale whose origin is not the range start) is a programming error and may
   * throw, as in the viewport functions.
   */
  readonly send: (
    event: InteractionEvent,
    context: InteractionContext,
  ) => readonly InteractionEffect[];
  /** The current feedback (also emitted as a `'feedback'` effect when it changes). */
  readonly feedback: InteractionFeedback;
}
