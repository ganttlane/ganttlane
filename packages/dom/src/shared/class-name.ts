/**
 * Joins a base class with a caller's class names: the extra part is trimmed and its runs of
 * whitespace become single spaces; anything that is not a non-empty string adds nothing.
 *
 * @param base - The library's own class.
 * @param extra - The caller's class names (`rowClassName`, a highlight's `className`).
 * @returns The `class` attribute value.
 */
export function withClass(base: string, extra: unknown): string {
  const names = typeof extra === 'string' ? extra.trim() : '';
  return names === '' ? base : `${base} ${names.split(/\s+/).join(' ')}`;
}
