/**
 * Geometric hit testing over the layout: which bar and which of its parts
 * (body, resize handles, progress handle, link handles) lie under a point, for renderers that do
 * not get the target from their own elements (canvas, custom renderers) and for the machine
 * when an event carries no explicit target.
 */

import type { BarGeometry, Layout, LinkPoint } from '../layout';
import type { TaskId } from '../model';
import { INTERACTION_DEFAULTS } from './defaults';
import type { TaskPermissions } from './permissions';
import type { HandleOptions, HitTarget, ResolvedHandles, TaskPart } from './types';

/** A handle's box in body pixels; link handles are the circles inscribed in theirs. */
export interface HandleRect {
  /** Left edge. */
  readonly x: number;
  /** Top edge. */
  readonly y: number;
  /** Width. */
  readonly width: number;
  /** Height. */
  readonly height: number;
}

/** The handles of one bar (see {@link barHandles}). Frozen. */
export interface BarHandles {
  /** The start edge's resize zone; `undefined` for milestones and zero-width bars. */
  readonly resizeStart: HandleRect | undefined;
  /** The end edge's resize zone; `undefined` for milestones and zero-width bars. */
  readonly resizeEnd: HandleRect | undefined;
  /** The progress handle around the bottom end of the done part; `undefined` for milestones. */
  readonly progress: HandleRect | undefined;
  /** The link handle outside the start edge. */
  readonly linkStart: HandleRect;
  /** The link handle outside the end edge. */
  readonly linkEnd: HandleRect;
}

/** Input of {@link hitTest} besides the point. */
export interface HitTestInput {
  /** Rows and bars (`createLayout`). */
  readonly layout: Layout;
  /** Handle sizes; defaults from `INTERACTION_DEFAULTS.handles`. */
  readonly handles?: HandleOptions | undefined;
  /**
   * The permissions of a task (`resolvePermissions`): handles of what is not allowed do not
   * exist (a forbidden resize zone is body, forbidden link handles are empty space). Without it,
   * or when it returns `undefined`, every handle counts.
   */
  readonly permissions?: ((id: TaskId) => TaskPermissions | undefined) | undefined;
}

/**
 * The handle sizes with the defaults of `INTERACTION_DEFAULTS.handles` applied: what
 * {@link barHandles} and {@link hitTest} use for the same options. Pure; the result is frozen.
 *
 * @param options - Handle sizes; omitted ones take their default.
 * @returns Every size.
 */
export function resolveHandles(options: HandleOptions = {}): ResolvedHandles {
  const defaults = INTERACTION_DEFAULTS.handles;
  return Object.freeze({
    resize: options.resize ?? defaults.resize,
    progress: options.progress ?? defaults.progress,
    link: options.link ?? defaults.link,
    linkOffset: options.linkOffset ?? defaults.linkOffset,
  });
}

/**
 * Where the handles of a bar lie, in body pixels (the renderer draws them there, the hit test
 * finds them there):
 * - resize zones: `resize` px wide inside each edge, full height, at most a third of the bar
 *   each, so the middle third always moves the bar;
 * - progress: a `2 × progress` square centred on the bottom end of the done part
 *   (`x + progressWidth`, `y + height`);
 * - link handles: circles of radius `link` centred `linkOffset` px outside each edge, at
 *   mid-height.
 *
 * @param bar - The bar (`Layout.barAt`, `getBarRect`).
 * @param options - Handle sizes; defaults from `INTERACTION_DEFAULTS.handles`.
 * @returns The frozen handle boxes.
 */
export function barHandles(bar: BarGeometry, options: HandleOptions = {}): BarHandles {
  const defaults = INTERACTION_DEFAULTS.handles;
  const resize = options.resize ?? defaults.resize;
  const half = options.progress ?? defaults.progress;
  const radius = options.link ?? defaults.link;
  const offset = options.linkOffset ?? defaults.linkOffset;
  const { x, y, width, height } = bar;
  const edge = Math.min(resize, width / 3);
  const resizable = bar.kind === 'bar' && edge > 0;
  const box = (left: number, top: number, w: number, h: number): HandleRect =>
    Object.freeze({ x: left, y: top, width: w, height: h });
  const circle = (cx: number): HandleRect =>
    box(cx - radius, y + height / 2 - radius, 2 * radius, 2 * radius);
  return Object.freeze({
    resizeStart: resizable ? box(x, y, edge, height) : undefined,
    resizeEnd: resizable ? box(x + width - edge, y, edge, height) : undefined,
    progress:
      bar.kind === 'bar'
        ? box(x + bar.progressWidth - half, y + height - half, 2 * half, 2 * half)
        : undefined,
    linkStart: circle(x - offset),
    linkEnd: circle(x + width + offset),
  });
}

/**
 * What lies under a point: the row under `point.y` (`RowLayout.rowAt`), then its
 * bar's parts in this order: link handles, the progress handle, the bar itself with its resize
 * zones at the edges, else empty space in that row. Handles are only found within the row of the
 * point. Links are not hit-tested here: renderers report them as explicit targets.
 *
 * @param point - Body pixels (see `PointerInput`).
 * @param input - The layout, handle sizes and permissions.
 * @returns The target; `{ kind: 'empty' }` outside the rows.
 *
 * @example
 * ```ts
 * hitTest({ x: 412, y: 60 }, { layout }); // { kind: 'task', id: 'design', part: 'resize-end' }
 * ```
 */
export function hitTest(point: LinkPoint, input: HitTestInput): HitTarget {
  const { layout } = input;
  const { x, y } = point;
  const row = layout.rows.rowAt(y);
  if (row === undefined) return EMPTY;
  const bar = layout.barAt(row.index);
  const empty: HitTarget = { kind: 'empty', rowId: row.id };
  if (bar === undefined) return empty;
  const allowed = input.permissions?.(bar.id);
  const handles = barHandles(bar, input.handles);
  const on = (part: TaskPart): HitTarget => ({ kind: 'task', id: bar.id, part });
  const inside = (rect: HandleRect | undefined): rect is HandleRect =>
    rect !== undefined &&
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height;
  const inCircle = (rect: HandleRect): boolean => {
    const r = rect.width / 2;
    return (x - rect.x - r) ** 2 + (y - rect.y - r) ** 2 <= r * r;
  };

  if (allowed?.link ?? true) {
    if (inCircle(handles.linkStart)) return on('link-start');
    if (inCircle(handles.linkEnd)) return on('link-end');
  }
  if ((allowed?.progress ?? true) && inside(handles.progress)) return on('progress');
  if (!inside(bar)) return empty;
  if (allowed?.resize ?? true) {
    if (inside(handles.resizeStart)) return on('resize-start');
    if (inside(handles.resizeEnd)) return on('resize-end');
  }
  return on('body');
}

const EMPTY: HitTarget = /* @__PURE__ */ Object.freeze({ kind: 'empty' });
