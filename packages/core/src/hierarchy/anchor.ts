/**
 * Normalization of parent anchors (`Task.parentAnchor`, `hierarchy.childAnchor`; FR-SCH-2):
 * which edges of a child are pinned to which edges of its parent. Propagation itself is plan
 * step 2.4.
 */

import type { LinkType } from '../model';
import { DEV } from '../shared';
import { show } from './issues';

/** Link types that pin the child's start (`SS`: to the parent's start, `FS`: to its end). */
type StartPin = 'SS' | 'FS';
/** Link types that pin the child's end (`FF`: to the parent's end, `SF`: to its start). */
type EndPin = 'FF' | 'SF';

const anchorOf = (...types: LinkType[]): readonly LinkType[] => Object.freeze(types);

/**
 * The start pin to the parent's start: a constant of its own, so that {@link DEFAULT_CHILD_ANCHOR}
 * is a plain reference. `SINGLE.SS` would read a property of an object literal full of calls,
 * which a bundler keeps whole in the bundle of an app that never builds a hierarchy.
 */
const START_TO_START: readonly LinkType[] = /* @__PURE__ */ anchorOf('SS');

/** Shared frozen anchors with one pin. */
const SINGLE: Readonly<Record<LinkType, readonly LinkType[]>> = {
  SS: START_TO_START,
  FS: /* @__PURE__ */ anchorOf('FS'),
  FF: /* @__PURE__ */ anchorOf('FF'),
  SF: /* @__PURE__ */ anchorOf('SF'),
};

/** Shared frozen anchors with both edges pinned, the start pin first. */
const PAIR: Readonly<Record<`${StartPin}${EndPin}`, readonly LinkType[]>> = {
  SSFF: /* @__PURE__ */ anchorOf('SS', 'FF'),
  SSSF: /* @__PURE__ */ anchorOf('SS', 'SF'),
  FSFF: /* @__PURE__ */ anchorOf('FS', 'FF'),
  FSSF: /* @__PURE__ */ anchorOf('FS', 'SF'),
};

/**
 * The default `hierarchy.childAnchor`: `['SS']`, the child's start follows the parent's start
 * (legacy `children_default_pinned_to: {start: 'start'}`).
 *
 * @internal
 */
export const DEFAULT_CHILD_ANCHOR: readonly LinkType[] = START_TO_START;

/**
 * Result of {@link readAnchor}.
 *
 * @internal
 */
export interface AnchorReading {
  /** The canonical anchor: at most one pin per child edge, the start pin first; frozen. */
  readonly anchor: readonly LinkType[];
  /**
   * Why entries were ignored (the first reason; `''` in the production build), or `undefined`
   * when the value was usable.
   */
  readonly problem: string | undefined;
}

/**
 * Reads an anchor given as one link type or an array of them. Repeats are dropped silently;
 * entries that are not link types, and entries that pin an already pinned child edge (`'FS'`
 * after `'SS'`), are ignored with a problem; when nothing is left, `fallback` is used.
 *
 * @internal
 */
export function readAnchor(value: unknown, fallback: readonly LinkType[]): AnchorReading {
  if (value === undefined) return { anchor: fallback, problem: undefined };
  const entries: readonly unknown[] = Array.isArray(value) ? value : [value];
  // In production a problem is `''`: still reported, without its text.
  let problem = entries.length === 0 ? (DEV ? 'is empty' : '') : undefined;
  let start: StartPin | undefined;
  let end: EndPin | undefined;
  for (const entry of entries) {
    if (entry === 'SS' || entry === 'FS') {
      if (start === undefined) start = entry;
      else if (start !== entry) problem ??= DEV ? `${entry} pins the start again` : '';
    } else if (entry === 'FF' || entry === 'SF') {
      if (end === undefined) end = entry;
      else if (end !== entry) problem ??= DEV ? `${entry} pins the end again` : '';
    } else {
      problem ??= DEV ? `${show(entry)} is not a link type` : '';
    }
  }
  let anchor: readonly LinkType[];
  if (start === undefined) anchor = end === undefined ? fallback : SINGLE[end];
  else anchor = end === undefined ? SINGLE[start] : PAIR[`${start}${end}`];
  return { anchor, problem };
}
