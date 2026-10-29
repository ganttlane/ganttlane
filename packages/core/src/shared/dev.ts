/**
 * Replaced at build time (tsdown `define`): `false` in `dist/index.js`, `true` in
 * `dist/index.development.js`. Undeclared, so `typeof` is `'undefined'`, when the sources run
 * as they are (tests, playground, the `@ganttlane/source` condition).
 */
declare const __GANTTLANE_DEV__: boolean | undefined;

/**
 * Whether this is the development build of `@ganttlane/core` (ADR-016, ADR-019): `true` in
 * `dist/index.development.js` (export condition `development`) and in the sources, `false` in
 * the production build `dist/index.js`.
 *
 * Use it as `DEV ? fullText : ''` (or `if (DEV) …`) around issue messages and hints: the bundler
 * folds the constant, so the explanatory text exists only in the development build. Behaviour,
 * issue codes and every other issue field must not depend on it.
 *
 * @internal
 */
export const DEV: boolean = typeof __GANTTLANE_DEV__ !== 'boolean' || __GANTTLANE_DEV__;
