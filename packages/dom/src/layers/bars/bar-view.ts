import {
  type BarGeometry,
  type BarHandles,
  barHandles,
  type HandleRect,
  type LabelOptions,
  LAYOUT_DEFAULTS,
  placeLabel,
  type ResolvedEditing,
  type ResolvedHandles,
  resolvePermissions,
  type TaskModel,
  type TaskPermissions,
} from '@ganttlane/core';

import { createHtml, createSvg, setAttrs, setCssVar, withClass } from '../../shared';
import type { ResolvedDisplay } from '../types';
import { type LabelContent, resolveLabel } from './label';

/** State flags of a bar that come from the snapshot (the others come from the model). */
export const BAR_FLAGS = {
  selected: 1,
  hovered: 2,
  dragging: 4,
  resizing: 8,
  conflict: 16,
} as const;

/** What the layer draws for one bar: a task of the window with everything its view reads. */
export interface BarItem {
  /** Where the bar lies (the draft is already overlaid). */
  readonly bar: BarGeometry;
  /** The task's model. */
  readonly model: TaskModel;
  /** Progress in percent as drawn: the draft's while it is dragged, else the model's. */
  readonly progress: number;
  /** A bit set of {@link BAR_FLAGS}. */
  readonly flags: number;
}

/** What every view of a layer shares; the layer updates it before each sync. */
export interface BarEnv {
  /** The document that owns the nodes. */
  readonly document: Document;
  /** The display options being drawn. */
  display: ResolvedDisplay;
  /** `snapshot.editing`, for the handles; `undefined` before the first update. */
  editing: ResolvedEditing | undefined;
  /** `snapshot.handles`; `undefined` before the first update. */
  handles: ResolvedHandles | undefined;
  /** Where outside labels start: past the link handles of `handles`. */
  labelOptions: LabelOptions;
  /** Text width in px. */
  readonly measure: (text: string) => number;
  /** Grows when anything a view reads but does not get with its item changed. */
  epoch: number;
  /** Errors of user callbacks, thrown by the layer once the whole sync is done. */
  readonly errors: unknown[];
}

type HandlePart = 'resize-start' | 'resize-end' | 'progress-handle' | 'link-start' | 'link-end';

/** The parts a bar is made of; a view creates each on first use. */
type Part = 'track' | 'milestone' | 'progress' | 'text' | 'object' | HandlePart;

/** Child order: a slot holds one part at most, and the parts of a slot exclude each other. */
const SLOT = {
  track: 0,
  milestone: 0,
  progress: 1,
  text: 2,
  object: 2,
  'resize-start': 3,
  'resize-end': 4,
  'progress-handle': 5,
  'link-start': 6,
  'link-end': 7,
} as const satisfies Record<Part, number>;
const PROGRESS_SLOT = SLOT.progress;
const LABEL_SLOT = SLOT.text;
const SLOT_COUNT = 8;

/** How each handle is made, where `barHandles` puts it and which permission it needs. */
interface HandleSpec {
  readonly part: HandlePart;
  readonly tag: 'rect' | 'circle';
  readonly attrs: Readonly<Record<string, string>>;
  readonly box: (handles: BarHandles) => HandleRect | undefined;
  readonly allowed: (can: TaskPermissions) => boolean;
}

const HANDLES: readonly HandleSpec[] = [
  {
    part: 'resize-start',
    tag: 'rect',
    attrs: { class: 'gantt__handle', 'data-handle': 'resize-start' },
    box: (handles) => handles.resizeStart,
    allowed: (can) => can.resize,
  },
  {
    part: 'resize-end',
    tag: 'rect',
    attrs: { class: 'gantt__handle', 'data-handle': 'resize-end' },
    box: (handles) => handles.resizeEnd,
    allowed: (can) => can.resize,
  },
  {
    part: 'progress-handle',
    tag: 'rect',
    attrs: { class: 'gantt__handle', 'data-handle': 'progress' },
    box: (handles) => handles.progress,
    allowed: (can) => can.progress,
  },
  {
    part: 'link-start',
    tag: 'circle',
    attrs: { class: 'gantt__link-handle', 'data-side': 'start' },
    box: (handles) => handles.linkStart,
    allowed: (can) => can.link,
  },
  {
    part: 'link-end',
    tag: 'circle',
    attrs: { class: 'gantt__link-handle', 'data-side': 'end' },
    box: (handles) => handles.linkEnd,
    allowed: (can) => can.link,
  },
];

/** A bar's view: its group, the parts created so far and what was last drawn. */
export interface BarView {
  /** `g.gantt__bar`. */
  readonly node: SVGGElement;
  /** Every part created so far, in or out of the group. */
  readonly parts: Partial<Record<Part, SVGElement>>;
  /** The part in each slot, `undefined` for an empty one. */
  readonly slots: (SVGElement | undefined)[];
  /** The label content made last, whether or not it is shown. */
  content: LabelContent | undefined;
  /** The label content written to the label part now, `undefined` for none. */
  shown: LabelContent | undefined;
  /** `div.gantt__bar-label-content` inside the foreignObject, once that exists. */
  wrapper: HTMLDivElement | undefined;
  /** The inputs of the last draw: a view is skipped while they are all the same. */
  drawn: { readonly item: BarItem; readonly epoch: number } | undefined;
}

/**
 * Creates the group of a bar, empty: {@link updateBarView} fills it.
 *
 * @param document - Document that owns the node.
 * @returns A new view.
 */
export function createBarView(document: Document): BarView {
  return {
    node: createSvg(document, 'g', { class: 'gantt__bar' }),
    parts: {},
    slots: Array.from<SVGElement | undefined>({ length: SLOT_COUNT }),
    content: undefined,
    shown: undefined,
    wrapper: undefined,
    drawn: undefined,
  };
}

/**
 * Lets go of what a view holds when its bar has left the window and its nodes are dropped: a
 * label that is a `DisposableNode` is disposed, so that its owner can free it. A view is never
 * reused for another task, so there is nothing to reset: a bar that enters the window gets
 * nodes of its own, and the attribute the popover layer put on a bar's group (`aria-describedby`)
 * goes with the group.
 *
 * @param view - The view that is removed.
 */
export function releaseBarView(view: BarView): void {
  view.content?.dispose?.();
}

/** Whether two geometries are the same bar: a layout rebuilt for a draft holds equal objects. */
function sameBar(a: BarGeometry, b: BarGeometry): boolean {
  return (
    a === b ||
    (a.x === b.x &&
      a.y === b.y &&
      a.width === b.width &&
      a.height === b.height &&
      a.radius === b.radius &&
      a.progressWidth === b.progressWidth &&
      a.kind === b.kind)
  );
}

/** Puts a part in its slot, in child order, replacing what the slot held. */
function place(view: BarView, key: Part, create: () => SVGElement): SVGElement {
  const element = (view.parts[key] ??= create());
  const slot = SLOT[key];
  const held = view.slots[slot];
  if (held === element) return element;
  if (held === undefined) {
    let next: SVGElement | undefined;
    for (let i = slot + 1; i < SLOT_COUNT && next === undefined; i++) next = view.slots[i];
    view.node.insertBefore(element, next ?? null);
  } else {
    held.replaceWith(element);
  }
  view.slots[slot] = element;
  return element;
}

/** Empties a slot. */
function vacate(view: BarView, slot: number): void {
  view.slots[slot]?.remove();
  view.slots[slot] = undefined;
  if (slot === LABEL_SLOT) dropLabel(view);
}

/** `nodeType` of a document fragment. */
const FRAGMENT_NODE = 11;

/**
 * Forgets the label shown, and lets go of a custom node the caller may want back. A fragment
 * cannot be put back: its children moved into the label and go with it, so the content is
 * dropped too and the next draw asks the renderer for a new one. So is a node with a lifetime
 * (`DisposableNode`): it is disposed, since a label that is not drawn must not keep its owner's
 * resources, and asked for again when the label comes back.
 */
function dropLabel(view: BarView): void {
  view.shown = undefined;
  view.wrapper?.replaceChildren();
  const content = view.content;
  if (content?.node?.nodeType === FRAGMENT_NODE || content?.dispose !== undefined) {
    view.content = undefined;
    content.dispose?.();
  }
}

/** Draws the body of a bar: a rounded track with the done part on it, or a milestone diamond. */
function drawShape(view: BarView, env: BarEnv, bar: BarGeometry): void {
  const { x, y, width, height } = bar;
  if (bar.kind === 'milestone') {
    vacate(view, PROGRESS_SLOT);
    const diamond = place(view, 'milestone', () =>
      createSvg(env.document, 'polygon', { class: 'gantt__bar-milestone' }),
    );
    const middle = x + width / 2;
    const center = y + height / 2;
    setAttrs(diamond, {
      points: `${middle},${y} ${x + width},${center} ${middle},${y + height} ${x},${center}`,
    });
    return;
  }
  const track = place(view, 'track', () =>
    createSvg(env.document, 'rect', { class: 'gantt__bar-track' }),
  );
  setAttrs(track, { x, y, width, height, rx: bar.radius, ry: bar.radius });
  const progress = place(view, 'progress', () =>
    createSvg(env.document, 'rect', { class: 'gantt__bar-progress' }),
  );
  const radius = Math.min(bar.radius, bar.progressWidth / 2);
  setAttrs(progress, { x, y, width: bar.progressWidth, height, rx: radius, ry: radius });
}

/** Draws the label: its text or custom node, placed by `placeLabel`. */
function drawLabel(view: BarView, env: BarEnv, item: BarItem): void {
  const { bar, model, progress } = item;
  const { barLabel: mode, renderBarLabel: renderer } = env.display;
  if (mode === 'none') {
    vacate(view, LABEL_SLOT);
    return;
  }
  let content = view.content;
  if (content?.model !== model || content.progress !== progress || content.renderer !== renderer) {
    const old = content;
    content = resolveLabel(model, progress, renderer, env.measure, (error) => {
      env.errors.push(error);
    });
    view.content = content;
    // The new content comes first, so that it may share its node with the old.
    old?.dispose?.();
  }
  const placement = placeLabel(bar, content.width, mode, env.labelOptions);
  if (placement === undefined || (content.text === '' && content.node === undefined)) {
    vacate(view, LABEL_SLOT);
    return;
  }
  const where = placement.inside ? 'inside' : 'outside';
  if (content.node === undefined) {
    const text = place(view, 'text', () =>
      createSvg(env.document, 'text', { class: 'gantt__bar-label' }),
    );
    if (view.wrapper?.hasChildNodes() === true) dropLabel(view);
    if (text.textContent !== content.text) text.textContent = content.text;
    setAttrs(text, {
      x: placement.x,
      y: placement.y,
      'text-anchor': placement.anchor,
      // Centres the line on `y` without reading the font metrics.
      dy: '0.35em',
      'data-placement': where,
    });
  } else {
    // HTML inside SVG needs a foreignObject, and an HTML element in it to hold the node (a bare
    // text node does not render everywhere). Inside, the box is the bar's, which clips what does
    // not fit; outside, it is as wide as the estimate and lets the node overflow.
    const box = place(view, 'object', () => {
      view.wrapper = createHtml(env.document, 'div', { class: 'gantt__bar-label-content' });
      return createSvg(env.document, 'foreignObject', { class: 'gantt__bar-label' }, view.wrapper);
    });
    // The node a new content shares with the old (a framework's host) stays where it is: taking
    // it out and putting it back loses the focus in it.
    const wrapper = view.wrapper;
    if (
      view.shown !== content &&
      wrapper !== undefined &&
      (wrapper.firstChild !== content.node || wrapper.childNodes.length !== 1)
    ) {
      wrapper.replaceChildren(content.node);
    }
    const pad = LAYOUT_DEFAULTS.labelPadding;
    setAttrs(box, {
      x: placement.inside ? bar.x + pad : placement.x,
      y: bar.y,
      width: placement.inside
        ? Math.max(bar.width - 2 * pad, 0)
        : Math.ceil(content.width) + 2 * pad,
      height: bar.height,
      overflow: placement.inside ? null : 'visible',
      'data-placement': where,
    });
  }
  view.shown = content;
}

/** Draws the edit handles the task's permissions allow, where `barHandles` puts them. */
function drawHandles(view: BarView, env: BarEnv, bar: BarGeometry, can: TaskPermissions): void {
  const boxes = barHandles(bar, env.handles);
  for (const spec of HANDLES) {
    const box = spec.allowed(can) ? spec.box(boxes) : undefined;
    if (box === undefined) {
      vacate(view, SLOT[spec.part]);
      continue;
    }
    const element = place(view, spec.part, () => createSvg(env.document, spec.tag, spec.attrs));
    if (spec.tag === 'circle') {
      const r = box.width / 2;
      setAttrs(element, { cx: box.x + r, cy: box.y + r, r });
    } else {
      setAttrs(element, { x: box.x, y: box.y, width: box.width, height: box.height });
    }
  }
}

/**
 * Brings a bar's view in line with its item: attributes go
 * through `setAttrs`, so only what changed is written, and nothing at all when the item is the
 * one drawn last. Reads no layout.
 *
 * @param view - The view.
 * @param item - What to draw.
 * @param env - What the layer shares with its views.
 */
export function updateBarView(view: BarView, item: BarItem, env: BarEnv): void {
  const { bar, model, flags } = item;
  const last = view.drawn;
  if (
    last?.epoch === env.epoch &&
    last.item.model === model &&
    last.item.progress === item.progress &&
    last.item.flags === flags &&
    sameBar(last.item.bar, bar)
  ) {
    return;
  }
  const { task } = model;
  const can = resolvePermissions(model, env.editing);
  setAttrs(view.node, {
    class: withClass('gantt__bar', task.className),
    'data-task-id': String(bar.id),
    'data-type': model.type,
    'data-selected': (flags & BAR_FLAGS.selected) !== 0,
    'data-hovered': (flags & BAR_FLAGS.hovered) !== 0,
    'data-dragging': (flags & BAR_FLAGS.dragging) !== 0,
    'data-resizing': (flags & BAR_FLAGS.resizing) !== 0,
    'data-locked': task.locked === true,
    'data-movable': can.move,
    'data-readonly': !(can.move || can.resize || can.progress),
    'data-invalid': !model.valid,
    'data-conflict': (flags & BAR_FLAGS.conflict) !== 0,
  });
  setCssVar(
    view.node,
    '--gantt-bar-color',
    typeof task.color === 'string' ? task.color : undefined,
  );
  setCssVar(
    view.node,
    '--gantt-bar-progress-color',
    typeof task.progressColor === 'string' ? task.progressColor : undefined,
  );
  drawShape(view, env, bar);
  drawLabel(view, env, item);
  drawHandles(view, env, bar, can);
  view.drawn = { item, epoch: env.epoch };
}
