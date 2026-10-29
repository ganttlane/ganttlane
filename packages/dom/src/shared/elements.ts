/** The SVG namespace, for `document.createElementNS`. */
export const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * A node with a lifetime: what a render function returns in place of a bare `Node` when whoever
 * made the node has to know when the renderer is done with it (a framework's portal host, say).
 * The renderer shows `node` as it would show any node, and calls `dispose` once when it stops
 * showing it: when the popover is closed, replaced or made again, when the label is hidden or its
 * inputs change, when the bar leaves the window, and when the chart is destroyed.
 *
 * **Made again, node kept.** When a render function is asked again for what the renderer is already
 * showing, the new content is made *before* the old one is disposed, so the two may share a node
 * (a framework's host for the same tooltip). A node that is the only child of where it is shown
 * stays where it is: it is not taken out and put back, so the focus and the selection in it
 * survive, and so does anything that reacts to a node being attached.
 *
 * Return a new object from every call: its `dispose` ends the content of that call, and the
 * previous content is disposed when the renderer takes the next. None of the functions may throw,
 * and `dispose` may be called from anywhere in the renderer's `update`.
 *
 * **Width.** The width of the content of a bar's label is not known to the renderer: `node` may
 * hold what an earlier call drew, or nothing yet. A label with a lifetime is not measured, so
 * `barLabel: 'auto'` places it inside the bar (as it does for a label of no width); use `'inside'`
 * or `'outside'` to be explicit.
 *
 * **Emptiness.** A popover whose node shows nothing (no text but whitespace, and no image, control
 * or other element that draws without text, see `showsNothing`) is not shown, and its content is
 * disposed at once.
 */
export interface DisposableNode {
  /** What is shown. It should have its content when it is returned: the renderer measures it. */
  readonly node: Node;
  /** Called once, when the renderer no longer shows `node`. */
  readonly dispose: () => void;
  /**
   * Popovers only. Called after the renderer put its popover in the chart and before it measures
   * it, each time it shows this content (the popover is opened, or made again): the place to draw
   * what needs the document, such as a framework's synchronous render (`autoFocus`, layout
   * effects and measuring need an attached node). Whatever the content draws or focuses here
   * counts: the emptiness check follows it, and a menu leaves the focus where the content put it.
   */
  readonly attached?: () => void;
  /**
   * Popovers only. Whether `target` belongs to this content though it is not inside `node`: an
   * element the content renders elsewhere in the page (the portal of a select, a menu or a date
   * picker). A press on it is not a press outside the popover (which closes a popover that stays
   * open), and a scroll of it does not close the popover. Called with any node, including the
   * document; the answer must not depend on layout.
   */
  readonly owns?: (target: Node) => boolean;
}

/**
 * Reads a render function's answer as a {@link DisposableNode}: an object with a `node` that is
 * not itself a node (a custom element may well have a `node` of its own).
 *
 * @param value - What a render function returned.
 * @returns The node with a lifetime, `undefined` for every other answer.
 */
export const disposableOf = (value: unknown): DisposableNode | undefined =>
  typeof value === 'object' && value !== null && 'node' in value && !('nodeType' in value)
    ? (value as DisposableNode)
    : undefined;

/**
 * An attribute value: strings and numbers are written as they are, `true` writes an empty
 * attribute (`data-selected=""`), `false`, `null` and `undefined` remove the attribute.
 */
export type AttrValue = string | number | boolean | null | undefined;

/** Attributes by name (`class`, `data-*`, `x`, `aria-*`, …). */
export type Attrs = Readonly<Record<string, AttrValue>>;

/**
 * Sets attributes, touching only those whose value changed: no DOM write (and so no style
 * invalidation) when an update brings the same value.
 *
 * @param element - HTML or SVG element.
 * @param attrs - Attributes to set or remove, see {@link AttrValue}.
 */
export function setAttrs(element: Element, attrs: Attrs): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) {
      if (element.hasAttribute(name)) element.removeAttribute(name);
      continue;
    }
    const text = value === true ? '' : String(value);
    if (element.getAttribute(name) !== text) element.setAttribute(name, text);
  }
}

/**
 * Sets or removes one attribute, writing only when the value changed.
 *
 * @param element - HTML or SVG element.
 * @param name - Attribute name.
 * @param value - See {@link AttrValue}.
 */
export function setAttr(element: Element, name: string, value: AttrValue): void {
  setAttrs(element, { [name]: value });
}

/**
 * Creates an HTML element. Children are nodes or strings; a string becomes a text node (never
 * parsed as HTML).
 *
 * @param document - Document that owns the element (a chart may live in an iframe).
 * @param tag - Tag name.
 * @param attrs - Initial attributes.
 * @param children - Initial children.
 * @returns The new element.
 */
export function createHtml<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  attrs?: Attrs,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (attrs !== undefined) setAttrs(element, attrs);
  if (children.length > 0) element.append(...children);
  return element;
}

/**
 * Creates an SVG element in the SVG namespace. Children are nodes or strings; a string becomes
 * a text node (never parsed as markup).
 *
 * @param document - Document that owns the element.
 * @param tag - Tag name (`g`, `rect`, `path`, `text`, …).
 * @param attrs - Initial attributes.
 * @param children - Initial children.
 * @returns The new element.
 */
export function createSvg<K extends keyof SVGElementTagNameMap>(
  document: Document,
  tag: K,
  attrs?: Attrs,
  ...children: (Node | string)[]
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  if (attrs !== undefined) setAttrs(element, attrs);
  if (children.length > 0) element.append(...children);
  return element;
}
