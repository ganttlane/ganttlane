/** `Node.ELEMENT_NODE`, spelled out: this file may not name the DOM global to compare with. */
const ELEMENT_NODE = 1;

/** What a value is, for the message of {@link assertContainer}. */
function describe(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'string') {
    return `the string ${JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value)}`;
  }
  if (typeof value === 'object') {
    const { nodeType } = value as { nodeType?: unknown };
    return typeof nodeType === 'number'
      ? `a DOM node that is not an element (nodeType ${String(nodeType)})`
      : 'an object that is not a DOM node';
  }
  return `a ${typeof value}`;
}

/**
 * Throws a `TypeError` that says what was wrong unless `container` is an element: what
 * `createGantt`, `createChart` and `mountRenderer` render into. Without the check an untyped
 * caller gets an error from deep inside the renderer (`createGantt('#chart', …)` died with
 * "Invalid value used as weak map key", `createGantt(null, …)` with a failed property read),
 * which names neither the argument nor the cure.
 *
 * An element is told by its `nodeType`, not by `instanceof HTMLElement`: an element of an iframe,
 * of a popup window or of another copy of the DOM (jsdom, happy-dom) is a perfectly good
 * container, but it is not an instance of this realm's `HTMLElement`.
 *
 * @param container - What the caller passed as the container.
 * @param caller - The name to start the message with (`'createGantt'`).
 */
export function assertContainer(
  container: unknown,
  caller: string,
): asserts container is HTMLElement {
  if (
    typeof container === 'object' &&
    container !== null &&
    (container as { nodeType?: unknown }).nodeType === ELEMENT_NODE
  ) {
    return;
  }
  const hint =
    typeof container === 'string'
      ? ' Pass the element itself, not a selector: document.querySelector(selector).'
      : container === null || container === undefined
        ? ' Is the element there yet, when this runs (document.querySelector found nothing)?'
        : '';
  throw new TypeError(
    `${caller}: \`container\` must be a DOM element, got ${describe(container)}.${hint}`,
  );
}
