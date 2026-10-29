/**
 * Declarations for `@ganttlane/dom/styles.css`, which has none to give: an import of the
 * stylesheet binds nothing. TypeScript 6 checks side-effect imports (`noUncheckedSideEffectImports`
 * is on by default) and reports TS2882 for `import '@ganttlane/dom/styles.css'` when it finds no
 * declaration file, so the `types` condition of the subpath in `package.json` points at this one
 * (copied to `dist` by the build, `copy` in `tsdown.config.ts`).
 */
export {};
