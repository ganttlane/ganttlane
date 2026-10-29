/**
 * Helpers every renderer layer uses: element creation with attribute setting, keyed
 * reconciliation, CSS custom property setters and the virtualization window checks. Layers import this folder (and
 * `@ganttlane/core`), never each other (`.dependency-cruiser.ts`, rule `dom-layers-isolated`).
 *
 * @module
 */

export { withClass } from './class-name';
export type { CssVarName, CssVarValue, StyledElement } from './css-vars';
export { px, setCssVar, setCssVars } from './css-vars';
export type { Attrs, AttrValue, DisposableNode } from './elements';
export { createHtml, createSvg, disposableOf, setAttr, setAttrs, SVG_NS } from './elements';
export type { Reconciler, ReconcilerSpec } from './reconcile';
export { createReconciler } from './reconcile';
export type { DrawnSpan } from './window';
export { covers, same, spanOf, visibleTime } from './window';
