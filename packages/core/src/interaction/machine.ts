/**
 * The interaction state machine (State pattern): pixel-level
 * pointer and key events in, effects out (preview, commit, link creation, autoscroll, range
 * extension, clicks, feedback). Renderer-independent and free of side effects: the caller applies
 * the effects (the change controller, the scroller, the cursor).
 */

import type { LinkPoint } from '../layout';
import type { TaskId } from '../model';
import type { TimeRange } from '../scale';
import {
  type ChangeSet,
  linkAnchors,
  type TaskBounds,
  type TaskPatch,
  wouldCreateCycle,
} from '../schedule';
import { asDateTimeMs, type DateTimeMs } from '../time';
import { autoScrollVelocity, type TimelineState } from '../viewport';
import { INTERACTION_DEFAULTS } from './defaults';
import { type DatedTask, type DateGesture, editChangeSet, patchOf, snapEdit } from './edit';
import { barHandles, hitTest } from './hit-test';
import { resolvePermissions } from './permissions';
import type {
  CancelInput,
  GestureKind,
  HandleOptions,
  HitTarget,
  Interaction,
  InteractionContext,
  InteractionCursor,
  InteractionEffect,
  InteractionEvent,
  InteractionFeedback,
  InteractionOptions,
  KeyInput,
  LinkPreview,
  PointerInput,
  RefusalReason,
  TaskPart,
  TaskTarget,
} from './types';

/** {@link InteractionOptions} with defaults applied. */
interface Settings {
  readonly dragThreshold: number;
  readonly touchDragThreshold: number;
  readonly doubleClickTime: number;
  readonly doubleClickDistance: number;
  readonly handles: HandleOptions | undefined;
}

/** The last click, for double clicks. */
interface ClickRecord {
  readonly target: HitTarget;
  readonly time: number;
  readonly x: number;
  readonly y: number;
}

/** Data of one machine shared by its states. */
interface Machine {
  readonly settings: Settings;
  lastClick: ClickRecord | undefined;
  /** The autoscroll velocity last emitted. */
  velocity: number;
}

/** One {@link Interaction.send} call. */
interface Run {
  readonly m: Machine;
  readonly ctx: InteractionContext;
  readonly out: InteractionEffect[];
}

/** The pointer a gesture follows: its id, and its type to tell a lost release (see `dispatch`). */
interface PointerRef {
  readonly id: number;
  readonly type: string | undefined;
}

/** A press that has not passed the drag threshold yet. */
interface Press {
  readonly pointer: PointerRef;
  /** Viewport x (content x minus `scrollLeft`) and y (body y minus `scrollTop`) at the press. */
  readonly vx: number;
  readonly vy: number;
  /** The time under the pointer at the press: the drag's anchor. */
  readonly t: DateTimeMs;
  readonly target: HitTarget;
  /** The gesture a drag would start: from the part of the bar pressed. */
  readonly gesture: GestureKind | undefined;
  readonly threshold: number;
}

const EMPTY: HitTarget = /* @__PURE__ */ Object.freeze({ kind: 'empty' });
const CANCEL_PREVIEW: InteractionEffect = /* @__PURE__ */ Object.freeze({ type: 'cancel-preview' });
const NO_LINK_PREVIEW: InteractionEffect = /* @__PURE__ */ Object.freeze({
  type: 'link-preview',
  preview: undefined,
});
const GESTURES: Readonly<Record<TaskPart, GestureKind>> = {
  body: 'move',
  'resize-start': 'resize-start',
  'resize-end': 'resize-end',
  progress: 'progress',
  'link-start': 'link-create',
  'link-end': 'link-create',
};
const CURSORS: Readonly<Record<GestureKind, InteractionCursor>> = {
  move: 'grab',
  'resize-start': 'ew-resize',
  'resize-end': 'ew-resize',
  progress: 'ew-resize',
  'link-create': 'crosshair',
};

/**
 * Creates the interaction state machine. Each instance holds one gesture at a time; feed it every
 * pointer, key and timeline event with the context current at that moment.
 *
 * **Phases.** `idle` → `pressed` (a primary-button press) → `dragging` once the pointer travels
 * `dragThreshold` px (`touchDragThreshold` for touch) → `idle` on release. A release below the threshold is a
 * click (and a double click when it repeats the previous click within `doubleClickTime` and
 * `doubleClickDistance` on the same task, whatever part of its bar, the same link or the same
 * empty row); no click follows a drag or a cancelled press, and a cancelled press (Escape, a
 * pointer cancel) or a drag breaks the pairing. A press on a link handle becomes `linking`: by
 * dragging to the target bar, or by clicking the handle and then clicking the target
 * (click-click).
 *
 * **Other pointers and lost releases.** A gesture follows the pointer that started it; other
 * pointers are ignored while it runs, a second finger (`isPrimary: false`) and another device
 * included. A primary-button `down` that the gesture's pointer cannot send while it is pressed —
 * one with the gesture's own `pointerId`, or a primary pointer (`isPrimary: true`) of the same
 * `pointerType` (a new first finger: the old touch has ended) — means its release was lost (a
 * missed `pointerup`): the gesture is rolled back like a cancel (`'cancel-preview'` or the link
 * preview removed, no commit, no click) and the press then starts over as from `idle`.
 *
 * **Gestures** by the part pressed (`hitTest`, or the event's explicit `target`): the body moves
 * the bar, the resize zones its edges, the progress handle its progress, a link handle creates a
 * link. Each starts only if `context.busy` is not set and `resolvePermissions` allows it, checked
 * when the drag starts and **again on release** against the context of that moment;
 * a refusal is a `'refused'` effect, and a refused commit rolls the preview back. A
 * task gone mid-drag ends the drag (preview rolled back) and is refused `'unknown-task'` at the
 * release.
 *
 * **Anchoring in time.** The press records the date under the pointer and the dragged edge's date;
 * every later position is the edge plus the time the pointer travelled, read through the current
 * `timeline` (`scale.xToDate(viewportX + scrollLeft)`, the pointer's viewport x kept from its last
 * event). A scroll, autoscroll, extension of the infinite timeline (new origin, compensated
 * `scrollLeft`) or rebase is a `timeline` event: the bar is placed again under the still pointer,
 * so it never shifts against it, and autoscroll carries it along. The pointer's viewport y is
 * kept the same way against `context.scrollTop`, so after a vertical scroll a link gesture
 * hit-tests the row now under the pointer.
 *
 * **Date gestures** snap per gesture (`context.snap`; Alt falls back to the data step), keep a
 * resized bar one step long, and preview the propagation through links and children (`propagate`
 * with `conflicts: false`); see `snapEdit`. A preview is emitted only when the snapped value
 * changes; the release commits the last one (also outside the chart). A dragged edge outside the
 * timeline range asks for `'extend-range'` (see
 * `ExtendRangeEffect` for the target); a pointer in the viewport's edge zones sets the
 * `'autoscroll'` velocity. `Escape` or a pointer cancel rolls the preview back
 * and swallows the rest of the press.
 *
 * **Links** use the model's default link type. A target is refused for itself, when either end
 * may not link, for a duplicate (a link with the same source, target and type), or when the link
 * would close a cycle (`wouldCreateCycle`); the preview line shows the refusal, and the release
 * creates the link only when it is valid. The source's own link handles are no target, so
 * clicking an armed handle again cancels quietly; a release over empty space cancels too.
 *
 * @param options - Drag threshold, double-click timing, handle sizes; see `INTERACTION_DEFAULTS`.
 * @returns The machine.
 *
 * @example
 * ```ts
 * const interaction = createInteraction();
 * function onPointer(event: PointerInput): void {
 *   for (const effect of interaction.send(event, contextFromStore())) {
 *     if (effect.type === 'preview') controller.preview(effect.changeSet);
 *     else if (effect.type === 'cancel-preview') controller.cancelPreview();
 *     else if (effect.type === 'commit') void controller.commit(effect.changeSet);
 *     else if (effect.type === 'create-link') void controller.createLink(effect.link);
 *     else if (effect.type === 'autoscroll') autoScroller.setVelocity(effect.velocity);
 *   }
 * }
 * ```
 */
export function createInteraction(options: InteractionOptions = {}): Interaction {
  const defaults = INTERACTION_DEFAULTS;
  const m: Machine = {
    settings: {
      dragThreshold: options.dragThreshold ?? defaults.dragThreshold,
      touchDragThreshold: options.touchDragThreshold ?? defaults.touchDragThreshold,
      doubleClickTime: options.doubleClickTime ?? defaults.doubleClickTime,
      doubleClickDistance: options.doubleClickDistance ?? defaults.doubleClickDistance,
      handles: options.handles,
    },
    lastClick: undefined,
    velocity: 0,
  };
  let state: State = new Idle(EMPTY);
  let feedback = Object.freeze(idleFeedback(EMPTY, 'default'));
  const send = (
    event: InteractionEvent,
    context: InteractionContext,
  ): readonly InteractionEffect[] => {
    const run: Run = { m, ctx: context, out: [] };
    state = dispatch(state, event, run);
    autoScroll(run, state.scrollX?.());
    const next = state.feedback(run);
    if (!sameFeedback(next, feedback)) {
      feedback = Object.freeze(next);
      run.out.push(Object.freeze({ type: 'feedback', feedback }));
    }
    return Object.freeze(run.out);
  };
  return Object.freeze({
    send,
    get feedback(): InteractionFeedback {
      return feedback;
    },
  });
}

function dispatch(state: State, event: InteractionEvent, run: Run): State {
  switch (event.type) {
    case 'down': {
      if ((event.button ?? 0) !== 0) return state;
      const pointer = state.pointer?.();
      if (pointer !== undefined && lostRelease(pointer, event)) {
        // The release of the running gesture never came: roll it back and start over.
        state.abandon?.(run);
        run.m.lastClick = undefined;
        return new Idle(EMPTY).down(event, run);
      }
      return state.down?.(event, run) ?? state;
    }
    case 'move':
      return state.move?.(event, run) ?? state;
    case 'up':
      return state.up?.(event, run) ?? state;
    case 'cancel':
      return state.cancel?.(event, run) ?? state;
    case 'key':
      return state.key?.(event, run) ?? state;
    case 'timeline':
      return state.timeline?.(run) ?? state;
    default:
      return state;
  }
}

/**
 * Whether a primary-button press means that the release of the gesture of `pointer` was lost
 * (see `createInteraction`): the same pointer, which cannot go down twice, or the primary pointer
 * of the same type. A second finger or another device is a real second pointer.
 */
function lostRelease(pointer: PointerRef, event: PointerInput): boolean {
  return (
    event.pointerId === pointer.id ||
    (event.isPrimary === true && event.pointerType === pointer.type)
  );
}

/**
 * A phase of the machine (State pattern). Each handler returns the next state (itself to stay);
 * a phase without a handler for an event ignores it.
 */
interface State {
  down?(event: PointerInput, run: Run): State;
  move?(event: PointerInput, run: Run): State;
  up?(event: PointerInput, run: Run): State;
  cancel?(event: CancelInput, run: Run): State;
  key?(event: KeyInput, run: Run): State;
  timeline?(run: Run): State;
  /** The pointer the phase follows while it is pressed, if any. */
  pointer?(): PointerRef | undefined;
  /** Rolls the phase back without committing anything: its release was lost. */
  abandon?(run: Run): void;
  /** The pointer's viewport x while the phase autoscrolls. */
  scrollX?(): number | undefined;
  /** What the renderer shows in this phase. */
  feedback(run: Run): InteractionFeedback;
}

/** Nothing pressed; tracks the hovered target. */
class Idle implements State {
  constructor(readonly hover: HitTarget) {}

  down(event: PointerInput, run: Run): State {
    const target = targetAt(event, run);
    const { settings } = run.m;
    const { timeline } = run.ctx;
    return new Pressed({
      pointer: pointerOf(event),
      vx: event.x - timeline.scrollLeft,
      vy: event.y - scrollTopOf(run.ctx),
      t: timeline.scale.xToDate(event.x),
      target,
      gesture: target.kind === 'task' ? GESTURES[target.part] : undefined,
      threshold:
        event.pointerType === 'touch' ? settings.touchDragThreshold : settings.dragThreshold,
    });
  }

  move(event: PointerInput, run: Run): State {
    const hover = targetAt(event, run);
    return sameTarget(hover, this.hover) ? this : new Idle(hover);
  }

  feedback(run: Run): InteractionFeedback {
    return idleFeedback(this.hover, cursorOf(this.hover, run, false));
  }
}

/** A press below the drag threshold. */
class Pressed implements State {
  constructor(readonly press: Press) {}

  move(event: PointerInput, run: Run): State {
    const { press } = this;
    if (event.pointerId !== press.pointer.id) return this;
    const vx = event.x - run.ctx.timeline.scrollLeft;
    const vy = event.y - scrollTopOf(run.ctx);
    if (Math.hypot(vx - press.vx, vy - press.vy) < press.threshold) return this;
    run.m.lastClick = undefined;
    const { target, gesture } = press;
    if (target.kind !== 'task' || gesture === undefined) return new Blocked(press.pointer);
    const refusal = refusalOf(run.ctx, gesture, target.id);
    if (refusal !== undefined) {
      run.out.push(refused(gesture, target.id, refusal, 'start'));
      return new Blocked(press.pointer);
    }
    if (gesture === 'link-create') {
      return new Linking(target, press.pointer, true).track(event, run);
    }
    const task = run.ctx.model.taskById.get(target.id) as DatedTask;
    const { span } = task;
    const origin =
      gesture === 'move' || gesture === 'resize-start'
        ? span.start
        : gesture === 'resize-end'
          ? span.endExclusive
          : span.progressDate;
    const drag = new DateDrag(gesture, task, press, origin, event.modifiers?.alt === true);
    return drag.move(event, run);
  }

  up(event: PointerInput, run: Run): State {
    const { press } = this;
    if (event.pointerId !== press.pointer.id) return this;
    const { target } = press;
    if (press.gesture !== 'link-create' || target.kind !== 'task') {
      click(run, target, event);
      return new Idle(target);
    }
    const refusal = refusalOf(run.ctx, 'link-create', target.id);
    if (refusal !== undefined) {
      run.out.push(refused('link-create', target.id, refusal, 'start'));
      return new Idle(target);
    }
    return new Linking(target, undefined, false).track(event, run);
  }

  cancel(event: CancelInput, run: Run): State {
    if (!matches(event, this.press.pointer.id)) return this;
    // A cancelled press is no click and breaks a double click.
    run.m.lastClick = undefined;
    return new Idle(EMPTY);
  }

  key(event: KeyInput, run: Run): State {
    if (event.key !== 'Escape') return this;
    run.m.lastClick = undefined;
    return new Blocked(this.press.pointer);
  }

  pointer(): PointerRef {
    return this.press.pointer;
  }

  feedback(run: Run): InteractionFeedback {
    const { target, gesture } = this.press;
    return {
      ...idleFeedback(target, cursorOf(target, run, true)),
      phase: 'pressed',
      gesture,
      id: target.kind === 'task' ? target.id : undefined,
    };
  }
}

/**
 * A cancelled or ended press: everything is ignored until its pointer is released, which reports
 * `refusal` when there is one (a task gone mid-drag).
 */
class Blocked implements State {
  constructor(
    private readonly held: PointerRef,
    private readonly refusal?: InteractionEffect,
  ) {}

  up(event: PointerInput, run: Run): State {
    if (event.pointerId !== this.held.id) return this;
    if (this.refusal !== undefined) run.out.push(this.refusal);
    return new Idle(targetAt(event, run));
  }

  cancel(event: CancelInput): State {
    return matches(event, this.held.id) ? new Idle(EMPTY) : this;
  }

  key(event: KeyInput): State {
    // Escape cancels what is left of the gesture: its release reports nothing.
    return event.key === 'Escape' && this.refusal !== undefined ? new Blocked(this.held) : this;
  }

  pointer(): PointerRef {
    return this.held;
  }

  feedback(): InteractionFeedback {
    return idleFeedback(EMPTY, 'default');
  }
}

/** Dragging a bar, an edge or the progress handle. */
class DateDrag implements State {
  private readonly id: TaskId;
  private readonly hover: HitTarget;
  /** The task's values at the start: the feedback without a change. */
  private readonly base: TaskPatch;
  private vx: number;
  /** The snapped value and what it was computed against. */
  private memo: readonly unknown[] = [];
  private changeSet: ChangeSet | undefined;
  /** Whether a non-empty preview is shown. */
  private shown = false;
  private extended: TimeRange | undefined;

  constructor(
    private readonly gesture: DateGesture,
    task: DatedTask,
    private readonly press: Press,
    /** The dragged edge (or progress date) at the start. */
    private readonly origin: DateTimeMs,
    private alt: boolean,
  ) {
    this.id = task.id;
    this.hover = press.target;
    this.base = patchOf(task);
    this.vx = press.vx;
  }

  move(event: PointerInput, run: Run): State {
    if (event.pointerId !== this.press.pointer.id) return this;
    this.point(event, run);
    return this.timeline(run);
  }

  timeline(run: Run): State {
    const changeSet = this.compute(run);
    if (changeSet === undefined) {
      // The task is gone: the drag ends now, the refusal comes with the release.
      this.rollback(run);
      const refusal = refused(this.gesture, this.id, 'unknown-task', 'commit');
      return new Blocked(this.press.pointer, refusal);
    }
    if (changeSet !== this.changeSet) this.show(changeSet, run);
    return this;
  }

  key(event: KeyInput, run: Run): State {
    if (event.key === 'Escape') {
      this.rollback(run);
      return new Blocked(this.press.pointer);
    }
    this.alt = event.modifiers?.alt === true;
    return this.timeline(run);
  }

  cancel(event: CancelInput, run: Run): State {
    if (!matches(event, this.press.pointer.id)) return this;
    this.rollback(run);
    return new Idle(EMPTY);
  }

  up(event: PointerInput, run: Run): State {
    if (event.pointerId !== this.press.pointer.id) return this;
    this.point(event, run);
    const next = new Idle(targetAt(event, run));
    const refusal = refusalOf(run.ctx, this.gesture, this.id);
    const changeSet = refusal === undefined ? this.compute(run) : undefined;
    if (changeSet === undefined) {
      this.rollback(run);
      run.out.push(refused(this.gesture, this.id, refusal ?? 'unknown-task', 'commit'));
      return next;
    }
    if (changeSet.changes.length > 0) run.out.push(Object.freeze({ type: 'commit', changeSet }));
    else this.rollback(run);
    return next;
  }

  pointer(): PointerRef {
    return this.press.pointer;
  }

  abandon(run: Run): void {
    this.rollback(run);
  }

  scrollX(): number {
    return this.vx;
  }

  feedback(): InteractionFeedback {
    return {
      phase: 'dragging',
      gesture: this.gesture,
      id: this.id,
      hover: this.hover,
      cursor: this.gesture === 'move' ? 'grabbing' : 'ew-resize',
      patch: this.changeSet?.changes[0]?.after ?? this.base,
      link: undefined,
    };
  }

  private point(event: PointerInput, run: Run): void {
    this.vx = event.x - run.ctx.timeline.scrollLeft;
    this.alt = event.modifiers?.alt === true;
  }

  /**
   * The change set for the pointer's current position, the previous one when the snapped value
   * and the context did not change; `undefined` when the task is gone.
   */
  private compute(run: Run): ChangeSet | undefined {
    const { ctx } = run;
    const task = ctx.model.taskById.get(this.id);
    if (task?.span === undefined) return undefined;
    const { timeline } = ctx;
    const t = timeline.scale.xToDate(this.vx + timeline.scrollLeft);
    const raw = asDateTimeMs(this.origin + (t - this.press.t));
    const dated = task as DatedTask;
    const value = snapEdit(this.gesture, dated, this.origin, raw, ctx, this.alt);
    const memo = [value, ctx.model, ctx.hierarchy, ctx.graph, ctx.propagation, ctx.snap];
    if (this.changeSet !== undefined && memo.every((item, i) => item === this.memo[i])) {
      return this.changeSet;
    }
    this.memo = memo;
    return editChangeSet(this.gesture, dated, value, ctx);
  }

  private show(changeSet: ChangeSet, run: Run): void {
    this.changeSet = changeSet;
    const direct = changeSet.changes[0];
    if (direct === undefined) {
      this.rollback(run);
      return;
    }
    this.shown = true;
    run.out.push(Object.freeze({ type: 'preview', changeSet }));
    const target = this.extension(direct.after, run.ctx.timeline);
    if (target === undefined) return;
    if (this.extended?.start === target.start && this.extended.end === target.end) return;
    this.extended = target;
    run.out.push(Object.freeze({ type: 'extend-range', target }));
  }

  /**
   * What the range has to contain for the previewed bar (see `ExtendRangeEffect`), or
   * `undefined` when it does: the dragged edge of a resize; for a move (and the bar of a
   * progress drag) the whole bar when it is no wider than the viewport, else the leading edge of
   * a move. A zero-length bar (a milestone) on an edge of the range counts as outside.
   */
  private extension(bar: TaskBounds, timeline: TimelineState): TimeRange | undefined {
    const { range } = timeline;
    const { start, endExclusive: end } = bar;
    const point = start === end;
    const outside = (t: DateTimeMs): boolean =>
      point ? t <= range.start || t >= range.end : t < range.start || t > range.end;
    const edge = (t: DateTimeMs): TimeRange | undefined =>
      outside(t) ? Object.freeze({ start: t, end: t }) : undefined;
    if (this.gesture === 'resize-start') return edge(start);
    if (this.gesture === 'resize-end') return edge(end);
    if (timeline.scale.durationToPx(end - start) <= timeline.viewportWidth) {
      return outside(start) || outside(end) ? Object.freeze({ start, end }) : undefined;
    }
    if (this.gesture === 'progress') return undefined;
    return start > this.origin ? edge(end) : edge(start);
  }

  private rollback(run: Run): void {
    if (this.shown) run.out.push(CANCEL_PREVIEW);
    this.shown = false;
  }
}

/** Drawing a link from a link handle, by drag (`dragged`) or by click-click. */
class Linking implements State {
  private readonly source: TaskId;
  private readonly side: 'start' | 'end';
  /** The pointer's viewport x and y (see `Press`). */
  private vx = 0;
  private vy = 0;
  private hover: HitTarget = EMPTY;
  private preview: LinkPreview | undefined;
  /** The refusal of the last target checked, and what it was checked against. */
  private checked: readonly unknown[] = [];

  constructor(
    handle: TaskTarget,
    /** The pointer of the drag, or of the target click once pressed. */
    private held: PointerRef | undefined,
    readonly dragged: boolean,
  ) {
    this.source = handle.id;
    this.side = handle.part === 'link-start' ? 'start' : 'end';
  }

  /** Follows a pointer event (or, without one, the timeline) and updates the preview. */
  track(event: PointerInput | undefined, run: Run): State {
    const { ctx } = run;
    if (event !== undefined) {
      this.vx = event.x - ctx.timeline.scrollLeft;
      this.vy = event.y - scrollTopOf(ctx);
      this.hover = targetAt(event, run);
    } else {
      this.hover = hitTest(this.at(ctx), hitInput(run));
    }
    const preview = this.compute(run);
    if (preview === undefined) {
      this.end(run);
      return this.held === undefined ? new Idle(EMPTY) : new Blocked(this.held);
    }
    if (!samePreview(preview, this.preview)) {
      this.preview = preview;
      run.out.push(Object.freeze({ type: 'link-preview', preview }));
    }
    return this;
  }

  down(event: PointerInput, run: Run): State {
    if (this.dragged || this.held !== undefined) return this;
    this.held = pointerOf(event);
    return this.track(event, run);
  }

  move(event: PointerInput, run: Run): State {
    const own = this.held === undefined || event.pointerId === this.held.id;
    return own ? this.track(event, run) : this;
  }

  timeline(run: Run): State {
    return this.track(undefined, run);
  }

  up(event: PointerInput, run: Run): State {
    if (event.pointerId !== this.held?.id) return this;
    if (this.track(event, run) !== this) return new Idle(this.hover);
    const { preview } = this;
    this.end(run);
    if (preview?.link !== undefined) {
      run.out.push(Object.freeze({ type: 'create-link', link: preview.link }));
    } else if (preview?.refusal !== undefined) {
      run.out.push(refused('link-create', this.source, preview.refusal, 'commit', preview.target));
    }
    return new Idle(this.hover);
  }

  cancel(event: CancelInput, run: Run): State {
    if (event.pointerId !== undefined && event.pointerId !== this.held?.id) return this;
    this.end(run);
    return new Idle(EMPTY);
  }

  key(event: KeyInput, run: Run): State {
    if (event.key !== 'Escape') return this;
    this.end(run);
    return this.held === undefined ? new Idle(EMPTY) : new Blocked(this.held);
  }

  pointer(): PointerRef | undefined {
    return this.held;
  }

  abandon(run: Run): void {
    this.end(run);
  }

  scrollX(): number | undefined {
    return this.dragged ? this.vx : undefined;
  }

  feedback(): InteractionFeedback {
    const { preview } = this;
    return {
      phase: 'linking',
      gesture: 'link-create',
      id: this.source,
      hover: this.hover,
      cursor: preview?.refusal === undefined ? 'crosshair' : 'not-allowed',
      patch: undefined,
      link: preview,
    };
  }

  /** The pointer in content pixels of the current context. */
  private at(ctx: InteractionContext): LinkPoint {
    return Object.freeze({ x: this.vx + ctx.timeline.scrollLeft, y: this.vy + scrollTopOf(ctx) });
  }

  /** The preview for the current pointer; `undefined` when the source bar is gone. */
  private compute(run: Run): LinkPreview | undefined {
    const { ctx } = run;
    const { layout } = ctx;
    const bar = layout.getBarRect(this.source);
    if (bar === undefined) return undefined;
    const handles = barHandles(bar, run.m.settings.handles);
    const handle = this.side === 'start' ? handles.linkStart : handles.linkEnd;
    const from = Object.freeze({ x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 });
    let to = this.at(ctx);
    // The source's link handles are no target: clicking the armed handle again cancels quietly.
    const { hover } = this;
    const own = hover.kind === 'task' && hover.id === this.source && hover.part.startsWith('link');
    const target = hover.kind === 'task' && !own ? hover.id : undefined;
    const type = ctx.model.options.defaultLinkType;
    let refusal: RefusalReason | undefined;
    let link: LinkPreview['link'];
    if (target !== undefined) {
      const key = [target, ctx.model, ctx.graph, ctx.editing, ctx.busy];
      if (!key.every((item, i) => item === this.checked[i])) {
        this.checked = [...key, linkRefusal(ctx, this.source, target, type)];
      }
      refusal = this.checked[key.length] as RefusalReason | undefined;
      const end = layout.getBarRect(target);
      if (refusal === undefined && end !== undefined) {
        link = Object.freeze({ source: this.source, target, type });
        const x = linkAnchors(type).target === 'start' ? end.x : end.x + end.width;
        to = Object.freeze({ x, y: end.y + end.height / 2 });
      }
    }
    return Object.freeze({
      source: this.source,
      side: this.side,
      from,
      to,
      target,
      link,
      refusal,
    });
  }

  private end(run: Run): void {
    if (this.preview !== undefined) run.out.push(NO_LINK_PREVIEW);
    this.preview = undefined;
  }
}

/** The pointer of a pointer event. */
function pointerOf(event: PointerInput): PointerRef {
  return { id: event.pointerId, type: event.pointerType };
}

/** The context's vertical scroll offset; `0` when it has none. */
function scrollTopOf(ctx: InteractionContext): number {
  const top = ctx.scrollTop;
  return top !== undefined && Number.isFinite(top) ? top : 0;
}

/** The target under a pointer event: its explicit target, else the hit test. */
function targetAt(event: PointerInput, run: Run): HitTarget {
  return event.target ?? hitTest(event, hitInput(run));
}

function hitInput(run: Run): Parameters<typeof hitTest>[1] {
  const { ctx } = run;
  return {
    layout: ctx.layout,
    handles: run.m.settings.handles,
    permissions: (id) => resolvePermissions(ctx.model.taskById.get(id), ctx.editing),
  };
}

/** Why a gesture may not start or commit now, `undefined` when it may. */
function refusalOf(
  ctx: InteractionContext,
  gesture: GestureKind,
  id: TaskId,
): RefusalReason | undefined {
  if (ctx.busy === true) return 'busy';
  const task = ctx.model.taskById.get(id);
  if (task?.span === undefined) return 'unknown-task';
  const allowed = resolvePermissions(task, ctx.editing);
  const ok =
    gesture === 'move' || gesture === 'progress'
      ? allowed[gesture]
      : gesture === 'link-create'
        ? allowed.link
        : allowed.resize;
  return ok ? undefined : 'permission';
}

/**
 * Why a link from `source` to `target` may not be created. A duplicate is
 * a link with the same source, target and type, whatever its id.
 */
function linkRefusal(
  ctx: InteractionContext,
  source: TaskId,
  target: TaskId,
  type: string,
): RefusalReason | undefined {
  const refusal =
    refusalOf(ctx, 'link-create', source) ??
    (source === target ? 'self' : refusalOf(ctx, 'link-create', target));
  if (refusal !== undefined) return refusal;
  const { graph } = ctx;
  const same = graph
    .successorsOf(source)
    .some((link) => link.target === target && link.type === type);
  if (same) return 'duplicate';
  return wouldCreateCycle(graph, source, target) ? 'cycle' : undefined;
}

function refused(
  gesture: GestureKind,
  id: TaskId,
  reason: RefusalReason,
  at: 'start' | 'commit',
  target?: TaskId,
): InteractionEffect {
  return Object.freeze({ type: 'refused', gesture, id, target, reason, at });
}

/** Emits a click, and a double click when it repeats the previous one. */
function click(run: Run, target: HitTarget, event: PointerInput): void {
  const { m } = run;
  const { doubleClickTime, doubleClickDistance } = m.settings;
  run.out.push(Object.freeze({ type: 'click', target, event: event.event }));
  const last = m.lastClick;
  if (
    last !== undefined &&
    sameClickTarget(last.target, target) &&
    event.time - last.time <= doubleClickTime &&
    Math.hypot(event.x - last.x, event.y - last.y) <= doubleClickDistance
  ) {
    run.out.push(Object.freeze({ type: 'double-click', target, event: event.event }));
    m.lastClick = undefined;
  } else {
    m.lastClick = { target, time: event.time, x: event.x, y: event.y };
  }
}

/** Emits the autoscroll velocity for a pointer at viewport x `vx` when it changed. */
function autoScroll(run: Run, vx: number | undefined): void {
  const { ctx, m } = run;
  const options = ctx.autoScroll;
  const velocity =
    vx === undefined || options === false || !Number.isFinite(vx)
      ? 0
      : autoScrollVelocity(vx, ctx.timeline.viewportWidth, options);
  if (velocity === m.velocity) return;
  m.velocity = velocity;
  run.out.push(Object.freeze({ type: 'autoscroll', velocity }));
}

/** The cursor over a target: what a press there would do. */
function cursorOf(target: HitTarget, run: Run, pressed: boolean): InteractionCursor {
  if (target.kind === 'link') return 'pointer';
  if (target.kind === 'empty') return 'default';
  const gesture = GESTURES[target.part];
  if (refusalOf(run.ctx, gesture, target.id) !== undefined) return 'default';
  return pressed && gesture === 'move' ? 'grabbing' : CURSORS[gesture];
}

function idleFeedback(hover: HitTarget, cursor: InteractionCursor): InteractionFeedback {
  return {
    phase: 'idle',
    gesture: undefined,
    id: undefined,
    hover,
    cursor,
    patch: undefined,
    link: undefined,
  };
}

function sameFeedback(a: InteractionFeedback, b: InteractionFeedback): boolean {
  return (
    a.phase === b.phase &&
    a.gesture === b.gesture &&
    a.id === b.id &&
    a.cursor === b.cursor &&
    a.patch === b.patch &&
    a.link === b.link &&
    sameTarget(a.hover, b.hover)
  );
}

/** Whether two targets are the same, down to the part of a bar (hover feedback). */
function sameTarget(a: HitTarget, b: HitTarget): boolean {
  if (a.kind === 'task') return b.kind === 'task' && a.id === b.id && a.part === b.part;
  return sameClickTarget(a, b);
}

/**
 * Whether two clicks hit the same thing for a double click: the same task, whatever
 * part of its bar (the body and a resize zone are one bar), the same link, the same empty row.
 */
function sameClickTarget(a: HitTarget, b: HitTarget): boolean {
  switch (a.kind) {
    case 'task':
      return b.kind === 'task' && a.id === b.id;
    case 'link':
      return b.kind === 'link' && a.id === b.id;
    case 'empty':
      return b.kind === 'empty' && a.rowId === b.rowId;
  }
}

function samePreview(a: LinkPreview, b: LinkPreview | undefined): boolean {
  if (b === undefined) return false;
  return (
    a.from.x === b.from.x &&
    a.from.y === b.from.y &&
    a.to.x === b.to.x &&
    a.to.y === b.to.y &&
    a.target === b.target &&
    a.refusal === b.refusal &&
    a.link?.type === b.link?.type
  );
}

/** Whether a cancel applies to the gesture of `pointerId`. */
function matches(event: CancelInput, pointerId: number): boolean {
  return event.pointerId === undefined || event.pointerId === pointerId;
}
