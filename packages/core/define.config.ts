/**
 * Compile-time constants of the two builds of `@ganttlane/core` (`tsdown.config.ts`): the bundler
 * replaces `__GANTTLANE_DEV__` in the sources (`src/shared/dev.ts`). A file of their own, without
 * imports, so that the build test (`src/production.test.ts`) bundles with the same constants.
 */

/** The production build, `dist/index.js` (default export condition). */
export const PRODUCTION_DEFINE: Readonly<Record<string, string>> = { __GANTTLANE_DEV__: 'false' };

/** The development build, `dist/index.development.js` (export condition `development`). */
export const DEVELOPMENT_DEFINE: Readonly<Record<string, string>> = { __GANTTLANE_DEV__: 'true' };
