/** Default first part of an id prefix. */
export const DEFAULT_ID_BASE = 'gantt';

/**
 * Instances created per document. A `WeakMap`, so a document that goes away takes its counter
 * with it, and nothing is shared between documents (iframes, test environments).
 */
const instances = new WeakMap<Document, number>();

/**
 * Allocates an id prefix, unique among the instances of this module in `document`:
 * `gantt-1`, `gantt-2`, … Every element id of an instance starts with its prefix, so charts
 * on one page never collide (ids are needed for `aria-*` references and SVG `url(#…)`).
 *
 * The counter is per document and kept in this module. Two copies of the library on one page
 * would each start from 1, so a prefix is skipped when an element with that id is already in
 * the document; when charts are mounted detached or the ids must be stable (SSR hydration,
 * React `useId`), pass `idPrefix` explicitly instead of using the allocator.
 *
 * @param document - The document the chart will live in.
 * @param base - Text before the number; default `'gantt'`.
 * @returns A new prefix such as `gantt-3`.
 */
export function allocateIdPrefix(document: Document, base: string = DEFAULT_ID_BASE): string {
  let prefix: string;
  do {
    const next = (instances.get(document) ?? 0) + 1;
    instances.set(document, next);
    prefix = `${base}-${next}`;
  } while (document.getElementById(prefix) !== null);
  return prefix;
}

/**
 * Builds the id of a named element of an instance.
 *
 * @param prefix - The instance's id prefix.
 * @param name - Local name, e.g. `'arrow'`.
 * @returns `${prefix}-${name}`.
 */
export function prefixedId(prefix: string, name: string): string {
  return `${prefix}-${name}`;
}
