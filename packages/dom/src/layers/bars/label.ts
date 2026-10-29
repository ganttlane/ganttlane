import type { TaskModel } from '@ganttlane/core';

import { disposableOf } from '../../shared';
import type { BarLabelRenderer } from '../types';

/** Font size, in px, the default label estimate assumes: the size the default theme draws. */
export const DEFAULT_LABEL_FONT_SIZE = 12;

/**
 * Advance widths of the printable ASCII characters (U+0020 … U+007E) in 1/1000 em, after the
 * metrics of Helvetica / Arial, which the usual UI fonts (system-ui, Segoe UI, Roboto) stay
 * within a few percent of.
 */
const ASCII_ADVANCES: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Whether a code point is drawn full-width (CJK, Hangul, full-width forms, emoji). */
function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    code >= 0x1f000
  );
}

/** Advance of one code point in 1/1000 em. */
function advanceOf(code: number): number {
  if (code < 0x20) return 0;
  if (code < 0x7f) return ASCII_ADVANCES[code - 0x20] ?? 556;
  // Combining marks add no width; other scripts (Cyrillic, Greek, accented Latin) average
  // about 0.56 em in the common UI fonts.
  if (code >= 0x300 && code <= 0x36f) return 0;
  return isWide(code) ? 1000 : 560;
}

/**
 * How much wider than the Arial table the estimate is. System UI fonts measure up to 6 % wider
 * than Arial for Latin text (SF on macOS: 4 to 9 %), and a label that overflows its bar looks
 * worse than one that was put beside it, so the estimate errs on the wide side.
 */
export const ESTIMATE_MARGIN = 1.06;

/**
 * Estimates the width of a label without touching the DOM: the sum of per-character advances of
 * an Arial-like face, widened by {@link ESTIMATE_MARGIN}. Bar labels use it to decide `auto`
 * placement, because measuring text (`getComputedTextLength`, `getBBox`) forces a layout, which
 * `update` must never do. Measured in Chromium on macOS for Latin and Cyrillic
 * names, it lands between -3 % and +13 % of the real width for system-ui, Arial, Helvetica,
 * Tahoma, Trebuchet and Georgia (Times: up to +18 %), runs up to 8 % short for Verdana and up
 * to 21 % short for monospace faces; an app with such a label font passes `measureText` to
 * `createBarsLayer`.
 *
 * @param text - The label text.
 * @param fontSize - Font size in px; default {@link DEFAULT_LABEL_FONT_SIZE}.
 * @returns The estimated width in px.
 */
export function estimateTextWidth(
  text: string,
  fontSize: number = DEFAULT_LABEL_FONT_SIZE,
): number {
  let advance = 0;
  for (const char of text) advance += advanceOf(char.codePointAt(0) ?? 0);
  return (advance * fontSize * ESTIMATE_MARGIN) / 1000;
}

/** What a bar's label shows, resolved from `renderBarLabel` or the task name. */
export interface LabelContent {
  /** The task the content was made for (cache key). */
  readonly model: TaskModel;
  /** The progress it was made for (cache key). */
  readonly progress: number;
  /** The renderer it was made by (cache key). */
  readonly renderer: BarLabelRenderer | undefined;
  /**
   * The label as text: the string, the text of a plain node, or the task name; `''` for content
   * with a lifetime, whose text is its owner's business.
   */
  readonly text: string;
  /** The custom node, when `renderBarLabel` returned one. */
  readonly node: Node | undefined;
  /** Ends the life of {@link LabelContent.node} when it came as a `DisposableNode`. */
  readonly dispose: (() => void) | undefined;
  /**
   * The estimated width in px of {@link LabelContent.text}; `0` (not known) for content with a
   * lifetime.
   */
  readonly width: number;
}

/** Whether a value looks like a DOM node (works across documents, unlike `instanceof`). */
function isNode(value: unknown): value is Node {
  return (
    typeof value === 'object' && value !== null && typeof (value as Node).nodeType === 'number'
  );
}

/**
 * Resolves what a bar's label shows: the `renderBarLabel` result, a string
 * as text, a node (or the `node` of a `DisposableNode`) as is, or the task name when there is no
 * renderer or it returns nothing. A renderer that throws is reported to `fail` and the name is
 * shown. The width of a plain node is estimated from its text. The width of content with a
 * lifetime (`DisposableNode`) is not known: its node is kept between calls by whoever owns it and
 * holds what was drawn last (or nothing yet), so measuring it would make `auto` placement depend
 * on history. It has no text and no width (`0`): `auto` puts it inside the bar.
 *
 * @param model - The task.
 * @param progress - Its progress in percent, draft included.
 * @param renderer - `display.renderBarLabel`.
 * @param measure - Text width in px.
 * @param fail - Receives an error the renderer threw.
 * @returns The content.
 */
export function resolveLabel(
  model: TaskModel,
  progress: number,
  renderer: BarLabelRenderer | undefined,
  measure: (text: string) => number,
  fail: (error: unknown) => void,
): LabelContent {
  let custom: unknown;
  if (renderer !== undefined) {
    try {
      custom = renderer({ id: model.id, name: model.name, task: model.task, progress });
    } catch (error) {
      fail(error);
    }
  }
  const hosted = disposableOf(custom);
  const node = isNode(custom) ? custom : hosted?.node;
  let text = model.name;
  if (typeof custom === 'string') text = custom;
  else if (hosted !== undefined) text = '';
  else if (node !== undefined) text = node.textContent ?? '';
  const width = hosted === undefined ? measure(text) : 0;
  return { model, progress, renderer, text, node, dispose: hosted?.dispose, width };
}
