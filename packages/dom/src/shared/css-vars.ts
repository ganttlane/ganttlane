/** Name of a gantt CSS custom property. All of them carry the `--gantt-` prefix. */
export type CssVarName = `--gantt-${string}`;

/**
 * A custom property value: a string as it is, a number as unitless text (`--gantt-scale: 1.5`),
 * `undefined` removes the property. Lengths go through {@link px}.
 */
export type CssVarValue = string | number | undefined;

/** The elements that have a `style` (HTML and SVG). */
export type StyledElement = HTMLElement | SVGElement;

/**
 * A length in pixels as CSS text.
 *
 * @param value - Pixels.
 * @returns E.g. `'12.5px'`.
 */
export function px(value: number): string {
  return `${value}px`;
}

/**
 * Sets (or removes) one custom property through the CSSOM: no `style` attribute text, so it is
 * allowed under a strict `style-src` CSP (FR-THEME-6). Writes only when the value changed.
 *
 * @param element - HTML or SVG element.
 * @param name - Property name, `--gantt-*`.
 * @param value - New value, see {@link CssVarValue}.
 */
export function setCssVar(element: StyledElement, name: CssVarName, value: CssVarValue): void {
  const current = element.style.getPropertyValue(name);
  if (value === undefined) {
    if (current !== '') element.style.removeProperty(name);
    return;
  }
  const text = String(value);
  if (current !== text) element.style.setProperty(name, text);
}

/**
 * Sets several custom properties, each as {@link setCssVar} does.
 *
 * @param element - HTML or SVG element.
 * @param vars - Values by property name.
 */
export function setCssVars(
  element: StyledElement,
  vars: Readonly<Partial<Record<CssVarName, CssVarValue>>>,
): void {
  for (const [name, value] of Object.entries(vars)) {
    setCssVar(element, name as CssVarName, value);
  }
}
